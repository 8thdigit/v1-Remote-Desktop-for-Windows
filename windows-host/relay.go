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

var codeFormat = regexp.MustCompile(`^(L[0-9A-F]|S[0-9A-F]{11}|[A-F0-9]{12})$`)
var linkCodeFormat = regexp.MustCompile(`^L[0-9A-F]{11}$`)
var tokenFormat = regexp.MustCompile(`^[A-Za-z0-9_-]{43}$`)
var verifyFormat = regexp.MustCompile(`^[0-9]{6}$`)

type relay struct {
	origin      string
	base, token string
	client      *http.Client
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
	return &relay{
		origin: "https://" + u.Host,
		base:   "https://" + u.Host + "/api/deskline/",
		client: &http.Client{
			Transport: tr, Timeout: 5 * time.Second,
			CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
		},
	}, nil
}

// statusError is a relay HTTP error, so callers can tell a rejected request
// from a network failure.
type statusError struct {
	status int
	text   string
}

func (e *statusError) Error() string { return e.text }

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

func (r *relay) get(ctx context.Context, path string, response any) error {
	req, err := http.NewRequestWithContext(ctx, "GET", r.base+path, nil)
	if err != nil {
		return err
	}
	if r.token != "" {
		req.Header.Set("Authorization", "Bearer "+r.token)
	}
	res, err := r.client.Do(req)
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
		return &statusError{status: res.StatusCode, text: fmt.Sprintf("relay rejected %s (HTTP %d)", path, res.StatusCode)}
	}
	if response != nil {
		return json.Unmarshal(body, response)
	}
	return nil
}

// remoteLink is a shareable unattended-access URL. The id identifies the
// link; key authorizes host operations (re-registration, status, revoke).
type remoteLink struct {
	ID        string `json:"id"`
	Code      string `json:"code"`
	Key       string `json:"key"`
	Name      string `json:"name"`
	CreatedAt int64  `json:"createdAt"`
	ExpiresAt int64  `json:"expiresAt"`
	Sessions  int    `json:"sessions"`
}

func (l *remoteLink) URL(origin string) string {
	return origin + "/?access=" + l.Code
}

type linkCreateRequest struct {
	Key      string `json:"key"`
	Name     string `json:"name,omitempty"`
	TTLHours int    `json:"ttlHours,omitempty"`
}

func (r *relay) createLink(ctx context.Context, key, name string, hours int) (*remoteLink, error) {
	var out remoteLink
	if err := r.postJSON(ctx, "link/create", linkCreateRequest{Key: key, Name: name, TTLHours: hours}, &out); err != nil {
		return nil, err
	}
	if !linkCodeFormat.MatchString(out.Code) || out.ID == "" {
		return nil, errors.New("relay returned an unusable link")
	}
	out.Key = key
	return &out, nil
}

// registerLink re-arms a link host so another session can be opened through
// the shared URL after the previous one ended.
func (r *relay) registerLink(ctx context.Context, id, key string) (string, error) {
	var out invite
	if err := r.postJSON(ctx, "link/register", map[string]string{"id": id, "key": key}, &out); err != nil {
		return "", err
	}
	return out.Token, nil
}

type linkStatusResult struct {
	Link   remoteLink `json:"link"`
	Online bool       `json:"online"`
	Busy   bool       `json:"busy"`
}

func (r *relay) linkStatus(ctx context.Context, id, key string) (*linkStatusResult, error) {
	var out linkStatusResult
	path := "link/status?id=" + url.QueryEscape(id) + "&key=" + url.QueryEscape(key)
	if err := r.get(ctx, path, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (r *relay) revokeLink(ctx context.Context, id, key string) error {
	return r.postJSON(ctx, "link/revoke", map[string]string{"id": id, "key": key}, nil)
}

func (r *relay) send(ctx context.Context, path string, payload []byte, contentType string, response any) error {
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
	res, err := r.client.Do(req)
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
