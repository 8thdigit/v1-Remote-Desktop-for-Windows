package main

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
)

// Per-company provisioning. A configured client is pre-fed its relay URL, RA
// ID and a signed license so the person at the PC does nothing. There are two
// sources, both optional:
//
//   - Build-time: a per-company installer bakes values in with
//     -ldflags "-X main.embeddedRelay=... -X main.embeddedRA=... -X main.embeddedLicense=...".
//   - Runtime: a winrss-client.json file next to the app's data, which the
//     admin console generates. It takes precedence over the baked-in values,
//     so one signed build can serve many companies.
//
// The license is opaque to the client; the relay signs and validates it. The
// client only carries it back on registration.

var (
	embeddedRelay   string
	embeddedRA      string
	embeddedLicense string
)

const clientConfigFile = "winrss-client.json"

// clientProvisioning is the winrss-client.json shape the admin console emits.
type clientProvisioning struct {
	Version int    `json:"version"`
	Company string `json:"company,omitempty"`
	Relay   string `json:"relay"`
	RA      string `json:"raId"`
	License string `json:"license"`
}

// normalizeLicense accepts the relay's license token
// (L1.<account>.<ra>.<version>.<issued>.<signature>) and nothing else. An
// empty value is valid and means "no license".
func normalizeLicense(value string) (string, bool) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", true
	}
	parts := strings.Split(value, ".")
	if len(parts) != 6 || parts[0] != "L1" || len(value) > 300 {
		return "", false
	}
	for _, p := range parts {
		if p == "" {
			return "", false
		}
		for _, r := range p {
			ok := (r >= 'A' && r <= 'Z') || (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '-' || r == '_'
			if !ok {
				return "", false
			}
		}
	}
	return value, true
}

// loadClientConfig reads winrss-client.json. ok=false means it is not present.
// A present-but-invalid file is an error so provisioning is not silently wrong.
func loadClientConfig(path string) (clientProvisioning, bool, error) {
	var c clientProvisioning
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return c, false, nil
	}
	if err != nil {
		return c, false, err
	}
	if err := json.Unmarshal(data, &c); err != nil {
		return c, false, errors.New("the client configuration file is damaged")
	}
	r, err := newRelay(c.Relay)
	if err != nil {
		return c, false, errors.New("the client configuration has an invalid relay URL")
	}
	c.Relay = r.origin
	ra, ok := normalizeRA(c.RA)
	if !ok || ra == "" {
		return c, false, errors.New("the client configuration has an invalid RA ID")
	}
	c.RA = ra
	license, ok := normalizeLicense(c.License)
	if !ok {
		return c, false, errors.New("the client configuration has an invalid license")
	}
	c.License = license
	return c, true, nil
}

// provisioning resolves the effective relay, RA ID and license for this
// install: the config file when present, otherwise the baked-in build values.
// present is false when neither source is configured.
func provisioning(clientConfigPath string) (relay, ra, license string, present bool, err error) {
	if clientConfigPath != "" {
		if c, ok, cerr := loadClientConfig(clientConfigPath); cerr != nil {
			return "", "", "", false, cerr
		} else if ok {
			return c.Relay, c.RA, c.License, true, nil
		}
	}
	if embeddedRelay == "" && embeddedRA == "" {
		return "", "", "", false, nil
	}
	r, rerr := newRelay(embeddedRelay)
	if rerr != nil {
		return "", "", "", false, errors.New("this build has an invalid embedded relay URL")
	}
	eRA, ok := normalizeRA(embeddedRA)
	if !ok || eRA == "" {
		return "", "", "", false, errors.New("this build has an invalid embedded RA ID")
	}
	eLic, ok := normalizeLicense(embeddedLicense)
	if !ok {
		return "", "", "", false, errors.New("this build has an invalid embedded license")
	}
	return r.origin, eRA, eLic, true, nil
}

// applyProvisioning sets up unattended access from the provisioning so a
// configured client runs with no manual steps. It preserves any existing
// unattended key, so a PC that is re-provisioned keeps its access code.
// relayPrefill is the relay to show in the attended window when the PC is not
// (yet) provisioned for unattended use. provisioned reports whether unattended
// access was written from provisioning.
func applyProvisioning(clientConfigPath, unattendedPath string) (relayPrefill string, provisioned bool, err error) {
	relay, ra, license, present, perr := provisioning(clientConfigPath)
	if perr != nil {
		return "", false, perr
	}
	if !present {
		return "", false, nil
	}
	if unattendedPath == "" {
		return relay, false, nil
	}
	c, ok, _ := loadUnattended(unattendedPath)
	if !ok {
		key, kerr := newUnattendedKey()
		if kerr != nil {
			return relay, false, kerr
		}
		c = unattendedConfig{Key: key}
	}
	// Re-provisioning only changes the relay, RA and license; the key (and so
	// the access code) stays. If nothing changed, do not rewrite the file.
	if c.Relay == relay && c.RA == ra && c.License == license && ok {
		return relay, true, nil
	}
	c.Relay = relay
	c.RA = ra
	c.License = license
	if err := saveUnattended(unattendedPath, c); err != nil {
		return relay, false, err
	}
	return relay, true, nil
}

// locateClientConfig returns the first winrss-client.json that exists among
// the candidate directories, or "" if none has one. The admin drops the file
// next to the installer or in the app's config directory.
func locateClientConfig(dirs []string) string {
	for _, dir := range dirs {
		if dir == "" {
			continue
		}
		path := filepath.Join(dir, clientConfigFile)
		if info, err := os.Stat(path); err == nil && !info.IsDir() {
			return path
		}
	}
	return ""
}

// standingBody builds the registration payload for the relay, including the
// license when the PC has one. Kept here (not in the Windows-only file) so it
// is covered by tests.
func standingBody(c unattendedConfig, name string) map[string]string {
	body := map[string]string{"key": c.Key, "name": name, "ra": c.RA}
	if c.License != "" {
		body["license"] = c.License
	}
	return body
}

// subscriptionBlocked reports the tray text for a relay that refused
// registration because the company's subscription is not active (HTTP 402),
// and ok=false for anything else. The caller shows the text and backs off
// instead of treating it as a lost relay.
func subscriptionBlocked(err error) (string, bool) {
	var s *statusError
	if !errors.As(err, &s) || s.status != 402 {
		return "", false
	}
	if s.text != "" && s.text != "relay rejected standing (HTTP 402)" {
		return s.text, true
	}
	return "This PC's company subscription is not active. Contact your provider.", true
}
