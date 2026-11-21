package main

import (
	"context"
	"errors"
	"os"
	"syscall"
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
)

const (
	unattendedClass = "Winss132rUnattended"
	runKey          = `Software\Microsoft\Windows\CurrentVersion\Run`
	runValue        = "winss132r"
	hkeyCurrentUser = 0x80000001
	trayMessage     = 0x8001 // WM_APP + 1
)

// setAutostart starts winss132r in unattended mode when this Windows user
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
	r, _, _ := messageBox.Call(window, uintptr(unsafe.Pointer(textPtr(text))), uintptr(unsafe.Pointer(textPtr("winss132r"))), 0x24) // MB_YESNO|MB_ICONQUESTION
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

// runUnattended runs unattended access from a notification-area icon only:
// there is no window and no taskbar button. The icon turns green and its
// tooltip reads "Connect: +NN" while a remote session is live. Clicking the
// icon opens a small menu with the status, the connection count, Initiate
// (ask IT to connect), and the stop/exit/turn-off commands. It never opens an
// approval prompt during a session. It returns when the user exits or turns
// unattended access off. announce shows a one-time notification that the app
// now lives in the notification area.
func runUnattended(configPath string, config unattendedConfig, announce bool) error {
	mutexName := textPtr(`Local\winss132r-unattended`)
	if m, _, lastErr := createMutex.Call(0, 0, uintptr(unsafe.Pointer(mutexName))); m != 0 && lastErr == syscall.Errno(183) {
		// Already running (for example, started at sign-in).
		messageBox.Call(0, uintptr(unsafe.Pointer(textPtr("winss132r unattended access is already running.\n\nClick its icon in the notification area to see the status or to initiate a session."))),
			uintptr(unsafe.Pointer(textPtr("winss132r"))), 0x40) // MB_ICONINFORMATION
		return nil
	}
	const (
		initiateItem = 300
		stopItem     = 301
		disableItem  = 302
		exitItem     = 303
	)
	code := formatCode(standingCode(config.Key))
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
	worker := make(chan struct{})

	instance, _, _ := getModule.Call(0)
	trayCreated, _, _ := registerWindowMessage.Call(uintptr(unsafe.Pointer(textPtr("TaskbarCreated"))))

	state := "ready"
	detail := "Connecting to the relay…"
	connections := 0
	disabling := false
	tray := notifyIconData{id: 1, flags: 0x1 | 0x2 | 0x4, callback: trayMessage} // NIF_MESSAGE|NIF_ICON|NIF_TIP
	tray.size = uint32(unsafe.Sizeof(tray))
	current := func() look {
		switch state {
		case "connected":
			return look{green, "winss132r — " + connectStatus(connections)}
		case "calling":
			return look{blue, "winss132r — Request sent, waiting for IT"}
		case "offline":
			return look{amber, "winss132r — Cannot reach the relay"}
		case "locked":
			return look{blue, "winss132r — PC locked"}
		}
		return look{blue, "winss132r — Ready"}
	}
	setTray := func(action uintptr) {
		l := current()
		tray.icon = l.icon
		tray.tip = [128]uint16{}
		tip, _ := syscall.UTF16FromString(l.tip)
		copy(tray.tip[:len(tray.tip)-1], tip)
		shellNotifyIcon.Call(action, uintptr(unsafe.Pointer(&tray)))
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
		item(mfGrayed, 0, headline)
		item(mfGrayed, 0, detail)
		item(mfGrayed, 0, "Access code: "+code)
		item(mfGrayed, 0, "Connections since start: "+twoDigits(connections))
		item(mfSeparator, 0, "")
		if state == "ready" {
			item(mfString, initiateItem, "Initiate — ask IT to connect")
		} else {
			item(mfGrayed, initiateItem, "Initiate — ask IT to connect")
		}
		if state == "connected" {
			item(mfString, stopItem, "Stop current session")
		} else {
			item(mfGrayed, stopItem, "Stop current session")
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
			case 0x0202, 0x0205: // WM_LBUTTONUP, WM_RBUTTONUP
				showMenu(window)
			}
			return 0
		case 0x0010: // WM_CLOSE: keep running in the notification area; Exit quits.
			return 0
		case 0x0002: // WM_DESTROY
			cancel()
			shellNotifyIcon.Call(2, uintptr(unsafe.Pointer(&tray))) // NIM_DELETE
			quitMessage.Call(0)
			return 0
		case 0x0111: // WM_COMMAND from the menu
			switch wParam & 0xffff {
			case initiateItem:
				if state == "ready" {
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
			case disableItem:
				if ask(window, "Turn off unattended access?\n\nIT will no longer be able to connect without your approval, and this access code stops working. Turning it on again creates a new code.") {
					disabling = true
					destroyWindow.Call(window)
				}
			case exitItem:
				if ask(window, "Exit winss132r?\n\nAny remote session ends. Unattended access stays on and starts again the next time you sign in.") {
					destroyWindow.Call(window)
				}
			}
			return 0
		case 0x0113: // WM_TIMER
			changed := false
		drain:
			for {
				select {
				case next := <-updates:
					if next.state == "connected" && state != "connected" {
						connections++
					}
					state = next.state
					detail = next.text
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
	window, _, _ := createWindow.Call(0x80, uintptr(unsafe.Pointer(className)), uintptr(unsafe.Pointer(textPtr("winss132r"))), // WS_EX_TOOLWINDOW
		0, 0, 0, 0, 0, 0, 0, instance, 0)
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
		balloon := tray
		balloon.flags = 0x10 // NIF_INFO
		info, _ := syscall.UTF16FromString("Unattended access is on. Click this icon for the status, the access code, or Initiate.")
		copy(balloon.info[:len(balloon.info)-1], info)
		title, _ := syscall.UTF16FromString("winss132r")
		copy(balloon.infoTitle[:len(balloon.infoTitle)-1], title)
		balloon.infoFlags = 0x1 // NIIF_INFO
		shellNotifyIcon.Call(1, uintptr(unsafe.Pointer(&balloon)))
	}

	hostName, _ := os.Hostname()
	go func() {
		defer close(worker)
		serveUnattended(ctx, config.Relay, config.Key, hostName, stopSession, initiate, updates)
	}()

	var msg indicatorMessage
	for {
		r, _, _ := getWindowMessage.Call(uintptr(unsafe.Pointer(&msg)), 0, 0, 0)
		if int32(r) <= 0 {
			break
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
