package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/romulostorel/cajui-central/internal/storage"
	"github.com/romulostorel/cajui-central/internal/telemetry"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

const token = "test-token-not-for-production-123456"
const payload = `{"node_id":"node","sensor_id":"sensor","session_id":"boot","sequence":0,"metric":"temperature","value":0,"unit":"degC"}`

func testHandler(t *testing.T) http.Handler {
	t.Helper()
	s, err := storage.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = s.Close() })
	h, err := New(s, token, nil)
	if err != nil {
		t.Fatal(err)
	}
	return h
}
func request(h http.Handler, method, path, body, auth, content string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, path, strings.NewReader(body))
	r.Header.Set("Authorization", auth)
	r.Header.Set("Content-Type", content)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}
func TestIngestionAndDashboard(t *testing.T) {
	h := testHandler(t)
	if w := request(h, "GET", "/", "", "", ""); w.Code != 200 || !strings.Contains(w.Body.String(), "No readings") {
		t.Fatal(w.Code, w.Body)
	}
	for _, status := range []int{201, 200} {
		w := request(h, "POST", "/api/v1/readings", payload, "Bearer "+token, "application/json")
		if w.Code != status {
			t.Fatal(w.Code, w.Body)
		}
	}
	w := request(h, "GET", "/api/v1/readings", "", "Bearer "+token, "")
	var list []telemetry.Reading
	if err := json.Unmarshal(w.Body.Bytes(), &list); err != nil || w.Code != 200 || len(list) != 1 || list[0].Value != 0 || list[0].ReceivedAt.IsZero() {
		t.Fatal(w.Code, list, err)
	}
	w = request(h, "POST", "/api/v1/readings", strings.Replace(payload, `"value":0`, `"value":1`, 1), "Bearer "+token, "application/json")
	if w.Code != 409 {
		t.Fatal(w.Code, w.Body)
	}
	w = request(h, "GET", "/", "", "", "")
	if w.Code != 200 || !strings.Contains(w.Body.String(), "temperature") {
		t.Fatal(w.Code, w.Body)
	}
	if w.Header().Get("Content-Security-Policy") == "" {
		t.Fatal("missing CSP")
	}
	if w = request(h, "GET", "/healthz", "", "", ""); w.Code != 200 {
		t.Fatal(w.Code)
	}
	if w = request(h, "GET", "/unknown", "", "", ""); w.Code != 404 {
		t.Fatal(w.Code)
	}
	if w = request(h, "DELETE", "/api/v1/readings", "", "Bearer "+token, ""); w.Code != 405 {
		t.Fatal(w.Code)
	}
}
func TestRejectedPayloads(t *testing.T) {
	h := testHandler(t)
	for name, body := range map[string]string{
		"malformed": "{", "null": "null", "missing value": strings.Replace(payload, `"value":0,`, "", 1), "missing sequence": strings.Replace(payload, `"sequence":0,`, "", 1),
		"unknown": strings.Replace(payload, `"value":0`, `"value":0,"unexpected":1`, 1), "client receipt": strings.Replace(payload, `"value":0`, `"value":0,"received_at":"2026-09-22T00:00:00Z"`, 1),
		"multiple": payload + payload, "invalid id": strings.Replace(payload, `"node"`, `"node/invalid"`, 1), "too large": strings.Repeat(" ", 8193) + payload,
		"null value": strings.Replace(payload, `"value":0`, `"value":null`, 1), "invalid date": strings.Replace(payload, `"value":0`, `"value":0,"measured_at":"yesterday"`, 1),
	} {
		t.Run(name, func(t *testing.T) {
			w := request(h, "POST", "/api/v1/readings", body, "Bearer "+token, "application/json")
			if w.Code != 400 {
				t.Fatal(w.Code, w.Body)
			}
		})
	}
	if w := request(h, "POST", "/api/v1/readings", payload, "Bearer "+token, "text/plain"); w.Code != 415 {
		t.Fatal(w.Code)
	}
	for _, method := range []string{"GET", "POST"} {
		for _, auth := range []string{"", "Bearer wrong", "Basic " + token, token} {
			if w := request(h, method, "/api/v1/readings", payload, auth, "application/json"); w.Code != 401 {
				t.Fatal(w.Code)
			}
		}
	}
	if _, err := New(nil, "short", nil); err == nil {
		t.Fatal("short token accepted")
	}
}

type brokenRepo struct{}

func (brokenRepo) Insert(context.Context, telemetry.Reading, time.Time) (bool, error) {
	return false, errors.New("private database failure")
}
func (brokenRepo) Recent(context.Context, int) ([]telemetry.Reading, error) {
	return nil, errors.New("private database failure")
}
func (brokenRepo) Ping(context.Context) error { return errors.New("private database failure") }
func TestStorageFailure(t *testing.T) {
	h, err := New(brokenRepo{}, token, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{"/", "/api/v1/readings", "/healthz"} {
		w := request(h, "GET", path, "", "Bearer "+token, "")
		want := 500
		if path == "/healthz" {
			want = 503
		}
		if w.Code != want || strings.Contains(w.Body.String(), "private") {
			t.Fatal(w.Code, w.Body)
		}
	}
	if w := request(h, "POST", "/api/v1/readings", payload, "Bearer "+token, "application/json"); w.Code != 500 {
		t.Fatal(w.Code)
	}
}
