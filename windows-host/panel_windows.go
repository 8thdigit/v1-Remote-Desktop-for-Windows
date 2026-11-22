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
	createLink   = 305
	openItem     = 306
	linkBase     = 400 // linkBase+2*i = copy URL i, linkBase+2*i+1 = revoke URL i
	maxMenuLinks = 8
	stopAllItem  = 500

	copyLinkButton   = 600 // window only: copy the selected URL
	revokeLinkButton = 601 // window only: revoke the selected URL
	hideButton       = 602 // window only: hide to the notification area
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
	links                   []linkEntry
}

// controlPanel is the Msfwr window: status, access code, controls, active
// connections and version. It runs on the notification-area thread, so it
// shares that message loop; closing it only hides it.
type controlPanel struct {
	window, tray uintptr
	render       func() panelView

	headline, detail, pc, relay, code         uintptr
	active, count, history, links, linksLabel uintptr
	initiate, stop, copyLink, revoke, newLink uintptr
	lastHistory, lastLinks                    []string
}

var (
	lbAddString     = uintptr(0x0180)
	lbResetContent  = uintptr(0x0184)
	lbSetCurSel     = uintptr(0x0186)
	lbGetCurSel     = uintptr(0x0188)
	lbSetHorizontal = uintptr(0x0194)
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
			if wParam>>16 != 0 { // notifications such as LBN_SELCHANGE
				if wParam>>16 == 1 && lParam == p.links { // LBN_SELCHANGE
					p.enableLinkButtons()
				}
				return 0
			}
			switch id := wParam & 0xffff; id {
			case hideButton:
				showWindow.Call(window, 0)
			case copyLinkButton, revokeLinkButton:
				i, _, _ := sendWindow.Call(p.links, lbGetCurSel, 0, 0)
				if int32(i) < 0 || int(i) >= maxMenuLinks {
					break
				}
				cmd := uintptr(linkBase + 2*int(i))
				if id == revokeLinkButton {
					cmd++
				}
				postMessage.Call(p.tray, 0x0111, cmd, 0)
			case initiateItem, stopItem, copyItem, createLink, disableItem, exitItem:
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
	// WS_CAPTION|WS_SYSMENU|WS_MINIMIZEBOX: a normal window with a taskbar
	// button, fixed size.
	window, _, _ := createWindow.Call(0x10000, uintptr(unsafe.Pointer(class.name)), uintptr(unsafe.Pointer(textPtr("Msfwr"))),
		0x00ca0000|0x00020000, 0x80000000, 0x80000000, px(600), px(660), 0, 0, instance, 0)
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
	add("BUTTON", "Status", group, 12, 8, 560, 112, 0)
	p.headline = add("STATIC", "", 0, 26, 30, 532, 20, 0)
	p.detail = add("STATIC", "", 0, 26, 52, 532, 36, 0)
	p.pc = add("STATIC", "", 0, 26, 92, 200, 20, 0)
	p.relay = add("STATIC", "", 0, 230, 92, 328, 20, 0)

	add("BUTTON", "Access code", group, 12, 126, 560, 62, 0)
	p.code = add("EDIT", "", readOnly, 26, 150, 200, 26, 0)
	add("BUTTON", "Copy access code", tab, 236, 148, 150, 30, copyItem)

	add("BUTTON", "Controls", group, 12, 194, 560, 66, 0)
	p.initiate = add("BUTTON", "Initiate: ask IT to connect", tab, 26, 218, 190, 30, initiateItem)
	p.stop = add("BUTTON", "Stop current session", tab, 224, 218, 150, 30, stopItem)
	p.newLink = add("BUTTON", "Create remote access URL…", tab, 382, 218, 176, 30, createLink)

	add("BUTTON", "Connections", group, 12, 266, 560, 270, 0)
	p.active = add("STATIC", "", 0, 26, 288, 532, 20, 0)
	p.count = add("STATIC", "", 0, 26, 310, 532, 20, 0)
	add("STATIC", "Recent sessions (since Msfwr started)", 0, 26, 334, 532, 18, 0)
	p.history = add("LISTBOX", "", listBox, 26, 354, 532, 70, 0)
	p.linksLabel = add("STATIC", "Remote access URLs", 0, 26, 430, 532, 18, 0)
	p.links = add("LISTBOX", "", listBox, 26, 450, 400, 74, 0)
	p.copyLink = add("BUTTON", "Copy URL", tab, 436, 450, 122, 30, copyLinkButton)
	p.revoke = add("BUTTON", "Revoke URL", tab, 436, 486, 122, 30, revokeLinkButton)

	add("STATIC", versionText(), 0, 14, 556, 230, 20, 0)
	add("BUTTON", "Turn off unattended…", tab, 250, 548, 150, 30, disableItem)
	add("BUTTON", "Hide", tab, 408, 548, 76, 30, hideButton)
	add("BUTTON", "Exit", tab, 492, 548, 80, 30, exitItem)
	if failed {
		destroyWindow.Call(window)
		return nil, panelError
	}
	sendWindow.Call(p.history, lbSetHorizontal, px(900), 0)
	sendWindow.Call(p.links, lbSetHorizontal, px(1100), 0)
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
	setText(p.active, v.active)
	setText(p.count, v.count)
	enable(p.initiate, v.state == "ready" || v.state == "calling")
	if v.state == "calling" {
		setText(p.initiate, "Initiate again: resend request")
	} else {
		setText(p.initiate, "Initiate: ask IT to connect")
	}
	enable(p.stop, v.state == "connected")
	enable(p.newLink, v.state != "connected")
	if !sameLines(v.history, p.lastHistory) {
		fillList(p.history, v.history, "No sessions yet.")
		p.lastHistory = v.history
	}
	urls := make([]string, 0, len(v.links))
	for _, l := range v.links {
		urls = append(urls, l.url)
	}
	if !sameLines(urls, p.lastLinks) {
		selected, _, _ := sendWindow.Call(p.links, lbGetCurSel, 0, 0)
		fillList(p.links, urls, "No remote access URLs. Create one to share a link.")
		if len(urls) > 0 && len(urls) == len(p.lastLinks) && int32(selected) >= 0 {
			sendWindow.Call(p.links, lbSetCurSel, selected, 0)
		}
		p.lastLinks = urls
	}
	setText(p.linksLabel, "Remote access URLs ("+twoDigits(len(urls))+" active)")
	p.enableLinkButtons()
}

func (p *controlPanel) enableLinkButtons() {
	selected, _, _ := sendWindow.Call(p.links, lbGetCurSel, 0, 0)
	ok := int32(selected) >= 0 && int(selected) < len(p.lastLinks) && int(selected) < maxMenuLinks
	enable(p.copyLink, ok)
	enable(p.revoke, ok)
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
