package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/cajui/cajui-central/internal/devicestate"
	"github.com/cajui/cajui-central/internal/mqttingest"
	"github.com/cajui/cajui-central/internal/storage"
)

type brokerFixture struct{}

func (brokerFixture) Configured() bool { return true }

func (brokerFixture) Diagnostics() mqttingest.Diagnostics {
	return mqttingest.Diagnostics{Configured: true, Connected: true, Host: "broker", Port: 1883}
}
func TestBrokerCredentialBoundaries(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "credential")
	if err := os.WriteFile(path, []byte("fixture-password\n"), 0600); err != nil {
		t.Fatal(err)
	}
	db, err := storage.Open(filepath.Join(dir, "db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	var logs bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&logs, nil))
	h, err := New(db, token, logger, WithBroker(brokerFixture{}, ReceiverSetup{Username: "receiver-1", PasswordFile: path}))
	if err != nil {
		t.Fatal(err)
	}
	capability := workspaceSnapshot(t, h, "/broker").UIToken
	call := func(method, endpoint, body string, alter func(*http.Request)) int {
		w := workspaceEdit(h, endpoint, body, capability, func(r *http.Request) {
			r.Method = method
			if alter != nil {
				alter(r)
			}
		})
		if method == "GET" && (strings.Contains(w.Body.String(), "fixture-password") || strings.Contains(w.Body.String(), dir)) {
			t.Fatal("secret in status")
		}
		return w.Code
	}
	if call("GET", "/ui-api/broker", "", nil) != 200 {
		t.Fatal("status failed")
	}
	for _, endpoint := range []string{"/ui-api/broker", "/ui-api/receiver-credentials"} {
		method := "POST"
		if endpoint == "/ui-api/broker" {
			method = "GET"
		}
		if call(method, endpoint, "{}", func(r *http.Request) { r.Header.Del("X-Cajui-Workspace") }) != 403 {
			t.Fatal("missing capability accepted")
		}
	}
	if call("POST", "/ui-api/receiver-credentials", "{}", func(r *http.Request) { r.Header.Set("Origin", "https://attacker.example") }) != 403 {
		t.Fatal("cross origin accepted")
	}
	if call("POST", "/ui-api/receiver-credentials", `{"path":"other"}`, nil) != 400 {
		t.Fatal("browser path accepted")
	}
	w := workspaceEdit(h, "/ui-api/receiver-credentials", "{}", capability, func(r *http.Request) { r.Method = "POST" })
	if w.Code != 200 || !strings.Contains(w.Body.String(), "fixture-password") || !strings.Contains(w.Header().Get("Cache-Control"), "no-store") {
		t.Fatal(w.Code, w.Header())
	}
	if err := os.WriteFile(path, []byte(strings.Repeat("x", 64)+"\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if call("POST", "/ui-api/receiver-credentials", "{}", nil) != 200 {
		t.Fatal("firmware maximum rejected")
	}
	for _, value := range []string{"", strings.Repeat("x", 65), strings.Repeat("x", 129), "bad secret"} {
		if err := os.WriteFile(path, []byte(value), 0600); err != nil {
			t.Fatal(err)
		}
		if call("POST", "/ui-api/receiver-credentials", "{}", nil) != 503 {
			t.Fatal("invalid secret accepted")
		}
	}
	for _, reason := range []string{"invalid_length", "file_too_large", "invalid_character"} {
		if !strings.Contains(logs.String(), reason) {
			t.Fatal("missing category", reason)
		}
	}
	for _, secret := range []string{path, "fixture-password", "bad secret", strings.Repeat("x", 65)} {
		if strings.Contains(logs.String(), secret) {
			t.Fatal("private value in logs")
		}
	}
	os.Remove(path)
	if err := os.Symlink("missing", path); err != nil {
		t.Fatal(err)
	}
	if call("POST", "/ui-api/receiver-credentials", "{}", nil) != 503 {
		t.Fatal("symlink accepted")
	}
}

type receiverOnlyRepository struct {
	Repository
	calls int
}

func (r *receiverOnlyRepository) DeviceStates(context.Context) ([]devicestate.Stored, error) {
	r.calls++
	return []devicestate.Stored{{State: devicestate.State{Role: "receiver", DeviceID: "0000000000000001"}}, {State: devicestate.State{Role: "transmitter"}}}, nil
}
func TestReceiverStatesUsesOnlyStateRepositoryAndRequiresCapability(t *testing.T) {
	repo := &receiverOnlyRepository{}
	// Capture the capability without calling the HTML page: inspect the option hook.
	var capability string
	h, err := New(repo, token, nil, func(s *server) { capability = s.uiToken })
	if err != nil {
		t.Fatal(err)
	}
	for _, host := range []string{"localhost", "evil.example"} {
		w := workspaceEdit(h, "/ui-api/receiver-states", "", capability, func(r *http.Request) { r.Method = "GET"; r.Host = host })
		if host != "localhost" {
			if w.Code != 403 {
				t.Fatal(w.Code)
			}
			continue
		}
		if w.Code != 200 {
			t.Fatal(w.Code, w.Body)
		}
		var out struct {
			GeneratedAt time.Time            `json:"generated_at"`
			States      []devicestate.Stored `json:"device_states"`
		}
		if err = json.Unmarshal(w.Body.Bytes(), &out); err != nil || out.GeneratedAt.IsZero() || len(out.States) != 1 || out.States[0].Role != "receiver" {
			t.Fatal(out, err)
		}
	}
	w := workspaceEdit(h, "/ui-api/receiver-states", "", "wrong", func(r *http.Request) { r.Method = "GET" })
	if w.Code != 403 || repo.calls != 1 {
		t.Fatal(w.Code, repo.calls)
	}
}
func TestBrokerDoesNotInferReceiverAddress(t *testing.T) {
	db, err := storage.Open(filepath.Join(t.TempDir(), "db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	h, err := New(db, token, nil, WithBroker(brokerFixture{}, ReceiverSetup{}))
	if err != nil {
		t.Fatal(err)
	}
	capability := workspaceSnapshot(t, h, "/broker").UIToken
	w := workspaceEdit(h, "/ui-api/broker", "", capability, func(r *http.Request) { r.Method = "GET" })
	var d map[string]any
	if err = json.Unmarshal(w.Body.Bytes(), &d); err != nil || d["receiver_host"] != "" {
		t.Fatal(d, err)
	}
}
