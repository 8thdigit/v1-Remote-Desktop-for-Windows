package main

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
)

var codeFormat = regexp.MustCompile(`^[A-F0-9]{12}$`)
var tokenFormat = regexp.MustCompile(`^[A-Za-z0-9_-]{43}$`)
var verifyFormat = regexp.MustCompile(`^[0-9]{6}$`)

type relay struct {
	origin      string
	base, token string
	client      *http.Client
	// long serves requests the relay holds open (input long polls).
	long *http.Client
	// pulls asks the relay to keep input for /pull instead of returning it
	// with each tick.
	pulls bool
}

type invite struct{ Code, Token string }

type tick struct {
	State, Verification string
	Input               []event
}

type event struct {
	Kind, Key        string
	X, Y             float64
	Button, Delta    int
	Ctrl, Shift, Alt bool
}

func newRelay(value string) (*relay, error) {
	u, err := url.Parse(strings.TrimSpace(value))
	if err != nil || u.Scheme != "https" || u.Hostname() == "" || u.User != nil || u.ForceQuery ||
		u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") {
		return nil, errors.New("enter only the relay origin, such as https://support.example.com")
	}
	tr := http.DefaultTransport.(*http.Transport).Clone()
	tr.TLSClientConfig = &tls.Config{MinVersion: tls.VersionTLS12}
	// Frame uploads and the input long poll run side by side; keep both
	// connections warm instead of reconnecting (TLS) for each request.
	tr.MaxIdleConnsPerHost = 4
	tr.IdleConnTimeout = 90 * time.Second
	noRedirect := func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	return &relay{
		origin: "https://" + u.Host,
		base:   "https://" + u.Host + "/api/deskline/",
		client: &http.Client{Transport: tr, Timeout: 8 * time.Second, CheckRedirect: noRedirect},
		long:   &http.Client{Transport: tr, Timeout: 16 * time.Second, CheckRedirect: noRedirect},
	}, nil
}

// statusError is a relay HTTP error, so callers can tell a rejected request
// from a network failure.
type statusError struct {
	status int
	text   string
}

func (e *statusError) Error() string { return e.text }

// transient reports errors worth retrying within a live session: network
// failures, timeouts and relay overload, but not an ended session.
func transient(err error) bool {
	var s *statusError
	if errors.As(err, &s) {
		return s.status == 429 || s.status >= 500
	}
	return !errors.Is(err, context.Canceled)
}

func (r *relay) post(ctx context.Context, path string, jpeg []byte, response any) error {
	return r.send(ctx, path, jpeg, "image/jpeg", response)
}

func (r *relay) postJSON(ctx context.Context, path string, body, response any) error {
	data, err := json.Marshal(body)
	if err != nil {
		return err
	}
	return r.send(ctx, path, data, "application/json", response)
}

// pull waits (up to about ten seconds) for viewer input.
func (r *relay) pull(ctx context.Context, response *tick) error {
	return r.do(ctx, r.long, "pull", nil, "", response)
}

func (r *relay) send(ctx context.Context, path string, payload []byte, contentType string, response any) error {
	return r.do(ctx, r.client, path, payload, contentType, response)
}

func (r *relay) do(ctx context.Context, client *http.Client, path string, payload []byte, contentType string, response any) error {
	req, err := http.NewRequestWithContext(ctx, "POST", r.base+path, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	if len(payload) != 0 {
		req.Header.Set("Content-Type", contentType)
	}
	if r.token != "" {
		req.Header.Set("Authorization", "Bearer "+r.token)
	}
	if r.pulls && path == "tick" {
		req.Header.Set("X-Deskline-Pull", "1")
	}
	res, err := client.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	body, err := io.ReadAll(io.LimitReader(res.Body, 65537))
	if err != nil {
		return err
	}
	if len(body) > 65536 {
		return errors.New("relay response exceeded limit")
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		text := fmt.Sprintf("relay rejected %s (HTTP %d)", path, res.StatusCode)
		if res.StatusCode == 410 {
			text = "the session ended or expired"
		} else if res.StatusCode == 429 {
			text = "relay busy; wait a minute and try again"
		}
		return &statusError{status: res.StatusCode, text: text}
	}
	if response != nil {
		return json.Unmarshal(body, response)
	}
	return nil
}
