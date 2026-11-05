package main

// License enforcement. A license key (config.license.key) is an Ed25519-signed
// token issued by the LSH license server; it is verified OFFLINE here with the
// embedded product public key, so no network call is needed to run. The tier it
// carries maps to the limits below.
//
//   free (no / invalid / expired key):  max 2 integrations, Loxone XML export
//                                        capped to 1 input + 1 output, no hotel
//   managed (499 PLN):                   unlimited integrations + Loxone export
//   hotel  (call):                       managed + hotel features (room service,
//                                        guest portal, booking)
//
// Nothing is enforced beyond these three points, and a free instance runs fine.

import (
	"crypto/ed25519"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"strings"
	"time"
)

// Product public key — matches license-server/data/keys.json. Verifies keys
// offline; the matching private key never leaves the license server.
const licensePublicKeyPEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAolScOPeT/BQprS+g74d9r1bjASr3xVuCBCpNAUBG4Dc=
-----END PUBLIC KEY-----`

type LicenseLimits struct {
	MaxIntegrations int // 0 = unlimited
	LoxoneInputs    int // 0 = unlimited
	LoxoneOutputs   int // 0 = unlimited
	Hotel           bool
}

var licenseTiers = map[string]LicenseLimits{
	"free":    {MaxIntegrations: 2, LoxoneInputs: 1, LoxoneOutputs: 1, Hotel: false},
	"managed": {MaxIntegrations: 0, LoxoneInputs: 0, LoxoneOutputs: 0, Hotel: false},
	"hotel":   {MaxIntegrations: 0, LoxoneInputs: 0, LoxoneOutputs: 0, Hotel: true},
}

type LicenseInfo struct {
	Tier     string
	Licensee string
	Exp      int64
	Limits   LicenseLimits
	Reason   string
}

func b64urlDec(s string) []byte {
	b, _ := base64.RawURLEncoding.DecodeString(strings.TrimRight(s, "="))
	return b
}

// verifyLicenseKey checks the signature offline and returns the payload, or nil.
func verifyLicenseKey(key string) map[string]any {
	parts := strings.Split(strings.TrimSpace(key), ".")
	if len(parts) != 3 || parts[0] != "LSH1" {
		return nil
	}
	block, _ := pem.Decode([]byte(licensePublicKeyPEM))
	if block == nil {
		return nil
	}
	pub, err := x509.ParsePKIXPublicKey(block.Bytes)
	if err != nil {
		return nil
	}
	edpub, ok := pub.(ed25519.PublicKey)
	if !ok {
		return nil
	}
	if !ed25519.Verify(edpub, []byte("LSH1."+parts[1]), b64urlDec(parts[2])) {
		return nil
	}
	var payload map[string]any
	if json.Unmarshal(b64urlDec(parts[1]), &payload) != nil {
		return nil
	}
	return payload
}

func resolveLicense(cfg map[string]any) *LicenseInfo {
	free := &LicenseInfo{Tier: "free", Limits: licenseTiers["free"]}
	lc, _ := cfg["license"].(map[string]any)
	if lc == nil {
		free.Reason = "no license"
		return free
	}
	key, _ := lc["key"].(string)
	if strings.TrimSpace(key) == "" {
		free.Reason = "no license key"
		return free
	}
	p := verifyLicenseKey(key)
	if p == nil {
		free.Reason = "invalid license key"
		return free
	}
	tier, _ := p["tier"].(string)
	lim, ok := licenseTiers[tier]
	if !ok {
		free.Reason = "unknown tier"
		return free
	}
	info := &LicenseInfo{Tier: tier, Limits: lim}
	if s, ok := p["licensee"].(string); ok {
		info.Licensee = s
	}
	if e, ok := p["exp"].(float64); ok {
		info.Exp = int64(e)
	}
	if info.Exp > 0 && time.Now().UnixMilli() > info.Exp {
		free.Reason = "license expired"
		return free
	}
	return info
}

// lic returns the resolved license, never nil (defaults to free).
func (s *Server) lic() *LicenseInfo {
	if s.license == nil {
		return &LicenseInfo{Tier: "free", Limits: licenseTiers["free"], Reason: "unresolved"}
	}
	return s.license
}
