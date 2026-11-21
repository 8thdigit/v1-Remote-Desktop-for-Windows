package main

import (
	"bufio"
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"os"
	"os/signal"
"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"time"
)

var codeFormat = regexp.MustCompile(`^[A-F0-9]{12}$`)
var tokenFormat = regexp.MustCompile(`^[A-Za-z0-9_-]{43}$`)
var verifyFormat = regexp.MustCompile(`^[0-9]{6}$`)

func main() {
	runtime.LockOSThread()
	setDPI()
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	fmt.Println("winss132r  /  WINDOWS SUPPORT HOST")
	fmt.Println("Only share with a person you trust. Never share a code with an unexpected caller.")
	fmt.Println()
	// Keep a single console reader for this process. Network operations can stop
	// without waiting for the next keystroke.
	lines := make(chan string)
	go func() {
		defer close(lines)
		scan := bufio.NewScanner(os.Stdin)
		for scan.Scan() {
			lines <- strings.TrimSpace(scan.Text())
		}
	}()
	if err := run(ctx, lines); err != nil && !errors.Is(err, context.Canceled) {
		fmt.Println("Session closed:", err)
	}
	fmt.Print("\nPress Enter to close winss132r.")
	select {
	case <-lines:
	case <-ctx.Done():
	}
}

func run(parent context.Context, lines <-chan string) error {
read := func() (string, error) {
	select {
	case <-parent.Done():
		return "", parent.Err()
	case answer, ok := <-lines:
		if !ok {
			return "", context.Canceled
		}
		return answer, nil
	}
}
configDir, configErr := os.UserConfigDir()
path := ""
saved := ""
if configErr == nil {
	path = filepath.Join(configDir, "winss132r", "relay.txt")
	var loadErr error
	saved, loadErr = loadRelayAddress(path)
	if loadErr != nil {
		fmt.Println("Could not load the saved relay address. Enter a new address or type forget to clear it.")
	}
}
if saved != "" {
	fmt.Printf("Saved HTTPS relay: %s\nPress Enter to use it, paste a different address, or type forget: ", saved)
} else {
	fmt.Print("Paste the HTTPS relay address shown in the browser viewer: ")
}
value, err := read()
if err != nil {
	return err
}
if path != "" && strings.EqualFold(value, "forget") {
	if err := forgetRelayAddress(path); err != nil {
		return fmt.Errorf("could not clear the saved relay address: %w", err)
	}
	fmt.Println("Saved relay address cleared.")
	fmt.Print("Paste the HTTPS relay address for this session, or press Enter to exit: ")
	value, err = read()
	if err != nil || value == "" {
		return err
	}
	saved = ""
}
if value == "" {
	value = saved
}
r, err := newRelay(value)
	if err != nil {
		return err
	}
if path != "" && saved != r.origin {
	fmt.Print("Remember this relay address on this Windows account? [y/N]: ")
	answer, err := read()
	if err != nil {
		return err
	}
	if strings.EqualFold(answer, "y") || strings.EqualFold(answer, "yes") {
		if err := saveRelayAddress(path, r.origin); err != nil {
			fmt.Println("Could not save the address; continuing without saving it:", err)
		}
	}
}
	ctx, cancel := context.WithCancel(parent)
	defer cancel()
	go func() {
		t := time.NewTicker(25 * time.Millisecond)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				if stopPressed() {
					cancel()
					return
				}
			}
		}
	}()
	var invitation invite
	if err := r.post(ctx, "invite", nil, &invitation); err != nil {
		return err
	}
	if !codeFormat.MatchString(invitation.Code) || !tokenFormat.MatchString(invitation.Token) {
		return errors.New("relay returned an invalid invitation")
	}
	r.token = invitation.Token
	defer func() {
		endCtx, stop := context.WithTimeout(context.Background(), 1500*time.Millisecond)
		defer stop()
		_ = r.post(endCtx, "end", nil, nil)
	}()
	fmt.Printf("\nOne-time code: %s-%s-%s\n", invitation.Code[:4], invitation.Code[4:8], invitation.Code[8:])
	fmt.Println("Share it with your helper. The code expires in 3 minutes.")
	fmt.Println("No screen is shared until you approve. Press F12 to cancel.")
	wait := time.NewTicker(650 * time.Millisecond)
	defer wait.Stop()
	challenge := ""
	for {
		var reply tick
		if err := r.post(ctx, "tick", nil, &reply); err != nil {
			return err
		}
		if reply.State == "pending" && challenge == "" {
			if !verifyFormat.MatchString(reply.Verification) {
				return errors.New("invalid verification number")
			}
			challenge = reply.Verification
			fmt.Println("\nA helper is asking to view your screen and control your mouse and keyboard.")
			fmt.Print("Ask your helper for the 6-digit number shown in their browser. Type it here to approve, or press Enter to decline: ")
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case typed, ok := <-lines:
			if !ok || challenge == "" || typed != challenge {
				return errors.New("not approved; no screen was shared")
			}
			if !onDefaultDesktop() {
				return errors.New("unlock Windows before starting support")
			}
			if err := r.post(ctx, "approve", nil, nil); err != nil {
				return err
			}
			fmt.Println("\nLIVE: your primary screen is being shared and remote control is enabled.")
			fmt.Println("Press F12 at any time to stop. Keep this window open.")
			go showLiveNotice(cancel)
			return stream(ctx, r)
		case <-wait.C:
		}
	}
}

func stream(ctx context.Context, r *relay) error {
	input := newControls()
	defer input.release()
	cadence := time.NewTicker(200 * time.Millisecond)
	defer cadence.Stop()
	deadline := time.Now().Add(30 * time.Minute)
	var digest [32]byte
	var lastUpload time.Time
	for {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if time.Now().After(deadline) {
			return errors.New("the 30-minute session limit was reached")
		}
		if !onDefaultDesktop() {
			return errors.New("Windows switched to a locked or protected desktop")
		}
		frame, w, h, err := snapshot()
		if err != nil {
			return err
		}
		hash := sha256.Sum256(frame.Pix)
		var data []byte
		if hash != digest || time.Since(lastUpload) > 10*time.Second {
			data, err = encodeJPEG(frame)
			if err != nil {
				return err
			}
		}
		var reply tick
		if err := r.post(ctx, "tick", data, &reply); err != nil {
			return err
		}
		if reply.State != "live" {
			return errors.New("relay ended the approved session")
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if !onDefaultDesktop() || !sameScreen(w, h) {
			return errors.New("Windows desktop or display configuration changed")
		}
		if len(data) > 0 {
			digest, lastUpload = hash, time.Now()
		}
		for _, a := range reply.Input {
			if ctx.Err() != nil || stopPressed() {
				return context.Canceled
			}
			input.apply(a, w, h)
		}
		if time.Since(input.lastPointer) > 3*time.Second {
			input.release()
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-cadence.C:
		}
	}
}
