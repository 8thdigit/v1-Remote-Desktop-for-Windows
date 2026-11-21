package main

import (
	"context"
	"crypto/sha256"
	"errors"
	"runtime"
	"time"
)

type sessionUpdate struct {
	state, text, code string
}

func run(parent context.Context, r *relay, lines <-chan string, updates chan<- sessionUpdate) error {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
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
	updates <- sessionUpdate{state: "waiting", text: "Share this one-time code with your helper. It expires in 3 minutes.", code: invitation.Code[:4] + "-" + invitation.Code[4:8] + "-" + invitation.Code[8:]}
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
			updates <- sessionUpdate{state: "pending", text: "A helper requested access. Enter the 6-digit number they see, then approve or decline."}
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case typed, ok := <-lines:
			if !ok || challenge == "" || typed != challenge {
				return errors.New("verification did not match; no screen was shared")
			}
			if !onDefaultDesktop() {
				return errors.New("unlock Windows before starting support")
			}
			ready := make(chan error, 1)
			indicatorDone := make(chan struct{})
			go func() {
				defer close(indicatorDone)
				showSharingIndicator(ctx, cancel, ready)
			}()
			defer func() { cancel(); <-indicatorDone }()
			if err := <-ready; err != nil {
				return err
			}
			if err := r.post(ctx, "approve", nil, nil); err != nil {
				return err
			}
			updates <- sessionUpdate{state: "live", text: "Live: screen sharing and remote control are active. Ctrl+2 or F12 stops the session."}
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

type unattendedUpdate struct {
	state, text string // state is ready, connected, offline or locked
}

// serveUnattended keeps a pre-approved registration open on the relay and
// streams to the first viewer that joins with this PC's saved access code.
// There is no approval prompt and no pop-up window; the UI shows the state on
// the taskbar and tray icon instead. Ctrl+2, F12 or "Stop current session"
// end a live session; the host then registers again for the next one.
func serveUnattended(ctx context.Context, origin, key string, stopSession <-chan struct{}, updates chan<- unattendedUpdate) {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	backoff := 2 * time.Second
	pause := func(d time.Duration) bool {
		t := time.NewTimer(d)
		defer t.Stop()
		select {
		case <-ctx.Done():
			return false
		case <-t.C:
			return true
		}
	}
	for ctx.Err() == nil {
		if !onDefaultDesktop() {
			updates <- unattendedUpdate{state: "locked", text: "Windows is locked. Remote access resumes after you sign in."}
			if !pause(3 * time.Second) {
				return
			}
			continue
		}
		served, err := unattendedRound(ctx, origin, key, stopSession, updates)
		if ctx.Err() != nil {
			return
		}
		if served {
			text := "Remote session ended. Ready for the next connection."
			if err != nil && !errors.Is(err, context.Canceled) {
				text = "Remote session ended: " + err.Error()
			}
			updates <- unattendedUpdate{state: "ready", text: text}
			backoff = 2 * time.Second
			continue
		}
		if err == nil {
			backoff = 2 * time.Second
			continue
		}
		updates <- unattendedUpdate{state: "offline", text: "Cannot reach the relay (" + err.Error() + "). Retrying…"}
		if !pause(backoff) {
			return
		}
		if backoff < time.Minute {
			backoff *= 2
		}
	}
}

// unattendedRound registers once and waits up to two minutes for a viewer
// before returning so the caller can refresh the registration. served reports
// whether a viewer connected.
func unattendedRound(parent context.Context, origin, key string, stopSession <-chan struct{}, updates chan<- unattendedUpdate) (served bool, err error) {
	r, err := newRelay(origin)
	if err != nil {
		return false, err
	}
	var invitation invite
	if err := r.postJSON(parent, "standing", map[string]string{"key": key}, &invitation); err != nil {
		return false, err
	}
	if invitation.Code != standingCode(key) || !tokenFormat.MatchString(invitation.Token) {
		return false, errors.New("relay returned an invalid registration")
	}
	r.token = invitation.Token
	defer func() {
		endCtx, stop := context.WithTimeout(context.Background(), 1500*time.Millisecond)
		defer stop()
		_ = r.post(endCtx, "end", nil, nil)
	}()
	updates <- unattendedUpdate{state: "ready", text: "Ready. IT can connect with this PC's access code."}
	refresh := time.Now().Add(2 * time.Minute)
	wait := time.NewTicker(650 * time.Millisecond)
	defer wait.Stop()
	for time.Now().Before(refresh) {
		var reply tick
		if err := r.post(parent, "tick", nil, &reply); err != nil {
			return false, err
		}
		switch reply.State {
		case "waiting":
		case "live":
			if !onDefaultDesktop() {
				return false, nil
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
					case <-stopSession:
						cancel()
						return
					case <-t.C:
						if stopPressed() {
							cancel()
							return
						}
					}
				}
			}()
			updates <- unattendedUpdate{state: "connected", text: "CONNECTED: IT is viewing and can control this PC. Press Ctrl+2 or F12 to stop."}
			return true, stream(ctx, r)
		default:
			return false, errors.New("relay returned an unexpected state")
		}
		select {
		case <-parent.Done():
			return false, parent.Err()
		case <-stopSession:
			// Nothing is live; ignore a stale stop request.
		case <-wait.C:
		}
	}
	return false, nil
}
