package main

// Auth — the request-path half of src/auth.js, on the same files: bcrypt
// users (persist/users.json), API tokens (persist/api-tokens.json) and
// HS256 JWT session cookies signed with config.jwtSecret, so a session from
// the Node core is valid here and the other way round.

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
)

const (
	cookieName       = "lsh-session"
	tokenTTL         = 7 * 24 * time.Hour
	loginMaxAttempts = 5
	loginWindow      = 15 * time.Minute
)

var apiTokenUser = map[string]any{"id": "api-token", "username": "api-token", "role": "admin"}

var publicAPI = []string{"/api/auth/login", "/api/auth/setup", "/api/auth/handoff/"}

type User struct {
	ID           string          `json:"id"`
	Username     string          `json:"username"`
	PasswordHash string          `json:"passwordHash"`
	Role         string          `json:"role"`
	Permissions  map[string]bool `json:"permissions,omitempty"`
	CreatedAt    string          `json:"createdAt,omitempty"`
}

type apiToken struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Token     string `json:"token"`
	CreatedAt string `json:"createdAt"`
}

type Auth struct {
	dir    string
	secret []byte

	mu       sync.Mutex
	users    []User
	usersAt  time.Time
	tokens   []apiToken
	tokensAt time.Time
	failures map[string][]time.Time
}

func NewAuth(persistDir, secret string) *Auth {
	if secret == "" {
		b := make([]byte, 32)
		rand.Read(b)
		secret = hex.EncodeToString(b)
	}
	return &Auth{dir: persistDir, secret: []byte(secret), failures: map[string][]time.Time{}}
}

// The Node core may change these files while we run — reload when the
// mtime moves instead of caching forever.
func reloadJSON[T any](path string, at *time.Time, into *[]T) {
	st, err := os.Stat(path)
	if err != nil {
		*into = nil
		return
	}
	if st.ModTime().Equal(*at) {
		return
	}
	b, err := os.ReadFile(path)
	if err != nil {
		return
	}
	var v []T
	if json.Unmarshal(b, &v) == nil {
		*into, *at = v, st.ModTime()
	}
}

func (a *Auth) loadUsers() []User {
	reloadJSON(filepath.Join(a.dir, "users.json"), &a.usersAt, &a.users)
	return a.users
}

func (a *Auth) loadTokens() []apiToken {
	reloadJSON(filepath.Join(a.dir, "api-tokens.json"), &a.tokensAt, &a.tokens)
	return a.tokens
}

func (a *Auth) HasUsers() bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	return len(a.loadUsers()) > 0
}

func (a *Auth) VerifyAPIToken(token string) bool {
	if token == "" {
		return false
	}
	a.mu.Lock()
	tokens := a.loadTokens()
	a.mu.Unlock()
	given := sha256.Sum256([]byte(token))
	ok := false
	for _, t := range tokens {
		d := sha256.Sum256([]byte(t.Token))
		if t.Token != "" && subtle.ConstantTimeCompare(given[:], d[:]) == 1 {
			ok = true
		}
	}
	return ok
}

func (a *Auth) Sign(u map[string]any) (string, error) {
	claims := jwt.MapClaims{"id": u["id"], "username": u["username"], "role": u["role"], "iat": time.Now().Unix(), "exp": time.Now().Add(tokenTTL).Unix()}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(a.secret)
}

func (a *Auth) VerifyJWT(token string) map[string]any {
	t, err := jwt.Parse(token, func(t *jwt.Token) (any, error) { return a.secret, nil }, jwt.WithValidMethods([]string{"HS256"}))
	if err != nil || !t.Valid {
		return nil
	}
	claims, _ := t.Claims.(jwt.MapClaims)
	return claims
}

