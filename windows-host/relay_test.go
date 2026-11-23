package main

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestRelayRequiresAnHTTPSOrigin(t *testing.T) {
	for _, value := range []string{
		"http://example.com", "https://name@example.com", "https://example.com/path",
		"https://example.com?query=yes", "https://example.com/#fragment", "https://",
	} {
		if _, err := newRelay(value); err == nil {
			t.Errorf("accepted invalid relay address %q", value)
		}
	}
	r, err := newRelay(" https://example.com:8443/ ")
	if err != nil {
		t.Fatal(err)
	}
	if r.base != "https://example.com:8443/api/msfwr/" {
		t.Errorf("unexpected relay route: %s", r.base)
	}
}

func TestTickAndEventsTalkToTheRelay(t *testing.T) {
	var gotType, gotEvents, gotWait string
	var gotBody []byte
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		switch req.URL.Path {
		case "/api/msfwr/tick":
			gotType, gotEvents = req.Header.Get("Content-Type"), req.Header.Get("X-Msfwr-Events")
			gotBody, _ = io.ReadAll(req.Body)
			w.Write([]byte(`{"state":"live","input":[],"patches":true,"key":true}`))
		case "/api/msfwr/events":
			gotWait = req.URL.Query().Get("wait")
			w.Write([]byte(`{"state":"live","input":[{"Kind":"move","X":0.5,"Y":0.25}]}`))
		default:
			http.NotFound(w, req)
		}
	}))
	defer srv.Close()
	r := &relay{base: srv.URL + "/api/msfwr/", token: strings.Repeat("a", 43), client: srv.Client()}
	ctx := context.Background()
	var reply tick
	body := packUpdates([]update{{key: true, jpeg: []byte{0xff, 0xd8, 0xff, 0xd9}}})
	if err := r.tick(ctx, body, true, &reply); err != nil {
		t.Fatal(err)
	}
	if gotType != "application/x-msfwr-frames" || gotEvents != "1" || len(gotBody) != len(body) || !reply.Patches || !reply.Key {
		t.Fatalf("tick: type %q events %q body %d reply %+v", gotType, gotEvents, len(gotBody), reply)
	}
	reply = tick{}
	if err := r.events(ctx, 4*time.Second, &reply); err != nil {
		t.Fatal(err)
	}
	if gotWait != "4000" || len(reply.Input) != 1 || reply.Input[0].Kind != "move" || reply.Input[0].Y != 0.25 {
		t.Fatalf("events: wait %q reply %+v", gotWait, reply)
	}
	// An older relay has no input channel.
	r.base = srv.URL + "/old/"
	var status *statusError
	if err := r.events(ctx, 0, &reply); !errors.As(err, &status) || status.status != 404 {
		t.Fatalf("old relay: %v", err)
	}
}

func TestEventStreamAndNumberedTicks(t *testing.T) {
	var gotSeq string
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		switch req.URL.Path {
		case "/api/msfwr/tick":
			gotSeq = req.Header.Get("X-Msfwr-Seq")
			w.Write([]byte(`{"state":"live","input":[],"patches":true,"pipeline":true,"quality":"sharp"}`))
		case "/api/msfwr/events":
			if req.URL.Query().Get("stream") != "1" {
				t.Error("events not asked to stream")
			}
			w.Header().Set("X-Msfwr-Stream", "1")
			w.Write([]byte(`{"state":"live","input":[]}` + "\n"))
			w.(http.Flusher).Flush()
			w.Write([]byte(`{"state":"live","input":[{"Kind":"key","Key":"a"}]}` + "\n"))
			w.Write([]byte(`{"state":"live","input":[],"end":true}` + "\n"))
		case "/old/events":
			w.Write([]byte(`{"state":"live","input":[]}`))
		case "/proxy/tick":
			w.WriteHeader(http.StatusBadGateway)
			w.Write([]byte(strings.Repeat("<p>proxy error</p>", 200000)))
		default:
			http.NotFound(w, req)
		}
	}))
	defer srv.Close()
	r := &relay{base: srv.URL + "/api/msfwr/", token: strings.Repeat("a", 43), client: srv.Client()}
	ctx := context.Background()
	var reply tick
	if err := r.tickSeq(ctx, nil, "", true, 7, &reply); err != nil {
		t.Fatal(err)
	}
	if gotSeq != "7" || !reply.Pipeline || reply.Quality != "sharp" {
		t.Fatalf("seq %q reply %+v", gotSeq, reply)
	}
	var keys []string
	lines := 0
	err := r.eventStream(ctx, func(t tick) error {
		lines++
		for _, e := range t.Input {
			keys = append(keys, e.Key)
		}
		return nil
	})
	if err != nil || lines != 3 || len(keys) != 1 || keys[0] != "a" {
		t.Fatalf("stream: err %v lines %d keys %v", err, lines, keys)
	}
	// A relay that answers events without streaming: fall back.
	r.base = srv.URL + "/old/"
	if err := r.eventStream(ctx, func(tick) error { return nil }); !errors.Is(err, errNoStream) {
		t.Fatalf("old relay: %v", err)
	}
	// A large proxy error page reports its HTTP status, not its size.
	r.base = srv.URL + "/proxy/"
	var status *statusError
	if err := r.tickSeq(ctx, nil, "", true, 1, &reply); !errors.As(err, &status) || status.status != 502 {
		t.Fatalf("proxy error: %v", err)
	}
}
