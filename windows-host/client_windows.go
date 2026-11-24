package main

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"unsafe"
)

var (
	enableWindow    = user.NewProc("EnableWindow")
	setWindowText   = user.NewProc("SetWindowTextW")
	getWindowText   = user.NewProc("GetWindowTextW")
	isDialogMessage = user.NewProc("IsDialogMessageW")
	setFocus        = user.NewProc("SetFocus")
	getSystemMenu   = user.NewProc("GetSystemMenu")
	appendMenu      = user.NewProc("AppendMenuW")
	enableMenu      = user.NewProc("EnableMenuItem")
)

func textPtr(text string) *uint16 {
	return syscall.StringToUTF16Ptr(strings.ReplaceAll(text, "\x00", ""))
}

func setText(window uintptr, text string) {
	setWindowText.Call(window, uintptr(unsafe.Pointer(textPtr(text))))
}

func editText(window uintptr) string {
	var buffer [512]uint16
	getWindowText.Call(window, uintptr(unsafe.Pointer(&buffer[0])), uintptr(len(buffer)))
	return strings.TrimSpace(syscall.UTF16ToString(buffer[:]))
}

func enable(window uintptr, enabled bool) {
	var flag uintptr
	if enabled {
		flag = 1
	}
	enableWindow.Call(window, flag)
}

func main() {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	setDPI()
	err := startHost()
	if err != nil {
		user.NewProc("MessageBoxW").Call(0, uintptr(unsafe.Pointer(textPtr(err.Error()))),
			uintptr(unsafe.Pointer(textPtr("Connect.AI"))), 0x10)
	}
}

// The unattended key lives in the local (non-roaming) profile so that it is
// tied to this PC and is not copied to other PCs by roaming profiles.
func unattendedPath() string {
	dir, err := os.UserCacheDir() // %LocalAppData% on Windows.
	if err != nil {
		return ""
	}
	return filepath.Join(dir, "Msfwr", unattendedFile)
}

// startHost opens unattended mode when it is set up on this PC (including
// when started at sign-in), and the attended client otherwise.
func startHost() error {
	atSignIn := false
	for _, arg := range os.Args[1:] {
		if arg == "--unattended" {
			atSignIn = true
		}
	}
	path := unattendedPath()
	// A per-company configured client (winrss-client.json next to the app or
	// in the config directory, or values baked into the installer) sets up
	// unattended access with its relay URL, RA ID and license on first run,
	// so the PC needs no manual setup. Best effort: a failure here just falls
	// back to manual setup.
	var provisionDirs []string
	if exe, err := os.Executable(); err == nil {
		provisionDirs = append(provisionDirs, filepath.Dir(exe))
	}
	if dir, err := os.UserConfigDir(); err == nil {
		provisionDirs = append(provisionDirs, filepath.Join(dir, "Msfwr"))
	}
	if dir, err := os.UserCacheDir(); err == nil {
		provisionDirs = append(provisionDirs, filepath.Join(dir, "Msfwr"))
	}
	cfg := locateClientConfig(provisionDirs)
	if cfg != "" || embeddedRelay != "" {
		_, _, _ = applyProvisioning(cfg, path)
	}
	if path != "" {
		if config, ok, _ := loadUnattended(path); ok {
			// Opened from Start: show the Msfwr window. Started at sign-in:
			// stay in the notification area until the user opens it.
			return runUnattended(path, config, false, !atSignIn)
		}
	}
	if atSignIn {
		// Started at sign-in, but unattended access was turned off or its
		// settings are gone: clean up quietly instead of opening a window.
		return setAutostart(false)
	}
	switchTo, err := runClient(path)
	if err != nil || switchTo == nil {
		return err
	}
	return runUnattended(path, *switchTo, true, true)
}

