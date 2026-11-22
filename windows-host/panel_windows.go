package main

import (
	"errors"
	"syscall"
	"unsafe"
)

// Command ids shared by the notification-area menu and the Msfwr window.
// The window forwards its button clicks to the notification-area window as
// WM_COMMAND, so both surfaces run exactly the same actions.
const (
	initiateItem = 300
	stopItem     = 301
	disableItem  = 302
	exitItem     = 303
	copyItem     = 304
	createLink   = 305 // lParam: validity in hours
	openItem     = 306

	copyLinkButton  = 600 // copy the remote access URL and its access code
	clearLinkButton = 601 // clear the remote access URL
	hideButton      = 602 // window only: hide the window
	saveRAButton    = 603 // save the RA ID typed in the window
	validityList    = 604 // window only: how long a new URL stays valid
)

const panelClass = "MsfwrPanel"

// panelView is everything the Msfwr window shows. runUnattended builds it
// from its own state each time something changes and once a second while
// the window is open.
type panelView struct {
	state, headline, detail string
	code, pcName, relay     string
	active, count           string
	history                 []string
	ra, raText              string     // RA ID as RA-123456, and where it points
	link                    *savedLink // the remote access URL, nil when none
	linkText, linkNote      string
	linkBusy                bool // a create or clear is running
}

// controlPanel is the Msfwr window: status, access code, controls, active
// connections and version. It runs on the notification-area thread, so it
// shares that message loop; closing it only hides it.
type controlPanel struct {
	window, tray uintptr
	render       func() panelView

	headline, detail, pc, relay, code      uintptr
	ra, raText                             uintptr
	active, count, history                 uintptr
	initiate, stop                         uintptr
	linkURL, linkPin, linkText, linkNote   uintptr
	validity, newLink, copyLink, clearLink uintptr
	lastHistory                            []string
	raShown                                string
}

var (
	lbAddString     = uintptr(0x0180)
	lbResetContent  = uintptr(0x0184)
	lbSetHorizontal = uintptr(0x0194)
	cbAddString     = uintptr(0x0143)
	cbGetCurSel     = uintptr(0x0147)
	cbSetCurSel     = uintptr(0x014E)
)

