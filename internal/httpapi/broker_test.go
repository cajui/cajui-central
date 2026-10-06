package httpapi

import (
	"github.com/cajui/cajui-central/internal/mqttingest"
	"github.com/cajui/cajui-central/internal/storage"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

type brokerFixture struct{}

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
	h, err := New(db, token, nil, WithBroker(brokerFixture{}, ReceiverSetup{Username: "receiver-1", PasswordFile: path}))
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
	for _, value := range []string{"", strings.Repeat("x", 129), "bad secret"} {
		if err := os.WriteFile(path, []byte(value), 0600); err != nil {
			t.Fatal(err)
		}
		if call("POST", "/ui-api/receiver-credentials", "{}", nil) != 503 {
			t.Fatal("invalid secret accepted")
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