// Authenticate returns the public user fields, or nil.
func (a *Auth) Authenticate(username, password string) map[string]any {
	a.mu.Lock()
	users := a.loadUsers()
	a.mu.Unlock()
	for _, u := range users {
		if strings.EqualFold(u.Username, username) {
			if bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(password)) == nil {
				return map[string]any{"id": u.ID, "username": u.Username, "role": u.Role}
			}
			return nil
		}
	}
	return nil
}

func (a *Auth) CreateFirstUser(username, password string) (map[string]any, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if len(a.loadUsers()) > 0 {
		return nil, errors.New("Already set up — sign in instead.")
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), 12)
	if err != nil {
		return nil, err
	}
	id := make([]byte, 8)
	rand.Read(id)
	u := User{ID: hex.EncodeToString(id), Username: strings.TrimSpace(username), PasswordHash: string(hash), Role: "admin",
		Permissions: map[string]bool{"flows": false, "claudeCode": false, "terminal": false}, CreatedAt: time.Now().UTC().Format(time.RFC3339)}
	b, _ := json.MarshalIndent([]User{u}, "", "  ")
	os.MkdirAll(a.dir, 0o755)
	if err := os.WriteFile(filepath.Join(a.dir, "users.json"), b, 0o600); err != nil {
		return nil, err
	}
	a.usersAt = time.Time{}
	return map[string]any{"id": u.ID, "username": u.Username, "role": u.Role, "permissions": u.Permissions}, nil
}

func (a *Auth) Permissions(userID string) map[string]bool {
	if userID == "api-token" {
		return map[string]bool{"flows": true, "claudeCode": true, "terminal": false}
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	out := map[string]bool{"flows": false, "claudeCode": false, "terminal": false}
	for _, u := range a.loadUsers() {
		if u.ID == userID {
			for k := range out {
				out[k] = u.Permissions[k]
			}
		}
	}
	return out
}

func (a *Auth) RateLimited(ip string) bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	return len(a.recent(ip)) >= loginMaxAttempts
}

func (a *Auth) recent(ip string) []time.Time {
	kept := a.failures[ip][:0]
	for _, t := range a.failures[ip] {
		if time.Since(t) < loginWindow {
			kept = append(kept, t)
		}
	}
	if len(kept) == 0 {
		delete(a.failures, ip)
	} else {
		a.failures[ip] = kept
	}
	return kept
}

func (a *Auth) LoginFailed(ip string) {
	a.mu.Lock()
	a.failures[ip] = append(a.recent(ip), time.Now())
	a.mu.Unlock()
}

func (a *Auth) LoginOK(ip string) {
	a.mu.Lock()
	delete(a.failures, ip)
	a.mu.Unlock()
}

func setSessionCookie(w http.ResponseWriter, r *http.Request, token string) {
	http.SetCookie(w, &http.Cookie{Name: cookieName, Value: token, Path: "/", HttpOnly: true, Secure: isSecure(r),
		SameSite: http.SameSiteLaxMode, MaxAge: int(tokenTTL.Seconds())})
}

func clearSessionCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{Name: cookieName, Value: "", Path: "/", MaxAge: -1})
}

func isSecure(r *http.Request) bool {
	return r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https"
}

// UserFor resolves a request's identity: ?token= (API token), Bearer (API
// token or JWT), then the session cookie. bad=true means credentials were
// given but invalid.
func (a *Auth) UserFor(r *http.Request) (user map[string]any, bad bool) {
	if qt := r.URL.Query().Get("token"); qt != "" {
		if a.VerifyAPIToken(qt) {
			return apiTokenUser, false
		}
		return nil, true
	}
	if h := r.Header.Get("Authorization"); strings.HasPrefix(h, "Bearer ") {
		t := h[7:]
		if a.VerifyAPIToken(t) {
			return apiTokenUser, false
		}
		if p := a.VerifyJWT(t); p != nil {
			return p, false
		}
		return nil, true
	}
	if c, err := r.Cookie(cookieName); err == nil && c.Value != "" {
		if p := a.VerifyJWT(c.Value); p != nil {
			return p, false
		}
	}
	return nil, false
}