// newControlPanel creates the window hidden. tray is the notification-area
// window that runs the commands.
func newControlPanel(instance, tray uintptr, render func() panelView) (*controlPanel, error) {
	p := &controlPanel{tray: tray, render: render}
	panelError := errors.New("could not create the Msfwr window")
	dpi := uintptr(96)
	if proc := user.NewProc("GetDpiForSystem"); proc.Find() == nil {
		if value, _, _ := proc.Call(); value != 0 {
			dpi = value
		}
	}
	px := func(n uintptr) uintptr { return n * dpi / 96 }

	proc := syscall.NewCallback(func(window, msg, wParam, lParam uintptr) uintptr {
		switch msg {
		case 0x0010: // WM_CLOSE: hide; unattended access keeps running from the icon.
			showWindow.Call(window, 0)
			return 0
		case 0x0111: // WM_COMMAND
			if wParam>>16 != 0 { // notifications such as CBN_SELCHANGE
				return 0
			}
			switch id := wParam & 0xffff; id {
			case hideButton:
				showWindow.Call(window, 0)
			case createLink:
				postMessage.Call(p.tray, 0x0111, id, uintptr(p.hours()))
			case initiateItem, stopItem, copyItem, copyLinkButton, clearLinkButton, saveRAButton, disableItem, exitItem:
				postMessage.Call(p.tray, 0x0111, id, 0)
			}
			return 0
		case 0x0113: // WM_TIMER: keep the session duration and link expiry current.
			if visible, _, _ := isWindowVisible.Call(window); visible != 0 {
				p.update()
			}
			return 0
		}
		result, _, _ := defaultWindow.Call(window, msg, wParam, lParam)
		return result
	})
	cursor, _, _ := user.NewProc("LoadCursorW").Call(0, 32512)
	icon, _, _ := user.NewProc("LoadIconW").Call(0, 32512) // IDI_APPLICATION
	class := indicatorClass{procedure: proc, instance: instance, cursor: cursor, icon: icon, brush: 16, name: textPtr(panelClass)}
	if atom, _, _ := registerClass.Call(uintptr(unsafe.Pointer(&class))); atom == 0 {
		return nil, panelError
	}
	// WS_EX_TOOLWINDOW (0x80) with WS_CAPTION|WS_SYSMENU, fixed size: Msfwr
	// never shows a taskbar button. There is no minimize box because a tool
	// window would minimize to the desktop corner; Close and Hide hide it, and
	// the tray icon or the Start shortcut brings it back.
	window, _, _ := createWindow.Call(0x80, uintptr(unsafe.Pointer(class.name)), uintptr(unsafe.Pointer(textPtr("Msfwr"))),
		0x00ca0000, 0x80000000, 0x80000000, px(600), px(700), 0, 0, instance, 0)
	if window == 0 {
		return nil, panelError
	}
	p.window = window
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
	const (
		group    = 0x7     // BS_GROUPBOX
		tab      = 0x10000 // WS_TABSTOP
		readOnly = 0x00800880
		listBox  = 0x00800000 | 0x00200000 | 0x00100000 | 0x100 | 0x1 | tab // WS_BORDER|WS_VSCROLL|WS_HSCROLL|LBS_NOINTEGRALHEIGHT|LBS_NOTIFY
	)
	const (
		comboList = 0x3 | 0x00200000 | tab // CBS_DROPDOWNLIST|WS_VSCROLL
		editField = 0x00800080 | tab       // WS_BORDER|ES_AUTOHSCROLL
	)
	add("BUTTON", "Status", group, 12, 8, 560, 112, 0)
	p.headline = add("STATIC", "", 0, 26, 30, 532, 20, 0)
	p.detail = add("STATIC", "", 0, 26, 52, 532, 36, 0)
	p.pc = add("STATIC", "", 0, 26, 92, 200, 20, 0)
	p.relay = add("STATIC", "", 0, 230, 92, 328, 20, 0)

	add("BUTTON", "Access code and RA ID", group, 12, 126, 560, 92, 0)
	p.code = add("EDIT", "", readOnly, 26, 150, 170, 26, 0)
	add("BUTTON", "Copy access code", tab, 204, 148, 130, 30, copyItem)
	add("STATIC", "RA ID:", 0, 346, 155, 40, 20, 0)
	p.ra = add("EDIT", "", editField, 388, 150, 90, 26, 0)
	add("BUTTON", "Save", tab, 484, 148, 74, 30, saveRAButton)
	p.raText = add("STATIC", "", 0, 26, 186, 532, 20, 0)

	add("BUTTON", "Controls", group, 12, 224, 560, 62, 0)
	p.initiate = add("BUTTON", "Initiate: ask IT to connect", tab, 26, 246, 200, 30, initiateItem)
	p.stop = add("BUTTON", "Stop current session", tab, 234, 246, 160, 30, stopItem)

	add("BUTTON", "Remote access URL", group, 12, 292, 560, 134, 0)
	p.linkURL = add("EDIT", "", readOnly, 26, 316, 416, 26, 0)
	p.copyLink = add("BUTTON", "Copy URL", tab, 450, 314, 108, 30, copyLinkButton)
	add("STATIC", "Access code:", 0, 26, 353, 76, 20, 0)
	p.linkPin = add("EDIT", "", readOnly, 104, 348, 90, 26, 0)
	add("STATIC", "Valid for:", 0, 206, 353, 56, 20, 0)
	p.validity = add("COMBOBOX", "", comboList, 264, 348, 100, 240, validityList)
	p.newLink = add("BUTTON", "Create URL", tab, 372, 346, 120, 30, createLink)
	p.clearLink = add("BUTTON", "Clear", tab, 498, 346, 60, 30, clearLinkButton)
	p.linkText = add("STATIC", "", 0, 26, 382, 532, 18, 0)
	p.linkNote = add("STATIC", "", 0, 26, 402, 532, 18, 0)

	add("BUTTON", "Connections", group, 12, 432, 560, 170, 0)
	p.active = add("STATIC", "", 0, 26, 454, 532, 20, 0)
	p.count = add("STATIC", "", 0, 26, 476, 532, 20, 0)
	add("STATIC", "Recent sessions (since Msfwr started)", 0, 26, 500, 532, 18, 0)
	p.history = add("LISTBOX", "", listBox, 26, 520, 532, 70, 0)

	add("STATIC", versionText(), 0, 14, 622, 230, 20, 0)
	add("BUTTON", "Turn off unattended…", tab, 250, 614, 150, 30, disableItem)
	add("BUTTON", "Hide", tab, 408, 614, 76, 30, hideButton)
	add("BUTTON", "Exit", tab, 492, 614, 80, 30, exitItem)
	if failed {
		destroyWindow.Call(window)
		return nil, panelError
	}
	sendWindow.Call(p.history, lbSetHorizontal, px(900), 0)
	for _, hours := range linkHoursList {
		sendWindow.Call(p.validity, cbAddString, 0, uintptr(unsafe.Pointer(textPtr(formatValidity(hours)))))
	}
	for i, hours := range linkHoursList {
		if hours == defaultLinkHours {
			sendWindow.Call(p.validity, cbSetCurSel, uintptr(i), 0)
		}
	}
	if timer, _, _ := setWindowTimer.Call(window, 1, 1000, 0); timer == 0 {
		destroyWindow.Call(window)
		return nil, panelError
	}
	return p, nil
}

