package httpapi

import (
	"context"
	"encoding/json"
	"io"
	"io/fs"
	"log/slog"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/cajui/cajui-central/internal/storage"
	"github.com/cajui/cajui-central/internal/telemetry"
)

func TestProductAssetsExcludeDesignDocumentation(t *testing.T) {
	handler, err := New(brokenRepo{}, token, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{"/design/brand", "/design/components", "/design/dashboard", "/design/research", "/docs/brand/", "/ui/design.mjs", "/ui/demo.mjs"} {
		if response := request(handler, "GET", path, "", "", ""); response.Code != 404 {
			t.Fatal(path, response.Code)
		}
	}
	if err := fs.WalkDir(uiFiles, ".", func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if strings.Contains(path, "demo") || strings.Contains(path, "design") {
			t.Fatalf("reference embedded in product: %s", path)
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	for path, kind := range map[string]string{"/ui/app.mjs": "text/javascript", "/ui/ui.css": "text/css", "/ui/assets/cajui-mark.svg": "image/svg+xml", "/ui/assets/fonts/manrope-variable.ttf": "font/ttf", "/ui/assets/fonts/OFL-Manrope.txt": "text/plain"} {
		response := request(handler, "GET", path, "", "", "")
		if response.Code != 200 || !strings.HasPrefix(response.Header().Get("Content-Type"), kind) || response.Body.Len() == 0 {
			t.Fatal(path, response.Code, response.Header())
		}
	}
	for _, path := range []string{"/ui/", "/ui/missing.mjs", "/ui/assets", "/design/missing"} {
		if response := request(handler, "GET", path, "", "", ""); response.Code != 404 {
			t.Fatal(path, response.Code)
		}
	}
	req := httptest.NewRequest("GET", "/ui/anything", nil)
	req.SetPathValue("path", "../server.go")
	response := httptest.NewRecorder()
	serveUIAsset(response, req)
	if response.Code != 404 {
		t.Fatal("traversal accepted")
	}
}
func TestSnapshotEscapesUntrustedTelemetryAndContainsNoToken(t *testing.T) {
	db, err := storage.Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	reading := telemetry.Reading{NodeID: "node", SensorID: "sensor", SessionID: "boot", Metric: "temperature", Value: 0, Unit: `<img src=x onerror=alert(1)>`}
	if _, err = db.Insert(context.Background(), reading, time.Now()); err != nil {
		t.Fatal(err)
	}
	handler, err := New(db, token, nil)
	if err != nil {
		t.Fatal(err)
	}
	response := request(handler, "GET", "/", "", "", "")
	body := response.Body.String()
	if response.Code != 200 || strings.Contains(body, token) || strings.Contains(body, reading.Unit) {
		t.Fatal("unsafe dashboard response")
	}
	if strings.Contains(body, "/design/") || strings.Contains(body, "Design system") {
		t.Fatal("reference navigation in product")
	}
	csp := response.Header().Get("Content-Security-Policy")
	for _, want := range []string{"script-src 'self'", "connect-src 'self'", "base-uri 'none'", "frame-ancestors 'none'"} {
		if !strings.Contains(csp, want) {
			t.Fatal(csp)
		}
	}
	if strings.Contains(csp, "unsafe-inline") || strings.Contains(csp, "unsafe-eval") {
		t.Fatal("unsafe script policy")
	}
	found := regexp.MustCompile(`(?s)<script type="application/json" id="initial-state">(.*?)</script>`).FindStringSubmatch(body)
	if len(found) != 2 {
		t.Fatal("missing snapshot")
	}
	var state dashboardState
	if err = json.Unmarshal([]byte(found[1]), &state); err != nil {
		t.Fatal(err)
	}
	if len(state.Readings) != 1 || state.Readings[0].Value != 0 || state.Readings[0].Unit != reading.Unit || state.GeneratedAt.IsZero() {
		t.Fatal("snapshot did not preserve reading")
	}
}
