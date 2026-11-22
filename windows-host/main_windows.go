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
	state, text string // state is ready, calling, connected, offline or locked
}

// callTTL matches callTTL in artifacts/api-server/src/lib/deskline.ts.
const callTTL = 2 * time.Minute

// serveUnattended keeps a pre-approved registration open on the relay and
// streams to the first viewer that joins with this PC's saved access code.
// There is no approval prompt and no pop-up window; the UI shows the state on
// the notification-area icon instead. Ctrl+2, F12 or "Stop current session"
// end a live session; the host then registers again for the next one.
// Initiate asks viewers that saved this PC's code to connect; IT accepts in
// the browser and the session starts at once.
// linksPath is where saved remote access links live ("" when unavailable).
// After a session opened through a shared link ends, the host re-registers
// under that link so the same URL can open more sessions until it expires.
func serveUnattended(ctx context.Context, origin, key, name, linksPath string, stopSession, initiate <-chan struct{}, newLink <-chan linkRequest, updates chan<- unattendedUpdate) {
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
	var callUntil time.Time
	// pending holds a link the user asked the UI to create whose relay
	// creation has not been confirmed yet; it survives a round restart so the
	// request is retried instead of being lost. The UI reads len(pending) > 0
	// to know a create is still in flight (dedupe).
	pending := make(chan linkRequest, 1)
	for ctx.Err() == nil {
		if !onDefaultDesktop() {
			callUntil = time.Time{}
			updates <- unattendedUpdate{state: "locked", text: "Windows is locked. Remote access resumes after you sign in."}
			if !pause(3 * time.Second) {
				return
			}
			continue
		}
		// Retry a link whose creation did not finish before the last round
		// ended (relay offline, error, or session raced ahead of it). The UI
		// dedupes clicks with its own in-flight marker; this keeps retrying
		// every few seconds until the relay confirms the link exists.
	retry:
		for {
			select {
			case req := <-pending:
				rc, err := newRelay(origin)
				var created *remoteLink
				if err == nil {
					cctx, ccancel := context.WithTimeout(context.Background(), 8*time.Second)
					created, err = rc.createLink(cctx, key, req.name, req.hours)
					ccancel()
				}
				if err != nil {
					updates <- unattendedUpdate{state: "ready", text: "Could not create the remote access URL: " + err.Error() + ". Retrying…"}
					if !pause(3 * time.Second) {
						return
					}
					continue retry
				}
				stored := savedLink{ID: created.ID, Code: created.Code, Key: key, Name: req.name, Relay: origin, CreatedAt: created.CreatedAt, ExpiresAt: created.ExpiresAt}
				if linksPath != "" {
					current, _ := loadLinks(linksPath, time.Now())
					_ = saveLinks(linksPath, addLink(current, stored, time.Now()))
				}
				updates <- unattendedUpdate{state: "ready", text: "Remote access link is live: share " + stored.shareURL() + " (" + timeLeft(stored.ExpiresAt, time.Now()) + ")"}
				continue retry
			default:
				break retry
			}
		}
		served, err := unattendedRound(ctx, origin, key, name, stopSession, initiate, linksPath, newLink, pending, &callUntil, updates)
		if ctx.Err() != nil {
			return
		}
		if served || err != nil {
			callUntil = time.Time{}
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
// callUntil is when the current Initiate request lapses; it survives the
// registration refresh so a request is not lost when the round restarts.
// newLink carries links the user asked the UI to create; pendingLink holds
// one whose relay creation has not been confirmed yet, so it is retried
// instead of being lost across rounds.
func unattendedRound(parent context.Context, origin, key, name string, stopSession, initiate <-chan struct{}, linksPath string, newLink <-chan linkRequest, pendingLink chan linkRequest, callUntil *time.Time, updates chan<- unattendedUpdate) (served bool, err error) {
	r, err := newRelay(origin)
	if err != nil {
		return false, err
	}
	var invitation invite
	if err := r.postJSON(parent, "standing", map[string]string{"key": key, "name": name}, &invitation); err != nil {
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
	call := func(until time.Time) error {
		if err := r.postJSON(parent, "call", map[string]string{"name": name}, nil); err != nil {
			// A relay that answers but rejects the request (an older build
			// without Initiate, or the session is no longer waiting) is not
			// a network failure: say so and keep the registration.
			if text, ok := initiateRejected(err); ok {
				*callUntil = time.Time{}
				updates <- unattendedUpdate{state: "ready", text: text}
				return nil
			}
			return err
		}
		*callUntil = until
		updates <- unattendedUpdate{state: "calling", text: "Request sent. Waiting for IT to accept in the browser…"}
		return nil
	}
	// registerLinkNow asks the relay to open this link's code for viewers.
	// The host stays registered under the standing code as well, so both
	// entry points work while the link is alive.
	registerLinkNow := func(l savedLink) {
		ctx, cancel := context.WithTimeout(context.Background(), 6*time.Second)
		defer cancel()
		if _, err := r.registerLink(ctx, l.ID, l.Key); err != nil {
			updates <- unattendedUpdate{state: "ready", text: "Remote access link could not be armed: " + err.Error()}
			return
		}
		updates <- unattendedUpdate{state: "ready", text: "Remote access link is live: share " + l.shareURL() + " (" + timeLeft(l.ExpiresAt, time.Now()) + ")"}
	}
	createLink := func(req linkRequest) {
		ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
		defer cancel()
		created, err := r.createLink(ctx, key, req.name, req.hours)
		if err != nil {
			updates <- unattendedUpdate{state: "ready", text: "Could not create the remote access URL: " + err.Error()}
			return
		}
		stored := savedLink{ID: created.ID, Code: created.Code, Key: key, Name: req.name, Relay: origin, CreatedAt: created.CreatedAt, ExpiresAt: created.ExpiresAt}
		if linksPath != "" {
			current, _ := loadLinks(linksPath, time.Now())
			if err := saveLinks(linksPath, addLink(current, stored, time.Now())); err != nil {
				updates <- unattendedUpdate{state: "ready", text: "The link was created but could not be saved on this PC: " + err.Error()}
			}
		}
		registerLinkNow(stored)
	}
	armActiveLinks := func() {
		if linksPath == "" {
			return
		}
		active, err := loadLinks(linksPath, time.Now())
		if err != nil || len(active) == 0 {
			return
		}
		for _, l := range active {
			registerLinkNow(l)
		}
	}
	if time.Now().Before(*callUntil) {
		if err := call(*callUntil); err != nil {
			return false, err
		}
	} else {
		updates <- unattendedUpdate{state: "ready", text: "Ready. IT can connect with this PC's access code, or select Initiate."}
		armActiveLinks()
	}
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
			if !callUntil.IsZero() && time.Now().After(*callUntil) {
				*callUntil = time.Time{}
				updates <- unattendedUpdate{state: "ready", text: "No one accepted the request. Select Initiate to ask again."}
			}
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
			*callUntil = time.Time{}
			updates <- unattendedUpdate{state: "connected", text: "IT can view and control this PC. Press Ctrl+2 or F12 to stop."}
			return true, stream(ctx, r)
		default:
			return false, errors.New("relay returned an unexpected state")
		}
		select {
		case <-parent.Done():
			return false, parent.Err()
		case <-stopSession:
			// Nothing is live; ignore a stale stop request.
		case <-initiate:
			if err := call(time.Now().Add(callTTL)); err != nil {
				return false, err
			}
		case req := <-newLink:
			select {
			case <-pendingLink: // drop any older unconfirmed request; this one wins
			default:
			}
			pendingLink <- req // remembered if creation below fails or errors
			createLink(req)
			drainRequest(pendingLink, req)
		case <-wait.C:
		}
	}
	return false, nil
}

// drainRequest removes req from a full pending channel, if it is still the
// request at the head (createLink finished handling it). A different request
// that raced in is put back for the next round.
func drainRequest(pending chan linkRequest, req linkRequest) {
	select {
	case got := <-pending:
		if got != req {
			pending <- got
		}
	default:
	}
}
