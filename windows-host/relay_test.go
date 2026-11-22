package main

import "testing"

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
