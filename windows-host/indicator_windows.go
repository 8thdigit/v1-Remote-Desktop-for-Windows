package main

import (
	"context"
	"errors"
	"runtime"
	"syscall"
	"unsafe"
)

var (
	registerClass    = user.NewProc("RegisterClassW")
	unregisterClass  = user.NewProc("UnregisterClassW")
	createWindow     = user.NewProc("CreateWindowExW")
	destroyWindow    = user.NewProc("DestroyWindow")
	defaultWindow    = user.NewProc("DefWindowProcW")
	showWindow       = user.NewProc("ShowWindow")
	isWindowVisible  = user.NewProc("IsWindowVisible")
	isIconic         = user.NewProc("IsIconic")
	setWindowTimer   = user.NewProc("SetTimer")
	getWindowMessage = user.NewProc("GetMessageW")
	dispatchMessage  = user.NewProc("DispatchMessageW")
	translateMessage = user.NewProc("TranslateMessage")
	sendWindow       = user.NewProc("SendMessageW")
	quitMessage      = user.NewProc("PostQuitMessage")
	getStockObject   = gdi.NewProc("GetStockObject")
	getModule        = syscall.NewLazyDLL("kernel32.dll").NewProc("GetModuleHandleW")
)

type indicatorClass struct {
	style                         uint32
	procedure                     uintptr
	classExtra, windowExtra       int32
	instance, icon, cursor, brush uintptr
	menu, name                    *uint16
}

type indicatorMessage struct {
	window         uintptr
	message        uint32
	wParam, lParam uintptr
	time           uint32
	x, y           int32
	private        uint32
}

// The host only starts capture after the separate, topmost indicator is shown.
// Closing it, or losing the indicator's message loop, cancels the session.
func showSharingIndicator(ctx context.Context, stop context.CancelFunc, ready chan<- error) {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	defer stop()
	indicatorError := errors.New("could not show the sharing indicator; no screen was shared")
	if ctx.Err() != nil {
		ready <- ctx.Err()
		return
	}
	const stopButton = 100
	proc := syscall.NewCallback(func(window, msg, wParam, lParam uintptr) uintptr {
		switch msg {
		case 0x0111: // WM_COMMAND
			if wParam == stopButton {
				stop()
				destroyWindow.Call(window)
				return 0
			}
		case 0x0010: // WM_CLOSE
			stop()
			destroyWindow.Call(window)
			return 0
		case 0x0002: // WM_DESTROY
			stop()
			quitMessage.Call(0)
			return 0
		case 0x0113: // WM_TIMER
			visible, _, _ := isWindowVisible.Call(window)
			minimized, _, _ := isIconic.Call(window)
			if ctx.Err() != nil || visible == 0 || minimized != 0 {
				destroyWindow.Call(window)
			}
			return 0
		}
		result, _, _ := defaultWindow.Call(window, msg, wParam, lParam)
		return result
	})
	const className = "MsfwrSharingIndicator"
	instance, _, _ := getModule.Call(0)
	cursor, _, _ := user.NewProc("LoadCursorW").Call(0, 32512)
	class := indicatorClass{procedure: proc, instance: instance, cursor: cursor, brush: 16, name: syscall.StringToUTF16Ptr(className)}
	if atom, _, _ := registerClass.Call(uintptr(unsafe.Pointer(&class))); atom == 0 {
		ready <- indicatorError
		return
	}
	defer func() { unregisterClass.Call(uintptr(unsafe.Pointer(class.name)), instance) }()

	dpiProc := user.NewProc("GetDpiForSystem")
	dpi := uintptr(96)
	if dpiProc.Find() == nil {
		if value, _, _ := dpiProc.Call(); value > 0 {
			dpi = value
		}
	}
	scale := func(n uintptr) uintptr { return n * dpi / 96 }
	title := syscall.StringToUTF16Ptr("Connect.AI — Live sharing")
	// WS_EX_TOOLWINDOW (0x80): the live-sharing indicator never shows a taskbar
	// button; it is only the small topmost on-screen notice.
	window, _, _ := createWindow.Call(
		0x80, uintptr(unsafe.Pointer(class.name)), uintptr(unsafe.Pointer(title)), 0x80c80000,
		scale(16), scale(16), scale(350), scale(145), 0, 0, instance, 0,
	)
	if window == 0 {
		ready <- indicatorError
		return
	}
	defer func() {
		if visible, _, _ := isWindowVisible.Call(window); visible != 0 {
			destroyWindow.Call(window)
		}
	}()
	staticClass := syscall.StringToUTF16Ptr("STATIC")
	caption := syscall.StringToUTF16Ptr("Screen sharing and remote control are active.")
	label, _, _ := createWindow.Call(
		0, uintptr(unsafe.Pointer(staticClass)), uintptr(unsafe.Pointer(caption)),
		0x50000000, scale(12), scale(12), scale(313), scale(29), window, 0, instance, 0,
	)
	buttonClass := syscall.StringToUTF16Ptr("BUTTON")
	buttonText := syscall.StringToUTF16Ptr("Stop sharing (Ctrl+2)")
	button, _, _ := createWindow.Call(
		0, uintptr(unsafe.Pointer(buttonClass)), uintptr(unsafe.Pointer(buttonText)),
		0x50010000, scale(12), scale(47), scale(175), scale(31), window, stopButton, instance, 0,
	)
	if label == 0 || button == 0 {
		destroyWindow.Call(window)
		ready <- indicatorError
		return
	}
	font, _, _ := getStockObject.Call(17)
	sendWindow.Call(label, 0x0030, font, 1)
	sendWindow.Call(button, 0x0030, font, 1)
	if timer, _, _ := setWindowTimer.Call(window, 1, 125, 0); timer == 0 {
		destroyWindow.Call(window)
		ready <- indicatorError
		return
	}
	showWindow.Call(window, 4) // Show without stealing the Windows user's focus.
	if visible, _, _ := isWindowVisible.Call(window); visible == 0 {
		destroyWindow.Call(window)
		ready <- indicatorError
		return
	}
	ready <- nil
	var msg indicatorMessage
	for {
		n, _, _ := getWindowMessage.Call(uintptr(unsafe.Pointer(&msg)), 0, 0, 0)
		if int32(n) <= 0 {
			return
		}
		translateMessage.Call(uintptr(unsafe.Pointer(&msg)))
		dispatchMessage.Call(uintptr(unsafe.Pointer(&msg)))
	}
}
