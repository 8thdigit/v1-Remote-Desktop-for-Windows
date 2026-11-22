package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func validLicense() string {
	// Shape only; the relay signs and validates for real.
	return "L1.aBcD1234_-xy.123456.3.kf8d2.sigValue_-AB"
}

func TestNormalizeLicense(t *testing.T) {
	if v, ok := normalizeLicense(""); !ok || v != "" {
		t.Fatalf("empty license should be valid and empty, got %q %v", v, ok)
	}
	if v, ok := normalizeLicense("  " + validLicense() + "  "); !ok || v != validLicense() {
		t.Fatalf("valid license should pass trimmed, got %q %v", v, ok)
	}
	for _, bad := range []string{"L1.only.three.parts", "X1.a.b.c.d.e", "L1.a.b.c.d.e.f", "L1..b.c.d.e", "L1.a.b.c.d.e!"} {
		if _, ok := normalizeLicense(bad); ok {
			t.Fatalf("expected %q to be rejected", bad)
		}
	}
}

func TestLoadClientConfig(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, clientConfigFile)

	if _, ok, err := loadClientConfig(path); ok || err != nil {
		t.Fatalf("absent config should be ok=false with no error, got ok=%v err=%v", ok, err)
	}

	write := func(v any) {
		data, _ := json.Marshal(v)
		if err := os.WriteFile(path, data, 0o600); err != nil {
			t.Fatal(err)
		}
	}

	write(clientProvisioning{Version: 1, Company: "Acme", Relay: "https://relay.example.com/", RA: "RA-123456", License: validLicense()})
	c, ok, err := loadClientConfig(path)
	if !ok || err != nil {
		t.Fatalf("valid config should load, got ok=%v err=%v", ok, err)
	}
	if c.Relay != "https://relay.example.com" || c.RA != "123456" || c.License != validLicense() {
		t.Fatalf("config not normalized: %+v", c)
	}

	write(clientProvisioning{Relay: "http://insecure.example.com", RA: "123456", License: validLicense()})
	if _, _, err := loadClientConfig(path); err == nil {
		t.Fatal("expected an error for a non-https relay")
	}
	write(clientProvisioning{Relay: "https://relay.example.com", RA: "12", License: validLicense()})
	if _, _, err := loadClientConfig(path); err == nil {
		t.Fatal("expected an error for a bad RA ID")
	}
	write(clientProvisioning{Relay: "https://relay.example.com", RA: "123456", License: "not-a-license"})
	if _, _, err := loadClientConfig(path); err == nil {
		t.Fatal("expected an error for a bad license")
	}
}

func TestProvisioningPrefersConfigFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, clientConfigFile)
	data, _ := json.Marshal(clientProvisioning{Version: 1, Relay: "https://file.example.com", RA: "222222", License: validLicense()})
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatal(err)
	}
	// Even with embedded build values set, the file wins.
	embeddedRelay, embeddedRA, embeddedLicense = "https://baked.example.com", "111111", validLicense()
	defer func() { embeddedRelay, embeddedRA, embeddedLicense = "", "", "" }()
	relay, ra, _, present, err := provisioning(path)
	if err != nil || !present {
		t.Fatalf("expected present provisioning, got present=%v err=%v", present, err)
	}
	if relay != "https://file.example.com" || ra != "222222" {
		t.Fatalf("config file should take precedence, got relay=%q ra=%q", relay, ra)
	}
}

func TestProvisioningFallsBackToEmbedded(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, clientConfigFile) // absent
	embeddedRelay, embeddedRA, embeddedLicense = "https://baked.example.com/", "111111", validLicense()
	defer func() { embeddedRelay, embeddedRA, embeddedLicense = "", "", "" }()
	relay, ra, lic, present, err := provisioning(path)
	if err != nil || !present || relay != "https://baked.example.com" || ra != "111111" || lic != validLicense() {
		t.Fatalf("embedded fallback failed: relay=%q ra=%q present=%v err=%v", relay, ra, present, err)
	}
}

func TestProvisioningAbsentWhenNothingConfigured(t *testing.T) {
	dir := t.TempDir()
	if _, _, _, present, err := provisioning(filepath.Join(dir, clientConfigFile)); present || err != nil {
		t.Fatalf("expected no provisioning, got present=%v err=%v", present, err)
	}
}

func TestApplyProvisioningSetsUpUnattendedAndKeepsKey(t *testing.T) {
	dir := t.TempDir()
	cfg := filepath.Join(dir, clientConfigFile)
	un := filepath.Join(dir, unattendedFile)
	data, _ := json.Marshal(clientProvisioning{Version: 1, Relay: "https://relay.example.com", RA: "123456", License: validLicense()})
	if err := os.WriteFile(cfg, data, 0o600); err != nil {
		t.Fatal(err)
	}

	relay, provisioned, err := applyProvisioning(cfg, un)
	if err != nil || !provisioned || relay != "https://relay.example.com" {
		t.Fatalf("first apply failed: relay=%q provisioned=%v err=%v", relay, provisioned, err)
	}
	c1, ok, err := loadUnattended(un)
	if !ok || err != nil {
		t.Fatalf("unattended should be set up, ok=%v err=%v", ok, err)
	}
	if c1.RA != "123456" || c1.License != validLicense() || c1.Key == "" {
		t.Fatalf("unattended not provisioned: %+v", c1)
	}

	// Re-provisioning with the same values keeps the key (and access code).
	if _, _, err := applyProvisioning(cfg, un); err != nil {
		t.Fatal(err)
	}
	c2, _, _ := loadUnattended(un)
	if c2.Key != c1.Key {
		t.Fatal("re-provisioning must keep the existing unattended key")
	}
}

func TestStandingBodyIncludesLicenseOnlyWhenSet(t *testing.T) {
	with := standingBody(unattendedConfig{Key: "k", RA: "123456", License: validLicense()}, "PC")
	if with["license"] != validLicense() || with["ra"] != "123456" || with["key"] != "k" || with["name"] != "PC" {
		t.Fatalf("unexpected body: %+v", with)
	}
	without := standingBody(unattendedConfig{Key: "k", RA: "123456"}, "PC")
	if _, present := without["license"]; present {
		t.Fatal("license key should be omitted when empty")
	}
}

func TestSubscriptionBlocked(t *testing.T) {
	msg, ok := subscriptionBlocked(&statusError{status: 402, text: "This company's subscription has expired."})
	if !ok || msg != "This company's subscription has expired." {
		t.Fatalf("expected the 402 message, got %q %v", msg, ok)
	}
	if _, ok := subscriptionBlocked(&statusError{status: 409, text: "x"}); ok {
		t.Fatal("non-402 should not be treated as a subscription block")
	}
	if _, ok := subscriptionBlocked(os.ErrClosed); ok {
		t.Fatal("a non-status error should not be treated as a subscription block")
	}
}

func TestLocateClientConfig(t *testing.T) {
	a := t.TempDir()
	b := t.TempDir()
	if got := locateClientConfig([]string{a, b}); got != "" {
		t.Fatalf("expected none, got %q", got)
	}
	want := filepath.Join(b, clientConfigFile)
	if err := os.WriteFile(want, []byte("{}"), 0o600); err != nil {
		t.Fatal(err)
	}
	if got := locateClientConfig([]string{"", a, b}); got != want {
		t.Fatalf("expected %q, got %q", want, got)
	}
}
