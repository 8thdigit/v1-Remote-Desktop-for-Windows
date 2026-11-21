package main

import (
	"context"
	"errors"
	"os"
	"strconv"
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
	findWindow        = user.NewProc("FindWindowW")
	setForeground     = user.NewProc("SetForegroundWindow")
	messageBox        = user.NewProc("MessageBoxW")
	createIconInfo    = user.NewProc("CreateIconIndirect")
	destroyIcon       = user.NewProc("DestroyIcon")
	createBitmap      = gdi.NewProc("CreateBitmap")
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

// dotIcon draws a filled circle so the state is readable at a glance on the
// taskbar and in the notification area.
func dotIcon(size int, rgb uint32) uintptr {
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
	pixels := unsafe.Slice((*uint32)(bits), size*size)
	radius := float64(size) / 2
	edge := (rgb >> 1) & 0x7f7f7f
	for y := 0; y < size; y++ {
		for x := 0; x < size; x++ {
			dx, dy := float64(x)+0.5-radius, float64(y)+0.5-radius
			d := dx*dx + dy*dy
			switch {
			case d <= (radius-1.5)*(radius-1.5):
				pixels[y*size+x] = 0xff000000 | rgb
			case d <= (radius-0.25)*(radius-0.25):
				pixels[y*size+x] = 0xff000000 | edge
			default:
				pixels[y*size+x] = 0
			}
		}
	}
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

// runUnattended shows the unattended status window, minimized on the
// taskbar, plus a notification-area icon. Both turn red while a remote
// session is live. It never opens an approval prompt or a pop-up during a
// session. It returns when the user exits or turns unattended access off.
func runUnattended(configPath string, config unattendedConfig) error {
	mutexName := textPtr(`Local\winss132r-unattended`)
	if m, _, lastErr := createMutex.Call(0, 0, uintptr(unsafe.Pointer(mutexName))); m != 0 && lastErr == syscall.Errno(183) {
		// Already running (for example, started at sign-in): show that window.
		if existing, _, _ := findWindow.Call(uintptr(unsafe.Pointer(textPtr(unattendedClass))), 0); existing != 0 {
			showWindow.Call(existing, 9)
			setForeground.Call(existing)
		}
		return nil
	}
	const (
		stopButton    = 301
		disableButton = 302
		exitButton    = 303
	)
	code := formatCode(standingCode(config.Key))
	small, big := metric(49), metric(11)
	type look struct {
		small, big uintptr
		title, tip string
	}
	looks := map[string]look{
		"ready":     {dotIcon(small, 0x2563eb), dotIcon(big, 0x2563eb), "winss132r — Unattended access: ready", "winss132r: ready, no one connected"},
		"connected": {dotIcon(small, 0xdc2626), dotIcon(big, 0xdc2626), "winss132r — LIVE: IT is connected", "winss132r: IT is CONNECTED to this PC"},
		"offline":   {dotIcon(small, 0xd97706), dotIcon(big, 0xd97706), "winss132r — Unattended access: relay offline", "winss132r: cannot reach the relay"},
	}
	looks["locked"] = look{looks["ready"].small, looks["ready"].big, "winss132r — Unattended access: PC locked", "winss132r: PC locked, not connected"}
	defer func() {
		for name, l := range looks {
			if name != "locked" {
				destroyIcon.Call(l.small)
				destroyIcon.Call(l.big)
			}
		}
	}()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	updates := make(chan unattendedUpdate, 16)
	stopSession := make(chan struct{}, 1)
	worker := make(chan struct{})

	instance, _, _ := getModule.Call(0)
	cursor, _, _ := user.NewProc("LoadCursorW").Call(0, 32512)
	taskbarMessage, _, _ := registerWindowMessage.Call(uintptr(unsafe.Pointer(textPtr("TaskbarButtonCreated"))))
	trayCreated, _, _ := registerWindowMessage.Call(uintptr(unsafe.Pointer(textPtr("TaskbarCreated"))))
	overlay := newTaskbarOverlay()
	defer func() { overlay.close() }()
	liveDescription := textPtr("IT is connected to this PC")
	taskbarReady := false

	var statusText, countText, stopCtl uintptr
	state := "ready"
	connections := 0
	disabling := false
	tray := notifyIconData{id: 1, flags: 0x1 | 0x2 | 0x4, callback: trayMessage} // NIF_MESSAGE|NIF_ICON|NIF_TIP
	tray.size = uint32(unsafe.Sizeof(tray))
	setTray := func(action uintptr) {
		l := looks[state]
		tray.icon = l.small
		tray.tip = [128]uint16{}
		tip, _ := syscall.UTF16FromString(l.tip)
		copy(tray.tip[:len(tray.tip)-1], tip)
		shellNotifyIcon.Call(action, uintptr(unsafe.Pointer(&tray)))
	}
	apply := func(window uintptr) {
		l := looks[state]
		setText(window, l.title)
		sendWindow.Call(window, 0x0080, 0, l.small) // WM_SETICON small
		sendWindow.Call(window, 0x0080, 1, l.big)   // WM_SETICON big
		if taskbarReady {
			if state == "connected" {
				overlay.set(window, l.small, liveDescription)
			} else {
				overlay.set(window, 0, nil)
			}
		}
		setTray(1) // NIM_MODIFY
		enable(stopCtl, state == "connected")
		setText(countText, "Connections since this app started: "+strconv.Itoa(connections))
	}

	proc := syscall.NewCallback(func(window, msg, wParam, lParam uintptr) uintptr {
		if taskbarMessage != 0 && msg == taskbarMessage {
			taskbarReady = true
			apply(window)
			return 0
		}
		if trayCreated != 0 && msg == trayCreated { // Explorer restarted.
			setTray(0)
			return 0
		}
		switch msg {
		case trayMessage:
			switch lParam & 0xffff {
			case 0x0202, 0x0205: // WM_LBUTTONUP, WM_RBUTTONUP
				showWindow.Call(window, 9) // SW_RESTORE
				setForeground.Call(window)
			}
			return 0
		case 0x0010: // WM_CLOSE: keep running on the taskbar; Exit quits.
			showWindow.Call(window, 6)
			return 0
		case 0x0002: // WM_DESTROY
			cancel()
			shellNotifyIcon.Call(2, uintptr(unsafe.Pointer(&tray))) // NIM_DELETE
			quitMessage.Call(0)
			return 0
		case 0x0111: // WM_COMMAND
			if wParam>>16 != 0 || lParam == 0 {
				break
			}
			switch wParam & 0xffff {
			case stopButton:
				select {
				case stopSession <- struct{}{}:
				default:
				}
			case disableButton:
				if ask(window, "Turn off unattended access?\n\nIT will no longer be able to connect without your approval, and this access code stops working. Turning it on again creates a new code.") {
					disabling = true
					destroyWindow.Call(window)
				}
			case exitButton:
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
					setText(statusText, next.text)
					changed = true
				default:
					break drain
				}
			}
			if changed {
				apply(window)
			}
			return 0
		}
		result, _, _ := defaultWindow.Call(window, msg, wParam, lParam)
		return result
	})

	windowError := errors.New("could not open the unattended access window")
	className := textPtr(unattendedClass)
	class := indicatorClass{procedure: proc, instance: instance, icon: looks["ready"].big, cursor: cursor, brush: 16, name: className}
	if atom, _, _ := registerClass.Call(uintptr(unsafe.Pointer(&class))); atom == 0 {
		return windowError
	}
	dpi := uintptr(96)
	if p := user.NewProc("GetDpiForSystem"); p.Find() == nil {
		if value, _, _ := p.Call(); value != 0 {
			dpi = value
		}
	}
	px := func(n uintptr) uintptr { return n * dpi / 96 }
	window, _, _ := createWindow.Call(0, uintptr(unsafe.Pointer(className)), uintptr(unsafe.Pointer(textPtr(looks["ready"].title))),
		0x00ca0000, 0x80000000, 0x80000000, px(520), px(330), 0, 0, instance, 0)
	if window == 0 {
		return windowError
	}
	font, _, _ := getStockObject.Call(17)
	failed := false
	add := func(kind, text string, style, x, y, width, height, id uintptr) uintptr {
		child, _, _ := createWindow.Call(0, uintptr(unsafe.Pointer(textPtr(kind))), uintptr(unsafe.Pointer(textPtr(text))),
			0x50000000|style, px(x), px(y), px(width), px(height), window, id, instance, 0)
		if child == 0 {
			failed = true
		} else {
			sendWindow.Call(child, 0x0030, font, 1)
		}
		return child
	}
	add("STATIC", "Unattended access is ON. IT can connect to this PC with the saved code without asking you. This icon turns red while someone is connected.", 0, 20, 16, 470, 44, 0)
	add("STATIC", "Access code", 0, 20, 70, 150, 22, 0)
	add("EDIT", code, 0x00800880, 20, 94, 200, 27, 0) // read-only, bordered
	add("STATIC", "Relay: "+config.Relay, 0, 236, 98, 254, 22, 0)
	statusText = add("STATIC", "Connecting to the relay…", 0, 20, 136, 470, 44, 0)
	countText = add("STATIC", "", 0, 20, 184, 470, 22, 0)
	stopCtl = add("BUTTON", "Stop current session", 0x10000, 20, 222, 160, 32, stopButton)
	add("BUTTON", "Turn off unattended access", 0x10000, 190, 222, 190, 32, disableButton)
	add("BUTTON", "Exit", 0x10000, 390, 222, 100, 32, exitButton)
	timer, _, _ := setWindowTimer.Call(window, 1, 100, 0)
	if failed || timer == 0 {
		destroyWindow.Call(window)
		return windowError
	}
	tray.window = window
	setTray(0) // NIM_ADD
	apply(window)
	showWindow.Call(window, 7) // SW_SHOWMINNOACTIVE: taskbar button only, no pop-up.

	go func() {
		defer close(worker)
		serveUnattended(ctx, config.Relay, config.Key, stopSession, updates)
	}()

	var msg indicatorMessage
	for {
		r, _, _ := getWindowMessage.Call(uintptr(unsafe.Pointer(&msg)), 0, 0, 0)
		if int32(r) <= 0 {
			break
		}
		if handled, _, _ := isDialogMessage.Call(window, uintptr(unsafe.Pointer(&msg))); handled == 0 {
			translateMessage.Call(uintptr(unsafe.Pointer(&msg)))
			dispatchMessage.Call(uintptr(unsafe.Pointer(&msg)))
		}
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
