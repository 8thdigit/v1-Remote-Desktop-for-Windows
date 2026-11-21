package main

import (
	"context"
	"crypto/sha256"
	"errors"
	"regexp"
	"runtime"
	"time"
)

var codeFormat = regexp.MustCompile(`^[A-F0-9]{12}$`)
var tokenFormat = regexp.MustCompile(`^[A-Za-z0-9_-]{43}$`)
var verifyFormat = regexp.MustCompile(`^[0-9]{6}$`)

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
