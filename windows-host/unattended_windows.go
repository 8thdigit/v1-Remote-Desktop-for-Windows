package main

import (
	"context"
	"errors"
	"os"
	"strings"
	"syscall"
	"time"
	"unsafe"
)

var (
	shell32           = syscall.NewLazyDLL("shell32.dll")
	advapi32          = syscall.NewLazyDLL("advapi32.dll")
	shellNotifyIcon   = shell32.NewProc("Shell_NotifyIconW")
	regSetKeyValue    = advapi32.NewProc("RegSetKeyValueW")
	regDeleteKeyValue = advapi32.NewProc("RegDeleteKeyValueW")
	createMutex       = syscall.NewLazyDLL("kernel32.dll").NewProc("CreateMutexW")
	setForeground     = user.NewProc("SetForegroundWindow")
	messageBox        = user.NewProc("MessageBoxW")
	createIconInfo    = user.NewProc("CreateIconIndirect")
	destroyIcon       = user.NewProc("DestroyIcon")
	createBitmap      = gdi.NewProc("CreateBitmap")
	createPopupMenu   = user.NewProc("CreatePopupMenu")
	destroyMenu       = user.NewProc("DestroyMenu")
	trackPopupMenu    = user.NewProc("TrackPopupMenu")
	getCursorPos      = user.NewProc("GetCursorPos")
	postMessage       = user.NewProc("PostMessageW")
	findWindow        = user.NewProc("FindWindowW")
	openClipboard     = user.NewProc("OpenClipboard")
	emptyClipboard    = user.NewProc("EmptyClipboard")
	setClipboardData  = user.NewProc("SetClipboardData")
	closeClipboard    = user.NewProc("CloseClipboard")
	kernel32          = syscall.NewLazyDLL("kernel32.dll")
	globalAlloc       = kernel32.NewProc("GlobalAlloc")
	globalLock        = kernel32.NewProc("GlobalLock")
	globalUnlock      = kernel32.NewProc("GlobalUnlock")
	globalFree        = kernel32.NewProc("GlobalFree")
	moveMemory        = kernel32.NewProc("RtlMoveMemory")
)

const (
	unattendedClass = "MsfwrUnattended"
	runKey          = `Software\Microsoft\Windows\CurrentVersion\Run`
	runValue        = "Msfwr"
	hkeyCurrentUser = 0x80000001
	trayMessage     = 0x8001 // WM_APP + 1
	showAgain       = 0x8002 // WM_APP + 2: a second copy was started
)

// copyText puts text on the clipboard.
func copyText(window uintptr, text string) bool {
	data, err := syscall.UTF16FromString(text)
	if err != nil {
		return false
	}
	if r, _, _ := openClipboard.Call(window); r == 0 {
		return false
	}
	defer closeClipboard.Call()
	emptyClipboard.Call()
	size := uintptr(len(data) * 2)
	memory, _, _ := globalAlloc.Call(0x0002, size) // GMEM_MOVEABLE
	if memory == 0 {
		return false
	}
	target, _, _ := globalLock.Call(memory)
	if target == 0 {
		globalFree.Call(memory)
		return false
	}
	moveMemory.Call(target, uintptr(unsafe.Pointer(&data[0])), size)
	globalUnlock.Call(memory)
	if r, _, _ := setClipboardData.Call(13, memory); r == 0 { // CF_UNICODETEXT
		globalFree.Call(memory)
		return false
	}
	return true
}

// setAutostart starts Msfwr in unattended mode when this Windows user
// signs in, so the saved access works after a restart.
func setAutostart(on bool) error {
	key, name := textPtr(runKey), textPtr(runValue)
	if !on {
		r, _, _ := regDeleteKeyValue.Call(hkeyCurrentUser, uintptr(unsafe.Pointer(key)), uintptr(unsafe.Pointer(name)))
		if r != 0 && r != 2 { // ERROR_FILE_NOT_FOUND is fine.
			return syscall.Errno(r)
		}
		return nil
	}
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	command, err := syscall.UTF16FromString(`"` + exe + `" --unattended`)
	if err != nil {
		return err
	}
	r, _, _ := regSetKeyValue.Call(hkeyCurrentUser, uintptr(unsafe.Pointer(key)), uintptr(unsafe.Pointer(name)),
		1, uintptr(unsafe.Pointer(&command[0])), uintptr(len(command)*2)) // REG_SZ
	if r != 0 {
		return syscall.Errno(r)
	}
	return nil
}

