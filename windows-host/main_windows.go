package main

import (
	"context"
	"errors"
	"hash/crc32"
	"os"
	"runtime"
	"sync"
	"sync/atomic"
	"time"
)

type sessionUpdate struct {
	state, text, code string
}

// run is one attended session. With an RA ID, the request also goes
// straight to that IT person's portal, who still needs the person at the PC
// to type the verification number.
func run(parent context.Context, r *relay, ra string, lines <-chan string, updates chan<- sessionUpdate) error {
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
	display := invitation.Code[:4] + "-" + invitation.Code[4:8] + "-" + invitation.Code[8:]
	waitingText := "Share this one-time code with your helper. It expires in 3 minutes."
	if ra != "" {
		host, _ := os.Hostname()
		if err := r.postJSON(ctx, "call", map[string]string{"name": host, "ra": ra}, nil); err != nil {
			if text, ok := initiateRejected(err); ok {
				waitingText = text + " You can still share this one-time code."
			} else {
				return err
			}
		} else {
			waitingText = "Request sent to " + formatRA(ra) + ". They can accept it in the portal, or you can share this code. It expires in 3 minutes."
		}
	}
	updates <- sessionUpdate{state: "waiting", text: waitingText, code: display}
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

// maxSession matches maxLive in artifacts/api-server/src/lib/deskline.ts.
const maxSession = 12 * time.Hour

// stream shares the screen until the session ends. Three loops run side by
// side so neither direction waits for the other:
//   - capture: grabs the screen, skips unchanged frames, encodes the rest;
//   - upload: sends the newest encoded frame (one frame is encoded while the
//     previous one uploads) and adapts size and quality to upload speed;
//   - input: a long poll that applies clicks and keys the moment they arrive.
func stream(ctx context.Context, r *relay) error {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	var inputMu sync.Mutex
	input := newControls()
	defer func() { inputMu.Lock(); input.release(); inputMu.Unlock() }()
	var screenW, screenH atomic.Int64
	screenW.Store(int64(metric(0)))
	screenH.Store(int64(metric(1)))
	apply := func(events []event) error {
		if len(events) == 0 {
			return nil
		}
		inputMu.Lock()
		defer inputMu.Unlock()
		w, h := int(screenW.Load()), int(screenH.Load())
		for _, a := range events {
			if ctx.Err() != nil || stopPressed() {
				return context.Canceled
			}
			input.apply(a, w, h)
		}
		return nil
	}
	fail := make(chan error, 3)
	stop := func(err error) {
		select {
		case fail <- err:
		default:
		}
		cancel()
	}
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
	// A tick that retries through short network trouble, so a dropped
	// packet or a relay restart does not end the session.
	sendTick := func(data []byte) (tick, error) {
		var reply tick
		started := time.Now()
		for attempt := 0; ; attempt++ {
			err := r.post(ctx, "tick", data, &reply)
			if err == nil {
				return reply, nil
			}
			if ctx.Err() != nil || !transient(err) || time.Since(started) > 12*time.Second {
				return reply, err
			}
			if !pause(time.Duration(min(attempt+1, 8)) * 250 * time.Millisecond) {
				return reply, ctx.Err()
			}
		}
	}

	r.pulls = true
	var pullWorks atomic.Bool
	go func() {
		failures := 0
		for ctx.Err() == nil {
			var reply tick
			err := r.pull(ctx, &reply)
			if err != nil {
				if ctx.Err() != nil {
					return
				}
				var s *statusError
				if errors.As(err, &s) && (s.status == 404 || s.status == 405) {
					return // An older relay: input arrives with each tick instead.
				}
				if !transient(err) {
					stop(err)
					return
				}
				failures++
				if !pause(time.Duration(min(failures, 8)) * 250 * time.Millisecond) {
					return
				}
				continue
			}
			failures = 0
			pullWorks.Store(true)
			if reply.State != "live" {
				stop(errors.New("relay ended the approved session"))
				return
			}
			if err := apply(reply.Input); err != nil {
				stop(err)
				return
			}
		}
	}()
	// Release a held mouse button if the viewer goes quiet.
	go func() {
		t := time.NewTicker(time.Second)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				inputMu.Lock()
				if time.Since(input.lastPointer) > 3*time.Second {
					input.release()
				}
				inputMu.Unlock()
			}
		}
	}()

	quality := newAdaptiveQuality()
	var levelMu sync.Mutex
	level := func() qualityLevel { levelMu.Lock(); defer levelMu.Unlock(); return quality.current() }
	frames := make(chan []byte) // unbuffered: hand-off to the uploader
	go func() {
		for ctx.Err() == nil {
			var data []byte
			// Heartbeat at least once a second; four times a second on an
			// older relay, which only hands input out with ticks.
			beat := time.Second
			if !pullWorks.Load() {
				beat = 250 * time.Millisecond
			}
			t := time.NewTimer(beat)
			select {
			case <-ctx.Done():
				t.Stop()
				return
			case data = <-frames:
			case <-t.C:
			}
			t.Stop()
			started := time.Now()
			reply, err := sendTick(data)
			if err != nil {
				stop(err)
				return
			}
			if len(data) > 0 {
				levelMu.Lock()
				quality.observe(time.Since(started))
				levelMu.Unlock()
			}
			if reply.State != "live" {
				stop(errors.New("relay ended the approved session"))
				return
			}
			if err := apply(reply.Input); err != nil {
				stop(err)
				return
			}
		}
	}()

	deadline := time.Now().Add(maxSession)
	table := crc32.MakeTable(crc32.Castagnoli)
	var digest uint32
	var sentLevel qualityLevel
	idle := 0
	for {
		if ctx.Err() != nil {
			break
		}
		if time.Now().After(deadline) {
			return errors.New("the 12-hour session limit was reached")
		}
		if !onDefaultDesktop() {
			return errors.New("Windows switched to a locked or protected desktop")
		}
		lvl := level()
		frame, w, h, err := snapshot(lvl)
		if err != nil {
			return err
		}
		screenW.Store(int64(w))
		screenH.Store(int64(h))
		sum := crc32.Checksum(frame.Pix, table)
		if sum != digest || lvl != sentLevel {
			data, err := encodeJPEG(frame, lvl.jpeg)
			if err != nil {
				return err
			}
			select {
			case frames <- data:
				digest, sentLevel, idle = sum, lvl, 0
			case <-ctx.Done():
			}
		} else {
			idle++
		}
		if ctx.Err() != nil {
			break
		}
		if !onDefaultDesktop() || !sameScreen(w, h) {
			return errors.New("Windows desktop or display configuration changed")
		}
		// Look for changes about 30 times a second; after a second of a still
		// screen, check less often to save CPU.
		wait := 33 * time.Millisecond
		if idle > 30 {
			wait = 100 * time.Millisecond
		}
		if !pause(wait) {
			break
		}
	}
	select {
	case err := <-fail:
		return err
	default:
		return ctx.Err()
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
func serveUnattended(ctx context.Context, origin, key, name string, ra func() string, stopSession, initiate <-chan struct{}, updates chan<- unattendedUpdate) {
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
	for ctx.Err() == nil {
		if !onDefaultDesktop() {
			callUntil = time.Time{}
			updates <- unattendedUpdate{state: "locked", text: "Windows is locked. Remote access resumes after you sign in."}
			if !pause(3 * time.Second) {
				return
			}
			continue
		}
		served, err := unattendedRound(ctx, origin, key, name, ra, stopSession, initiate, &callUntil, updates)
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
func unattendedRound(parent context.Context, origin, key, name string, ra func() string, stopSession, initiate <-chan struct{}, callUntil *time.Time, updates chan<- unattendedUpdate) (served bool, err error) {
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
		target := ra()
		body := map[string]string{"name": name}
		if target != "" {
			body["ra"] = target
		}
		if err := r.postJSON(parent, "call", body, nil); err != nil {
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
		text := "Request sent. Waiting for IT to accept in the browser…"
		if target != "" {
			text = "Request sent to " + formatRA(target) + ". Waiting for them to accept in the portal…"
		}
		updates <- unattendedUpdate{state: "calling", text: text}
		return nil
	}
	if time.Now().Before(*callUntil) {
		if err := call(*callUntil); err != nil {
			return false, err
		}
	} else {
		updates <- unattendedUpdate{state: "ready", text: "Ready. IT can connect with this PC's access code, or select Initiate."}
	}
	refresh := time.Now().Add(2 * time.Minute)
	// Check for a viewer every 400 ms so an accepted request starts quickly.
	wait := time.NewTicker(400 * time.Millisecond)
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
		case <-wait.C:
		}
	}
	return false, nil
}