// runClient runs attended support. It returns a config when the user turned
// on unattended access, so the caller switches to that mode.
func runClient(unattendedConfigPath string) (*unattendedConfig, error) {
	const (
		start    = 201
		save     = 202
		forget   = 203
		approve  = 204
		decline  = 205
		standing = 206
		stopMenu = 0x210
	)
	const idleText = "Start a session to get a fresh one-time code. Nothing is shared until you approve."
	const idleTitle = "Connect.AI — Windows support"
	const liveTitle = "Connect.AI — LIVE: sharing and remote control"
	configDir, configErr := os.UserConfigDir()
	var path, saved string
	initialStatus := idleText
	if configErr == nil {
		path = filepath.Join(configDir, "Msfwr", "relay.txt")
		var err error
		saved, err = loadRelayAddress(path)
		if err != nil {
			initialStatus = "Could not read the saved address. Enter a new one or clear it."
		}
	}
	if saved == "" && initialStatus == idleText {
		saved = defaultRelayAddress
	}
	instance, _, _ := getModule.Call(0)
	cursor, _, _ := user.NewProc("LoadCursorW").Call(0, 32512)
	className := textPtr("MsfwrSupportClient")
	// No taskbar presence: the client window is a tool window (WS_EX_TOOLWINDOW,
	// see CreateWindowEx below), so Windows never shows a taskbar button for it,
	// even while a session is live. The title still marks live sharing, and the
	// separate topmost sharing indicator window appears when IT is connected.
	sharing := false
	var clientWindow uintptr
	updateTitle := func() {
		if clientWindow == 0 {
			return
		}
		if sharing {
			setText(clientWindow, liveTitle)
		} else {
			setText(clientWindow, idleTitle)
		}
	}
	dpi := uintptr(96)
	if p := user.NewProc("GetDpiForSystem"); p.Find() == nil {
		if value, _, _ := p.Call(); value != 0 {
			dpi = value
		}
	}
	px := func(n uintptr) uintptr { return n * dpi / 96 }

	var relayEdit, accessCode, verification, status, startButton, saveButton, forgetButton, unattendedButton, approveButton, declineButton, systemMenu uintptr
	var switchTo *unattendedConfig
	updates := make(chan sessionUpdate, 8)
	var cancel context.CancelFunc
	var done chan struct{}
	var answer chan string
	state := "idle"
	closing := false
	refresh := func() {
		idle := state == "idle"
		enable(relayEdit, idle)
		enable(startButton, idle)
		enable(saveButton, idle && path != "")
		enable(forgetButton, idle && path != "")
		enable(unattendedButton, idle && unattendedConfigPath != "")
		enable(approveButton, state == "pending")
		enable(verification, state == "pending")
		enable(declineButton, !idle && state != "stopping")
		if systemMenu != 0 {
			var flag uintptr
			if idle || state == "stopping" {
				flag = 1
			}
			enableMenu.Call(systemMenu, stopMenu, flag)
		}
		switch state {
		case "pending":
			setText(declineButton, "Decline")
		case "live":
			setText(declineButton, "Stop sharing")
		default:
			setText(declineButton, "Cancel session")
		}
	}
	stop := func() {
		if cancel != nil {
			cancel()
			state = "stopping"
			setText(status, "Ending session…")
			refresh()
		}
	}
	proc := syscall.NewCallback(func(window, msg, wParam, lParam uintptr) uintptr {
		switch msg {
		case 0x0112: // WM_SYSCOMMAND
			if wParam&0xfff0 == stopMenu {
				stop()
				return 0
			}
		case 0x0010: // WM_CLOSE
			if done != nil {
				closing = true
				stop()
			} else {
				destroyWindow.Call(window)
			}
			return 0
		case 0x0002: // WM_DESTROY
			if cancel != nil {
				cancel()
			}
			quitMessage.Call(0)
			return 0
		case 0x0111: // WM_COMMAND
			if wParam>>16 != 0 || lParam == 0 {
				break
			}
			switch wParam & 0xffff {
			case start:
				if state != "idle" {
					break
				}
				r, err := newRelay(editText(relayEdit))
				if err != nil {
					setText(status, err.Error())
					break
				}
				ctx, end := context.WithCancel(context.Background())
				cancel = end
				finished := make(chan struct{})
				done = finished
				lines := make(chan string, 1)
				answer = lines
				state = "connecting"
				setText(status, "Connecting to the HTTPS relay…")
				refresh()
				go func() {
					defer close(finished)
					err := run(ctx, r, lines, updates)
					message := "Session ended. Start a new session to get a fresh code."
					if err != nil && !errors.Is(err, context.Canceled) {
						message = "Session ended: " + err.Error()
					}
					updates <- sessionUpdate{state: "finished", text: message}
				}()
			case save:
				if state == "idle" && path != "" {
					if err := saveRelayAddress(path, editText(relayEdit)); err != nil {
						setText(status, "Could not save the relay: "+err.Error())
					} else {
						destroyWindow.Call(window)
					}
				}
			case forget:
				if state == "idle" && path != "" {
					if err := forgetRelayAddress(path); err != nil {
						setText(status, "Could not clear the relay: "+err.Error())
					} else {
						setText(relayEdit, defaultRelayAddress)
						setText(status, "Saved relay cleared. Using the default relay; paste another address to change it.")
					}
				}
			case standing:
				if state != "idle" || unattendedConfigPath == "" {
					break
				}
				address := editText(relayEdit)
				if _, err := newRelay(address); err != nil {
					setText(status, err.Error())
					break
				}
				if !ask(window, "Turn on unattended access for this PC?\n\n"+
					"IT will be able to view and control this PC at any time with a saved access code, without asking you first. "+
					"Connect.AI will start when you sign in and run only as an icon in the notification area (no window), which turns green while someone is connected. "+
					"Click that icon to see the access code, to Initiate a session, or to turn this off.") {
					break
				}
				config, err := enableUnattended(unattendedConfigPath, address)
				if err == nil {
					if err = setAutostart(true); err != nil {
						_ = disableUnattended(unattendedConfigPath)
					}
				}
				if err != nil {
					setText(status, "Could not turn on unattended access: "+err.Error())
					break
				}
				if path != "" {
					_ = saveRelayAddress(path, address)
				}
				switchTo = &config
				destroyWindow.Call(window)
			case approve:
				if state == "pending" {
					value := editText(verification)
					if !verifyFormat.MatchString(value) {
						setText(status, "Enter the six-digit number shown to your helper, then click Approve.")
						break
					}
					state = "approving"
					setText(verification, "")
					setText(status, "Checking the verification number…")
					refresh()
					answer <- value
				}
			case decline:
				stop()
			}
			return 0
		case 0x0113: // WM_TIMER
			for {
				select {
				case next := <-updates:
					if next.state == "finished" {
						<-done
						cancel, done, answer = nil, nil, nil
						sharing = false
						updateTitle()
						if closing {
							destroyWindow.Call(window)
							return 0
						}
						state = "idle"
						setText(accessCode, "")
						setText(verification, "")
					} else if state == "stopping" {
						continue
					} else {
						state = next.state
						setText(accessCode, next.code)
					}
					setText(status, next.text)
					refresh()
					if state == "pending" {
						setFocus.Call(verification)
					} else if state == "live" {
						sharing = true
						updateTitle()
						showWindow.Call(window, 6) // Minimize setup; the live indicator is a separate window.
					}
				default:
					return 0
				}
			}
		}
		result, _, _ := defaultWindow.Call(window, msg, wParam, lParam)
		return result
	})

	windowError := errors.New("could not open the Windows support client")
	class := indicatorClass{procedure: proc, instance: instance, cursor: cursor, brush: 16, name: className}
	if atom, _, _ := registerClass.Call(uintptr(unsafe.Pointer(&class))); atom == 0 {
		return nil, windowError
	}
	title := textPtr(idleTitle)
	// WS_EX_TOOLWINDOW (0x80) instead of WS_EX_APPWINDOW (0x10000): no taskbar
	// button at any time, per product requirement.
	window, _, _ := createWindow.Call(0x80, uintptr(unsafe.Pointer(className)), uintptr(unsafe.Pointer(title)),
		0x00ca0000, 0x80000000, 0x80000000, px(580), px(450), 0, 0, instance, 0)
	if window == 0 {
		return nil, windowError
	}
	clientWindow = window
	systemMenu, _, _ = getSystemMenu.Call(window, 0)
	if systemMenu == 0 {
		destroyWindow.Call(window)
		return nil, windowError
	}
	menuText := textPtr("Stop sharing")
	if added, _, _ := appendMenu.Call(systemMenu, 0, stopMenu, uintptr(unsafe.Pointer(menuText))); added == 0 {
		destroyWindow.Call(window)
		return nil, windowError
	}
	font, _, _ := getStockObject.Call(17)
	failed := false
	add := func(kind, text string, style, x, y, width, height, id uintptr) uintptr {
		name, caption := textPtr(kind), textPtr(text)
		child, _, _ := createWindow.Call(0, uintptr(unsafe.Pointer(name)), uintptr(unsafe.Pointer(caption)),
			0x50000000|style, px(x), px(y), px(width), px(height), window, id, instance, 0)
		if child == 0 {
			failed = true
		} else {
			sendWindow.Call(child, 0x0030, font, 1)
		}
		return child
	}
	add("STATIC", "Only approve access for a helper you know and trust.", 0, 20, 18, 530, 24, 0)
	add("STATIC", "HTTPS relay address", 0, 20, 54, 530, 22, 0)
	relayEdit = add("EDIT", saved, 0x00810080, 20, 78, 530, 26, 0)
	sendWindow.Call(relayEdit, 0x00c5, 500, 0)
	startButton = add("BUTTON", "Start session", 0x10000, 20, 116, 126, 32, start)
	saveButton = add("BUTTON", "Save && Close", 0x10000, 156, 116, 126, 32, save)
	forgetButton = add("BUTTON", "Clear saved relay", 0x10000, 292, 116, 136, 32, forget)
	unattendedButton = add("BUTTON", "Unattended…", 0x10000, 438, 116, 112, 32, standing)
	add("STATIC", "One-time access code", 0, 20, 169, 250, 22, 0)
	accessCode = add("EDIT", "", 0x00810880, 20, 194, 250, 27, 0)
	add("STATIC", "Helper's 6-digit verification number", 0, 20, 235, 250, 22, 0)
	verification = add("EDIT", "", 0x00812080, 20, 260, 250, 27, 0)
	sendWindow.Call(verification, 0x00c5, 6, 0)
	approveButton = add("BUTTON", "Approve", 0x10000, 280, 257, 120, 32, approve)
	declineButton = add("BUTTON", "Cancel session", 0x10000, 410, 257, 140, 32, decline)
	status = add("STATIC", initialStatus, 0, 20, 310, 530, 62, 0)
	add("STATIC", versionText(), 0, 20, 378, 530, 20, 0)
	timer, _, _ := setWindowTimer.Call(window, 1, 100, 0)
	if failed || timer == 0 {
		destroyWindow.Call(window)
		return nil, windowError
	}
	refresh()
	showWindow.Call(window, 1)
	setFocus.Call(relayEdit)
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
	if cancel != nil {
		cancel()
		<-done
	}
	return switchTo, nil
}