func ask(window uintptr, text string) bool {
	r, _, _ := messageBox.Call(window, uintptr(unsafe.Pointer(textPtr(text))), uintptr(unsafe.Pointer(textPtr("Msfwr"))), 0x24) // MB_YESNO|MB_ICONQUESTION
	return r == 6
}

type iconInfo struct {
	icon             int32
	hotX, hotY       uint32
	hbmMask, hbmBits uintptr
}

// statusIcon draws the sync-arrows status icon in the state colour so the
// state is readable at a glance on the taskbar and in the notification area.
func statusIcon(size int, rgb uint32) uintptr {
	if size <= 0 {
		size = 16
	}
	header := dibInfo{Size: 40, Width: int32(size), Height: -int32(size), Planes: 1, Bits: 32}
	var bits unsafe.Pointer
	color, _, _ := createDIB.Call(0, uintptr(unsafe.Pointer(&header)), 0, uintptr(unsafe.Pointer(&bits)), 0, 0)
	if color == 0 || bits == nil {
		return 0
	}
	defer deleteObject.Call(color)
	copy(unsafe.Slice((*uint32)(bits), size*size), syncIconPixels(size, rgb))
	mask, _, _ := createBitmap.Call(uintptr(size), uintptr(size), 1, 1, 0)
	if mask == 0 {
		return 0
	}
	defer deleteObject.Call(mask)
	info := iconInfo{icon: 1, hbmMask: mask, hbmBits: color}
	icon, _, _ := createIconInfo.Call(uintptr(unsafe.Pointer(&info)))
	return icon
}

type notifyIconData struct {
	size                uint32
	window              uintptr
	id, flags, callback uint32
	icon                uintptr
	tip                 [128]uint16
	state, stateMask    uint32
	info                [256]uint16
	version             uint32
	infoTitle           [64]uint16
	infoFlags           uint32
	guid                syscall.GUID
	balloonIcon         uintptr
}

