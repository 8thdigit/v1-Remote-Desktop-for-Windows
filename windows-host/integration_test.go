//go:build integration

package main

// Runs this PC client's relay calls against a real relay. Start the relay
// behind HTTPS, create a company whose RA ID is in MSFWR_TEST_RA, then:
//   MSFWR_TEST_RELAY=https://localhost:8443 MSFWR_TEST_RA=424242 go test -tags integration -run Integration .

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestIntegrationWithRelay(t *testing.T) {
	origin, ra := os.Getenv("MSFWR_TEST_RELAY"), os.Getenv("MSFWR_TEST_RA")
	if origin == "" || ra == "" {
		t.Skip("set MSFWR_TEST_RELAY and MSFWR_TEST_RA")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	key, err := newUnattendedKey()
	if err != nil {
		t.Fatal(err)
	}
	r, err := newRelay(origin)
	if err != nil {
		t.Fatal(err)
	}

	// Registration names the RA ID; the relay says which company it is.
	var inv invite
	if err := r.postJSON(ctx, "standing", map[string]string{"key": key, "name": "GO-TEST-PC", "ra": "RA-" + ra}, &inv); err != nil {
		t.Fatal(err)
	}
	if inv.Code != standingCode(key) || inv.RaStatus != "ok" || inv.RaName == "" {
		t.Fatalf("standing = %+v", inv)
	}
	t.Log(raStatusText(ra, inv.RaStatus, inv.RaName))
	r.token = inv.Token
	if err := r.postJSON(ctx, "call", map[string]string{"name": "GO-TEST-PC"}, nil); err != nil {
		t.Fatal("Initiate:", err)
	}
	err = r.postJSON(ctx, "call", map[string]string{"name": "GO-TEST-PC", "ra": "000001"}, nil)
	if text, ok := initiateRejected(err); !ok || text == "" {
		t.Fatalf("an unknown RA ID was not reported: %v", err)
	}

	// Remote access URL: create, check it is open, restore, clear.
	path := filepath.Join(t.TempDir(), "links.json")
	l, err := createRemoteLink(ctx, path, origin, key, "GO-TEST-PC", 4)
	if err != nil {
		t.Fatal(err)
	}
	if !pinFormat.MatchString(l.Pin) || !linkCodeFormat.MatchString(l.Code) || l.ExpiresAt-l.CreatedAt != 4*3600*1000 {
		t.Fatalf("created link = %+v", l)
	}
	t.Log("URL:", l.shareURL(), "access code:", l.Pin)
	info := func() (int, map[string]any) {
		req, _ := http.NewRequestWithContext(ctx, "GET", r.base+"link/info?code="+l.Code, nil)
		res, err := r.client.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		var out map[string]any
		_ = json.NewDecoder(res.Body).Decode(&out)
		return res.StatusCode, out
	}
	if status, out := info(); status != 200 || out["online"] != true || out["name"] != "GO-TEST-PC" {
		t.Fatalf("link info = %d %v", status, out)
	}
	if err := r.restoreLink(ctx, l); err != nil {
		t.Fatal("restore:", err)
	}
	// A second link replaces the first one.
	second, err := createRemoteLink(ctx, path, origin, key, "GO-TEST-PC", 24)
	if err != nil {
		t.Fatal(err)
	}
	if status, _ := info(); status != 404 {
		t.Fatalf("the replaced link still works: %d", status)
	}
	if saved, _ := loadLink(path, time.Now()); saved == nil || saved.ID != second.ID {
		t.Fatalf("saved link = %+v", saved)
	}
	l = second
	if err := clearRemoteLink(ctx, path); err != nil {
		t.Fatal("clear:", err)
	}
	if status, _ := info(); status != 404 {
		t.Fatalf("a cleared link still works: %d", status)
	}
	if saved, _ := loadLink(path, time.Now()); saved != nil {
		t.Fatal("the cleared link is still saved")
	}
	var status *statusError
	if err := r.restoreLink(ctx, savedLink{ID: "nopenope", Key: key, Pin: "123456", ExpiresAt: time.Now().Add(-time.Minute).UnixMilli()}); !errors.As(err, &status) || status.status != 410 {
		t.Fatalf("restoring an expired link = %v", err)
	}
	_ = r.post(ctx, "end", nil, nil)
}
