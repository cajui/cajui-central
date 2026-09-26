package httpapi

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/cajui/cajui-central/internal/storage"
	"github.com/cajui/cajui-central/internal/telemetry"
)

func workspaceSnapshot(t *testing.T, h http.Handler, path string) dashboardState {
	t.Helper()
	w := request(h, "GET", path, "", "", "")
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body)
	}
	found := regexp.MustCompile(`(?s)<script type="application/json" id="initial-state">(.*?)</script>`).FindStringSubmatch(w.Body.String())
	if len(found) != 2 {
		t.Fatal("snapshot absent")
	}
	var state dashboardState
	if err := json.Unmarshal([]byte(found[1]), &state); err != nil {
		t.Fatal(err)
	}
	return state
}
func workspaceEdit(h http.Handler, path, body, capability string, alter func(*http.Request)) *httptest.ResponseRecorder {
	r := httptest.NewRequest("PUT", "http://localhost"+path, strings.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Origin", "http://localhost")
	r.Header.Set("Sec-Fetch-Site", "same-origin")
	r.Header.Set("X-Cajui-Workspace", capability)
	if alter != nil {
		alter(r)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}
func TestWorkspaceSecurityAndEditing(t *testing.T) {
	h := testHandler(t)
	if w := request(h, "POST", "/api/v1/readings", payload, "Bearer "+token, "application/json"); w.Code != 201 {
		t.Fatal(w.Code)
	}
	state := workspaceSnapshot(t, h, "/devices")
	if state.UIToken == "" || state.UIToken == token {
		t.Fatal("invalid UI capability")
	}
	d, sen := state.Workspace.Devices[0].ID, state.Workspace.Sensors[0].ID
	path := fmt.Sprintf("/ui-api/devices/%d", d)
	body := `{"name":"North","location":"Field","revision":0}`
	for name, alter := range map[string]func(*http.Request){
		"no capability":              func(r *http.Request) { r.Header.Del("X-Cajui-Workspace") },
		"wrong capability":           func(r *http.Request) { r.Header.Set("X-Cajui-Workspace", token) },
		"no origin":                  func(r *http.Request) { r.Header.Del("Origin") },
		"foreign origin":             func(r *http.Request) { r.Header.Set("Origin", "https://attacker.example") },
		"null origin":                func(r *http.Request) { r.Header.Set("Origin", "null") },
		"same site different origin": func(r *http.Request) { r.Header.Set("Origin", "http://localhost:9000") },
		"rebound host":               func(r *http.Request) { r.Host = "attacker.example"; r.Header.Set("Origin", "http://attacker.example") },
		"foreign fetch site":         func(r *http.Request) { r.Header.Set("Sec-Fetch-Site", "cross-site") },
	} {
		t.Run(name, func(t *testing.T) {
			w := workspaceEdit(h, path, body, state.UIToken, alter)
			if w.Code != 403 {
				t.Fatal(w.Code, w.Body)
			}
		})
	}
	if workspaceSnapshot(t, h, "/").Workspace.Devices[0].Name != "" {
		t.Fatal("rejected edit mutated state")
	}
	if w := workspaceEdit(h, path, body, state.UIToken, nil); w.Code != 204 {
		t.Fatal(w.Code, w.Body)
	}
	if w := workspaceEdit(h, path, body, state.UIToken, nil); w.Code != 409 {
		t.Fatal(w.Code, w.Body)
	}
	if w := workspaceEdit(h, fmt.Sprintf("/ui-api/sensors/%d", sen), `{"name":"Ambient <img>","location":"","revision":0}`, state.UIToken, nil); w.Code != 204 {
		t.Fatal(w.Code, w.Body)
	}
	layout := fmt.Sprintf(`{"revision":0,"sections":[{"title":"North","items":[{"kind":"sensor","sensor_id":%d}]}]}`, sen)
	if w := workspaceEdit(h, "/ui-api/dashboard/layout", layout, state.UIToken, nil); w.Code != 204 {
		t.Fatal(w.Code, w.Body)
	}
	for _, p := range []string{"/", "/devices", "/sensors"} {
		st := workspaceSnapshot(t, h, p)
		if st.Workspace.Devices[0].Name != "North" || st.Workspace.Sensors[0].Name != "Ambient <img>" || st.Workspace.Layout.Revision != 1 {
			t.Fatal(st)
		}
	}
	if w := request(h, "GET", "/sensors", "", "", ""); strings.Contains(w.Body.String(), "Ambient <img>") || strings.Contains(w.Body.String(), token) {
		t.Fatal("unescaped name or API credential exposed")
	}
	// UI capability is deliberately not an API credential.
	if w := request(h, "GET", "/api/v1/readings", "", "Bearer "+state.UIToken, ""); w.Code != 401 {
		t.Fatal(w.Code)
	}
}
func TestWorkspaceRejectsInvalidEdits(t *testing.T) {
	h := testHandler(t)
	capability := workspaceSnapshot(t, h, "/").UIToken
	for _, tc := range []struct {
		path, body string
		code       int
	}{
		{"devices/1", `null`, 400}, {"devices/1", `[]`, 400}, {"devices/1", `{`, 400},
		{"devices/1", `{"name":"X","revision":0,"unknown":true}`, 400}, {"devices/1", `{"name":"X"}`, 400}, {"devices/1", `{"name":"X","revision":null}`, 400},
		{"devices/1", `{"name":"X","revision":0} {}`, 400}, {"devices/1", strings.Repeat(" ", 65537) + `{}`, 400},
		{"devices/999", `{"name":"X","revision":0}`, 404}, {"sensors/999", `{"name":"X","revision":0}`, 404},
		{"devices/nope", `{}`, 400}, {"devices/0", `{}`, 400}, {"unknown/1", `{}`, 404},
		{"dashboard/layout", `null`, 400}, {"dashboard/layout", `{"revision":0}`, 400}, {"dashboard/layout", `{"revision":0,"sections":[{"title":"X","items":[{"kind":"device","device_id":999}]}]}`, 404},
		{"dashboard/layout", `{"revision":0,"sections":[{"title":"X","unknown":true}]}`, 400},
	} {
		t.Run(tc.path+tc.body[:min(len(tc.body), 35)], func(t *testing.T) {
			w := workspaceEdit(h, "/ui-api/"+tc.path, tc.body, capability, nil)
			if w.Code != tc.code {
				t.Fatal(w.Code, w.Body)
			}
		})
	}
	if w := workspaceEdit(h, "/ui-api/devices/1", `{}`, capability, func(r *http.Request) { r.Header.Set("Content-Type", "text/plain") }); w.Code != 415 {
		t.Fatal(w.Code)
	}
	for _, p := range []string{"/", "/devices", "/sensors"} {
		r := httptest.NewRequest("GET", "http://evil.example"+p, nil)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != 403 || strings.Contains(w.Body.String(), capability) {
			t.Fatal(w.Code)
		}
	}
}
func TestWorkspaceUnregisteredSensorAndStorageFailure(t *testing.T) {
	db, err := storage.Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	r := telemetry.Reading{NodeID: "node", SensorID: "sensor", SessionID: "boot", Metric: "temperature", Unit: "degC"}
	if _, err = db.Insert(context.Background(), r, time.Now()); err != nil {
		t.Fatal(err)
	}
	h, err := New(db, token, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatal(err)
	}
	state := workspaceSnapshot(t, h, "/")
	if w := workspaceEdit(h, fmt.Sprintf("/ui-api/sensors/%d", state.Workspace.Sensors[0].ID), `{"name":"X","revision":0}`, state.UIToken, nil); w.Code != 409 {
		t.Fatal(w.Code, w.Body)
	}
	db.Close()
	for _, path := range []string{"devices/1", "sensors/1", "dashboard/layout"} {
		body := `{"name":"X","revision":0}`
		if path == "dashboard/layout" {
			body = `{"revision":0,"sections":[]}`
		}
		w := workspaceEdit(h, "/ui-api/"+path, body, state.UIToken, nil)
		if w.Code != 500 || strings.Contains(w.Body.String(), "database") {
			t.Fatal(w.Code, w.Body)
		}
	}
}
func TestLocalHostAndTLSOrigin(t *testing.T) {
	for _, host := range []string{"localhost", "localhost:8080", "127.0.0.1:8080", "[::1]:8080", "[::1]"} {
		if !localHost(host) {
			t.Fatal(host)
		}
	}
	for _, host := range []string{"evil.example", "localhost.evil.example", "127.0.0.1.evil.example", "192.168.1.2", "bad:port", "localhost/path", "user@localhost", "localhost#fragment"} {
		if localHost(host) {
			t.Fatal(host)
		}
	}
	h := testHandler(t)
	state := workspaceSnapshot(t, h, "/")
	w := workspaceEdit(h, "/ui-api/dashboard/layout", `{"revision":0,"sections":[]}`, state.UIToken, func(r *http.Request) { r.TLS = &tls.ConnectionState{}; r.Header.Set("Origin", "https://localhost") })
	if w.Code != 204 {
		t.Fatal(w.Code, w.Body)
	}
}