// runUnattended runs unattended access with no visible presence: no taskbar
// button and no notification-area (tray) icon. It runs from a hidden window;
// the Msfwr window (status, access code, connections, Initiate and the
// stop/exit/turn-off controls) opens from the Start shortcut, and the
// always-on-top live-sharing indicator still appears while IT is connected, so
// a remote session is never silent on the PC. It never opens an approval
// prompt during a session. It returns when the user exits or turns unattended
// access off. announce is retained for compatibility but shows nothing, since
// there is no tray icon to attach a balloon to.
func runUnattended(configPath string, config unattendedConfig, announce, openWindow bool) error {
	mutexName := textPtr(`Local\msfwr-unattended`)
	if m, _, lastErr := createMutex.Call(0, 0, uintptr(unsafe.Pointer(mutexName))); m != 0 && lastErr == syscall.Errno(183) {
		// Already running (for example, started at sign-in). Ask the running
		// copy to open its Msfwr window instead of starting a second copy.
		if running, _, _ := findWindow.Call(uintptr(unsafe.Pointer(textPtr(unattendedClass))), 0); running != 0 {
			postMessage.Call(running, showAgain, 0, 0)
		}
		return nil
	}
	code := formatCode(standingCode(config.Key))
	hostName, _ := os.Hostname()
	small := metric(49)
	type look struct {
		icon uintptr
		tip  string
	}
	blue, green, amber := statusIcon(small, 0x2563eb), statusIcon(small, 0x16a34a), statusIcon(small, 0xd97706)
	defer func() {
		destroyIcon.Call(blue)
		destroyIcon.Call(green)
		destroyIcon.Call(amber)
	}()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	updates := make(chan unattendedUpdate, 16)
	stopSession := make(chan struct{}, 1)
	initiate := make(chan struct{}, 1)
	newLink := make(chan linkRequest, 1)
	inflight := &linkInflight{}
	linksPath := linksPathFor(configPath)
	worker := make(chan struct{})

	instance, _, _ := getModule.Call(0)
	registerWindowMessage := user.NewProc("RegisterWindowMessageW")
	trayCreated, _, _ := registerWindowMessage.Call(uintptr(unsafe.Pointer(textPtr("TaskbarCreated"))))

	state := "ready"
	detail := "Connecting to the relay…"
	connections := 0
	disabling := false
	var sessions sessionLog
	var panel *controlPanel
	tray := notifyIconData{id: 1, flags: 0x1 | 0x2 | 0x4, callback: trayMessage} // NIF_MESSAGE|NIF_ICON|NIF_TIP
	tray.size = uint32(unsafe.Sizeof(tray))
	current := func() look {
		switch state {
		case "connected":
			return look{green, "Msfwr — " + connectStatus(connections)}
		case "calling":
			return look{blue, "Msfwr — Request sent, waiting for IT"}
		case "offline":
			return look{amber, "Msfwr — Cannot reach the relay"}
		case "locked":
			return look{blue, "Msfwr — PC locked"}
		}
		return look{blue, "Msfwr — Ready"}
	}
	// Msfwr keeps no visible presence at all: no taskbar button and no
	// notification-area (tray) icon. setTray and notify, which both drive the
	// Shell_NotifyIcon tray icon, are therefore no-ops. The app still runs from
	// its hidden window, the Msfwr window opens from Start, and the always-on-top
	// live-sharing indicator still appears while IT is connected, so a remote
	// session is never silent on the PC.
	const showTray = false
	setTray := func(action uintptr) {
		if !showTray {
			return
		}
		l := current()
		tray.icon = l.icon
		tray.tip = [128]uint16{}
		tip, _ := syscall.UTF16FromString(l.tip)
		copy(tray.tip[:len(tray.tip)-1], tip)
		shellNotifyIcon.Call(action, uintptr(unsafe.Pointer(&tray)))
	}

	notify := func(title, text string) {
		if !showTray {
			return
		}
		balloon := tray
		balloon.flags = 0x10 // NIF_INFO
		balloon.info = [256]uint16{}
		balloon.infoTitle = [64]uint16{}
		info, _ := syscall.UTF16FromString(text)
		copy(balloon.info[:len(balloon.info)-1], info)
		heading, _ := syscall.UTF16FromString(title)
		copy(balloon.infoTitle[:len(balloon.infoTitle)-1], heading)
		balloon.infoFlags = 0x1                                    // NIIF_INFO
		shellNotifyIcon.Call(1, uintptr(unsafe.Pointer(&balloon))) // NIM_MODIFY
	}

	// owner is the window dialogs belong to: the Msfwr window when it is
	// open, so prompts appear in front of it, and the hidden icon window
	// otherwise.
	owner := func(window uintptr) uintptr {
		if panel.visible() {
			return panel.window
		}
		return window
	}

	showMenu := func(window uintptr) {
		menu, _, _ := createPopupMenu.Call()
		if menu == 0 {
			return
		}
		defer destroyMenu.Call(menu)
		const (
			mfString    = 0x0
			mfGrayed    = 0x1
			mfSeparator = 0x800
		)
		item := func(flags, id uintptr, text string) {
			appendMenu.Call(menu, flags, id, uintptr(unsafe.Pointer(textPtr(text))))
		}
		headline := current().tip
		if state == "connected" {
			headline = connectStatus(connections) + " — IT is connected"
		}
		item(mfString|0x1000, openItem, "Open Msfwr") // MF_DEFAULT: shown in bold
		item(mfSeparator, 0, "")
		item(mfGrayed, 0, headline)
		item(mfGrayed, 0, detail)
		item(mfGrayed, 0, "Access code: "+code)
		item(mfGrayed, 0, "Connections since start: "+twoDigits(connections))
		item(mfSeparator, 0, "")
		switch state {
		case "ready":
			item(mfString, initiateItem, "Initiate — ask IT to connect")
		case "calling":
			item(mfString, initiateItem, "Initiate again — resend the request")
		default:
			item(mfGrayed, initiateItem, "Initiate — ask IT to connect")
		}
		item(mfString, copyItem, "Copy access code")
		if state == "connected" {
			item(mfString, stopItem, "Stop current session")
		} else {
			item(mfGrayed, stopItem, "Stop current session")
		}
		item(mfSeparator, 0, "")
		if state != "connected" {
			item(mfString, createLink, "Create Remote Access URL… (default 24 h)")
		} else {
			item(mfGrayed, createLink, "Create Remote Access URL… (default 24 h)")
		}
		activeLinks := listLinkEntries(linksPath, time.Now())
		for i, entry := range activeLinks {
			if i >= maxMenuLinks {
				break
			}
			if entry.id == "" {
				item(mfGrayed, 0, entry.url)
				continue
			}
			item(mfGrayed, 0, entry.url)
			item(mfString, uintptr(linkBase+2*i), "Copy URL "+twoDigits(i+1))
			item(mfString, uintptr(linkBase+2*i+1), "Revoke URL "+twoDigits(i+1))
		}
		if len(activeLinks) > 0 {
			item(mfString, stopAllItem, "Stop all sessions now")
		}
		item(mfSeparator, 0, "")
		item(mfString, disableItem, "Turn off unattended access…")
		item(mfString, exitItem, "Exit")
		var at struct{ x, y int32 }
		getCursorPos.Call(uintptr(unsafe.Pointer(&at)))
		setForeground.Call(window)                                                           // Required so the menu closes when the user clicks elsewhere.
		trackPopupMenu.Call(menu, 0x0008|0x0020, uintptr(at.x), uintptr(at.y), 0, window, 0) // TPM_RIGHTALIGN|TPM_BOTTOMALIGN
		postMessage.Call(window, 0, 0, 0)                                                    // WM_NULL
	}

	proc := syscall.NewCallback(func(window, msg, wParam, lParam uintptr) uintptr {
		if trayCreated != 0 && msg == trayCreated { // Explorer restarted.
			setTray(0)
			return 0
		}
		switch msg {
		case trayMessage:
			switch lParam & 0xffff {
			case 0x0202: // WM_LBUTTONUP: open the Msfwr window.
				if panel != nil {
					panel.show()
				} else {
					showMenu(window)
				}
			case 0x0205: // WM_RBUTTONUP: quick menu.
				showMenu(window)
			}
			return 0
		case showAgain: // Msfwr was opened again, for example from Start.
			if panel != nil {
				panel.show()
			} else {
				notify("Msfwr is already running", "Unattended access runs from this icon. Click it for the status, the access code, or Initiate.")
			}
			return 0
		case 0x0010: // WM_CLOSE: keep running in the notification area; Exit quits.
			return 0
		case 0x0002: // WM_DESTROY
			cancel()
			if panel != nil {
				destroyWindow.Call(panel.window)
			}
			if showTray {
				shellNotifyIcon.Call(2, uintptr(unsafe.Pointer(&tray))) // NIM_DELETE
			}
			quitMessage.Call(0)
			return 0
		case 0x0111: // WM_COMMAND from the menu
			switch wParam & 0xffff {
			case openItem:
				if panel != nil {
					panel.show()
				}
			case copyItem:
				if copyText(window, code) {
					notify("Access code copied", code)
				}
			case initiateItem:
				if state == "ready" || state == "calling" {
					select {
					case initiate <- struct{}{}:
					default:
					}
				}
			case stopItem:
				select {
				case stopSession <- struct{}{}:
				default:
				}
			case createLink:
				if hours, ok := pickValidity(owner(window)); ok {
					req := newLinkRequest(hostName, hours)
					if inflight.begin(req) {
						select {
						case newLink <- req:
						default:
						}
					}
				}
			case stopAllItem:
				select {
				case stopSession <- struct{}{}:
				default:
				}
			case disableItem:
				if ask(owner(window), "Turn off unattended access?\n\nIT will no longer be able to connect without your approval, and this access code stops working. Turning it on again creates a new code.") {
					disabling = true
					destroyWindow.Call(window)
				}
			case exitItem:
				if ask(owner(window), "Exit Msfwr?\n\nAny remote session ends. Unattended access stays on and starts again the next time you sign in.") {
					destroyWindow.Call(window)
				}
			default:
				if id := int(wParam & 0xffff); id >= linkBase && id < linkBase+2*maxMenuLinks {
					entries := listLinkEntries(linksPath, time.Now())
					i := (id - linkBase) / 2
					if i < len(entries) && entries[i].id != "" {
						if (id-linkBase)%2 == 0 {
							if copyText(window, entries[i].url) {
								notify("Remote access URL copied", "Share it with anyone who needs to connect. Multiple sessions can use it until it expires.")
							}
						} else if err := revokeLink(linksPath, entries[i].id, time.Now()); err != nil {
							notify("Could not revoke the URL", err.Error())
						} else {
							notify("Remote access URL revoked", "The shared link no longer opens sessions on this PC.")
						}
					}
				}
			}
			panel.update()
			return 0
		case 0x0113: // WM_TIMER
			changed := false
		drain:
			for {
				select {
				case next := <-updates:
					switch {
					case next.state == "connected" && state != "connected":
						connections++
						sessions.begin(time.Now())
						notify(connectStatus(connections)+" — IT is connected", "IT can view and control this PC. Press Ctrl+2 or F12 to stop.")
					case state == "connected" && next.state != "connected":
						sessions.finish(time.Now(), next.text)
						notify("Remote session ended", next.text)
					case next.state == "calling" && state != "calling":
						notify("Request sent to IT", "IT sees an Accept button in the browser. The request lasts 2 minutes.")
					}
					state = next.state
					detail = next.text
					if strings.Contains(next.text, "link is live") || strings.Contains(next.text, "Could not create") {
						inflight.done()
					}
					if state == "connected" {
						detail = connectStatus(connections) + ": IT can view and control this PC. Ctrl+2 or F12 stops."
					}
					changed = true
				default:
					break drain
				}
			}
			if changed {
				setTray(1) // NIM_MODIFY
				panel.update()
			}
			return 0
		}
		result, _, _ := defaultWindow.Call(window, msg, wParam, lParam)
		return result
	})

	windowError := errors.New("could not start unattended access in the notification area")
	className := textPtr(unattendedClass)
	class := indicatorClass{procedure: proc, instance: instance, name: className}
	if atom, _, _ := registerClass.Call(uintptr(unsafe.Pointer(&class))); atom == 0 {
		return windowError
	}
	// A hidden top-level window that is never shown: it only receives the
	// notification-area icon and menu messages, so there is no taskbar button.
	// WS_EX_TOOLWINDOW plus WS_POPUP, and ShowWindow is never called for it.
	window, _, _ := createWindow.Call(0x80, uintptr(unsafe.Pointer(className)), uintptr(unsafe.Pointer(textPtr("Msfwr"))), // WS_EX_TOOLWINDOW
		0x80000000, 0, 0, 0, 0, 0, 0, instance, 0) // WS_POPUP
	if window == 0 {
		return windowError
	}
	if timer, _, _ := setWindowTimer.Call(window, 1, 100, 0); timer == 0 {
		destroyWindow.Call(window)
		return windowError
	}
	tray.window = window
	setTray(0) // NIM_ADD
	if announce {
		notify("Msfwr", "Unattended access is on. Click this icon to open Msfwr: status, access code, connections and controls.")
	}
	// The Msfwr window: opened from Start, by clicking the icon, or with
	// "Open Msfwr" in the icon menu. If it cannot be created, the icon menu
	// still offers every control.
	panel, _ = newControlPanel(instance, window, func() panelView {
		now := time.Now()
		return panelView{
			state:    state,
			headline: stateLabel(state, connections),
			detail:   detail,
			code:     code,
			pcName:   hostName,
			relay:    config.Relay,
			active:   sessions.activeText(now),
			count:    "Connections since Msfwr started: " + twoDigits(connections),
			history:  sessions.lines(now),
			links:    listLinkEntries(linksPath, now),
		}
	})
	if openWindow && panel != nil {
		panel.show()
	}

	go func() {
		defer close(worker)
		serveUnattended(ctx, config.Relay, config.Key, hostName, linksPath, stopSession, initiate, newLink, updates)
	}()

	var msg indicatorMessage
	for {
		r, _, _ := getWindowMessage.Call(uintptr(unsafe.Pointer(&msg)), 0, 0, 0)
		if int32(r) <= 0 {
			break
		}
		if panel != nil {
			if handled, _, _ := isDialogMessage.Call(panel.window, uintptr(unsafe.Pointer(&msg))); handled != 0 {
				continue // Tab and Enter navigation in the Msfwr window.
			}
		}
		translateMessage.Call(uintptr(unsafe.Pointer(&msg)))
		dispatchMessage.Call(uintptr(unsafe.Pointer(&msg)))
	}
	cancel()
	// Drain updates so the worker never blocks while it shuts down.
	for done := false; !done; {
		select {
		case <-updates:
		case <-worker:
			done = true
		}
	}
	if disabling {
		if err := disableUnattended(configPath); err != nil {
			return errors.New("could not turn off unattended access: " + err.Error())
		}
		if err := setAutostart(false); err != nil {
			return errors.New("unattended access is off, but sign-in startup could not be removed: " + err.Error())
		}
	}
	return nil
}
