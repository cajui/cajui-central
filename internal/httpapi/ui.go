package httpapi

import (
	"embed"
	"io/fs"
	"net/http"
	"path"
	"time"

	"github.com/cajui/cajui-central/internal/telemetry"
)

// Assets are plain source files: no frontend build or external runtime request.
//
//go:embed ui
var uiFiles embed.FS

type dashboardState struct {
	Readings    []telemetry.Reading      `json:"readings"`
	Samples     []telemetry.StoredSample `json:"samples"`
	Devices     []telemetry.Device       `json:"devices"`
	GeneratedAt time.Time                `json:"generated_at"`
}
type dashboardPage struct {
	Mode, Title string
	State       dashboardState
}

func (s *server) design(w http.ResponseWriter, _ *http.Request, mode string) {
	titles := map[string]string{"brand": "Visual identity", "components": "Component library", "demo": "Example dashboard", "research": "Design research"}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	if err := dashboard.Execute(w, dashboardPage{Mode: mode, Title: titles[mode]}); err != nil {
		s.logger.Error("render design reference", "error", err)
	}
}
func serveUIAsset(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("path")
	if !fs.ValidPath(name) {
		http.NotFound(w, r)
		return
	}
	data, err := uiFiles.ReadFile("ui/" + name)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	types := map[string]string{".css": "text/css; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".svg": "image/svg+xml", ".ttf": "font/ttf", ".txt": "text/plain; charset=utf-8"}
	contentType, ok := types[path.Ext(name)]
	if !ok {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", contentType)
	_, _ = w.Write(data)
}