// show opens the window (or restores it) and brings it to the front.
func (p *controlPanel) show() {
	p.update()
	if minimized, _, _ := isIconic.Call(p.window); minimized != 0 {
		showWindow.Call(p.window, 9) // SW_RESTORE
	} else {
		showWindow.Call(p.window, 5) // SW_SHOW
	}
	setForeground.Call(p.window)
}

// visible reports whether the window is open, so dialogs can use it as owner.
func (p *controlPanel) visible() bool {
	if p == nil {
		return false
	}
	v, _, _ := isWindowVisible.Call(p.window)
	return v != 0
}

func (p *controlPanel) update() {
	if p == nil {
		return
	}
	v := p.render()
	setText(p.headline, v.headline)
	setText(p.detail, v.detail)
	setText(p.pc, "This PC: "+v.pcName)
	setText(p.relay, "Relay: "+v.relay)
	if editText(p.code) != v.code {
		setText(p.code, v.code)
	}
	// Fill the RA ID box when it changes, but never while the user types.
	if v.ra != p.raShown {
		setText(p.ra, v.ra)
		p.raShown = v.ra
	}
	setText(p.raText, v.raText)
	setText(p.active, v.active)
	setText(p.count, v.count)
	enable(p.initiate, v.state == "ready" || v.state == "calling")
	if v.state == "calling" {
		setText(p.initiate, "Initiate again: resend request")
	} else {
		setText(p.initiate, "Initiate: ask IT to connect")
	}
	enable(p.stop, v.state == "connected")
	if !sameLines(v.history, p.lastHistory) {
		fillList(p.history, v.history, "No sessions yet.")
		p.lastHistory = v.history
	}
	url, pin := "", ""
	if v.link != nil {
		url, pin = v.link.shareURL(), v.link.Pin
		setText(p.newLink, "Create new URL")
	} else {
		setText(p.newLink, "Create URL")
	}
	if editText(p.linkURL) != url {
		setText(p.linkURL, url)
	}
	if editText(p.linkPin) != pin {
		setText(p.linkPin, pin)
	}
	setText(p.linkText, v.linkText)
	setText(p.linkNote, v.linkNote)
	enable(p.newLink, !v.linkBusy && v.state != "connected")
	enable(p.validity, !v.linkBusy)
	enable(p.copyLink, !v.linkBusy && v.link != nil)
	enable(p.clearLink, !v.linkBusy && v.link != nil)
}

// hours is the validity chosen in the list, 24 hours unless changed.
func (p *controlPanel) hours() int {
	i, _, _ := sendWindow.Call(p.validity, cbGetCurSel, 0, 0)
	if int32(i) < 0 || int(i) >= len(linkHoursList) {
		return defaultLinkHours
	}
	return linkHoursList[i]
}

func fillList(list uintptr, lines []string, empty string) {
	sendWindow.Call(list, lbResetContent, 0, 0)
	if len(lines) == 0 {
		sendWindow.Call(list, lbAddString, 0, uintptr(unsafe.Pointer(textPtr(empty))))
		return
	}
	for _, line := range lines {
		sendWindow.Call(list, lbAddString, 0, uintptr(unsafe.Pointer(textPtr(line))))
	}
}
