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
	"strings"
	"time"
)

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
		base: "https://" + u.Host + "/api/deskline/",
		client: &http.Client{
			Transport: tr, Timeout: 5 * time.Second,
			CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
		},
	}, nil
}

func (r *relay) post(ctx context.Context, path string, jpeg []byte, response any) error {
	req, err := http.NewRequestWithContext(ctx, "POST", r.base+path, bytes.NewReader(jpeg))
	if err != nil {
		return err
	}
	if len(jpeg) != 0 {
		req.Header.Set("Content-Type", "image/jpeg")
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
		if res.StatusCode == 410 {
			return errors.New("the session ended or expired")
		}
		if res.StatusCode == 429 {
			return errors.New("relay busy; wait a minute and try again")
		}
		return fmt.Errorf("relay rejected %s (HTTP %d)", path, res.StatusCode)
	}
	if response != nil {
		return json.Unmarshal(body, response)
	}
	return nil
}
