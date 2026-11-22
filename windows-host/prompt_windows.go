package main

import (
	"sync"
	"syscall"
	"unsafe"
)

// promptText shows a small modal window with one text box, for settings
// changed from the notification-area menu (which has no window of its own).
// It returns the text and true when the user selects OK.

type promptState struct {
	window, edit uintptr
	done, ok     bool
	value        string
}

var (
	promptOnce   sync.Once
	promptAtom   uintptr
	activePrompt *promptState
)

const promptClass = "Winss132rPrompt"

func registerPrompt() {
	proc := syscall.NewCallback(func(window, msg, wParam, lParam uintptr) uintptr {
		p := activePrompt
		switch msg {
		case 0x0111: // WM_COMMAND
			if p != nil && lParam != 0 {
				switch wParam & 0xffff {
				case 1: // IDOK
					p.value = editText(p.edit)
					p.ok = true
					destroyWindow.Call(window)
				case 2: // IDCANCEL
					destroyWindow.Call(window)
				}
			}
			return 0
		case 0x0010: // WM_CLOSE
			destroyWindow.Call(window)
			return 0
		case 0x0002: // WM_DESTROY
			if p != nil {
				p.done = true
			}
			return 0
		}
		result, _, _ := defaultWindow.Call(window, msg, wParam, lParam)
		return result
	})
	instance, _, _ := getModule.Call(0)
	cursor, _, _ := user.NewProc("LoadCursorW").Call(0, 32512)
	class := indicatorClass{procedure: proc, instance: instance, cursor: cursor, brush: 16, name: textPtr(promptClass)}
	promptAtom, _, _ = registerClass.Call(uintptr(unsafe.Pointer(&class)))
}

func promptText(owner uintptr, title, label, initial string) (string, bool) {
	promptOnce.Do(registerPrompt)
	if promptAtom == 0 || activePrompt != nil {
		return "", false
	}
	dpi := uintptr(96)
	if p := user.NewProc("GetDpiForSystem"); p.Find() == nil {
		if value, _, _ := p.Call(); value != 0 {
			dpi = value
		}
	}
	px := func(n uintptr) uintptr { return n * dpi / 96 }
	instance, _, _ := getModule.Call(0)
	window, _, _ := createWindow.Call(0x8|0x1, uintptr(unsafe.Pointer(textPtr(promptClass))), uintptr(unsafe.Pointer(textPtr(title))), // WS_EX_TOPMOST|WS_EX_DLGMODALFRAME
		0x00c80000, 0x80000000, 0x80000000, px(440), px(200), owner, 0, instance, 0) // WS_CAPTION|WS_SYSMENU
	if window == 0 {
		return "", false
	}
	state := &promptState{window: window}
	activePrompt = state
	defer func() { activePrompt = nil }()
	font, _, _ := getStockObject.Call(17)
	add := func(kind, text string, style, x, y, w, h, id uintptr) uintptr {
		child, _, _ := createWindow.Call(0, uintptr(unsafe.Pointer(textPtr(kind))), uintptr(unsafe.Pointer(textPtr(text))),
			0x50000000|style, px(x), px(y), px(w), px(h), window, id, instance, 0)
		if child != 0 {
			sendWindow.Call(child, 0x0030, font, 1)
		}
		return child
	}
	add("STATIC", label, 0, 16, 14, 400, 40, 0)
	state.edit = add("EDIT", initial, 0x00810080, 16, 60, 392, 26, 0) // WS_BORDER|WS_TABSTOP|ES_AUTOHSCROLL
	sendWindow.Call(state.edit, 0x00c5, 32, 0)                        // EM_LIMITTEXT
	add("BUTTON", "OK", 0x10001, 222, 102, 90, 30, 1)                 // WS_TABSTOP|BS_DEFPUSHBUTTON
	add("BUTTON", "Cancel", 0x10000, 318, 102, 90, 30, 2)
	showWindow.Call(window, 1)
	setForeground.Call(window)
	setFocus.Call(state.edit)
	sendWindow.Call(state.edit, 0x00b1, 0, ^uintptr(0)) // EM_SETSEL: select all
	var msg indicatorMessage
	for !state.done {
		r, _, _ := getWindowMessage.Call(uintptr(unsafe.Pointer(&msg)), 0, 0, 0)
		if int32(r) <= 0 {
			if int32(r) == 0 {
				quitMessage.Call(msg.wParam) // Pass WM_QUIT on to the outer loop.
			}
			destroyWindow.Call(window)
			break
		}
		if handled, _, _ := isDialogMessage.Call(window, uintptr(unsafe.Pointer(&msg))); handled == 0 {
			translateMessage.Call(uintptr(unsafe.Pointer(&msg)))
			dispatchMessage.Call(uintptr(unsafe.Pointer(&msg)))
		}
	}
	return state.value, state.ok
}
