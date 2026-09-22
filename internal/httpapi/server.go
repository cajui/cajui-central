// Package httpapi exposes the local API and embedded monitoring page.
package httpapi

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	_ "embed"
	"encoding/json"
	"errors"
	"html/template"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/romulostorel/cajui-central/internal/telemetry"
)

type Repository interface {
	Insert(context.Context, telemetry.Reading, time.Time) (bool, error)
	Recent(context.Context, int) ([]telemetry.Reading, error)
	Ping(context.Context) error
}

//go:embed index.html
var page string
var dashboard = template.Must(template.New("index").Parse(page))

type server struct {
	repo   Repository
	token  [32]byte
	logger *slog.Logger
}

func New(repo Repository, token string, logger *slog.Logger) (http.Handler, error) {
	if len(token) < 24 {
		return nil, errors.New("API token must contain at least 24 characters")
	}
	if logger == nil {
		logger = slog.Default()
	}
	s := &server{repo: repo, token: sha256.Sum256([]byte(token)), logger: logger}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", s.health)
	mux.HandleFunc("GET /{$}", s.index)
	mux.Handle("GET /api/v1/readings", s.authorize(http.HandlerFunc(s.list)))
	mux.Handle("POST /api/v1/readings", s.authorize(http.HandlerFunc(s.ingest)))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; form-action 'none'")
		mux.ServeHTTP(w, r)
	}), nil
}
func (s *server) authorize(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		auth := r.Header.Get("Authorization")
		got := sha256.Sum256([]byte(strings.TrimPrefix(auth, "Bearer ")))
		if !strings.HasPrefix(auth, "Bearer ") || subtle.ConstantTimeCompare(got[:], s.token[:]) != 1 {
			w.Header().Set("WWW-Authenticate", "Bearer")
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, r)
	})
}
func (s *server) fail(w http.ResponseWriter, err error) {
	s.logger.Error("request failed", "error", err)
	http.Error(w, "internal server error", 500)
}
func (s *server) health(w http.ResponseWriter, r *http.Request) {
	if err := s.repo.Ping(r.Context()); err != nil {
		http.Error(w, "not ready", 503)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_, _ = io.WriteString(w, `{"status":"ok"}`)
}
func (s *server) list(w http.ResponseWriter, r *http.Request) {
	readings, err := s.repo.Recent(r.Context(), 100)
	if err != nil {
		s.fail(w, err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	if err = json.NewEncoder(w).Encode(readings); err != nil {
		s.logger.Error("encode response", "error", err)
	}
}

// The dashboard is read-only and local; API access always requires a token.
func (s *server) index(w http.ResponseWriter, r *http.Request) {
	readings, err := s.repo.Recent(r.Context(), 100)
	if err != nil {
		s.fail(w, err)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	if err = dashboard.Execute(w, readings); err != nil {
		s.logger.Error("render dashboard", "error", err)
	}
}
func (s *server) ingest(w http.ResponseWriter, r *http.Request) {
	if r.Header.Get("Content-Type") != "application/json" {
		http.Error(w, "use application/json", 415)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 8192)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	// Pointer value distinguishes a missing measurement from a legitimate zero.
	var input struct {
		NodeID     string     `json:"node_id"`
		SensorID   string     `json:"sensor_id"`
		SessionID  string     `json:"session_id"`
		Sequence   *int64     `json:"sequence"`
		Metric     string     `json:"metric"`
		Value      *float64   `json:"value"`
		Unit       string     `json:"unit"`
		MeasuredAt *time.Time `json:"measured_at,omitempty"`
	}
	if err := dec.Decode(&input); err != nil {
		http.Error(w, "invalid JSON payload", 400)
		return
	}
	var extra any
	if err := dec.Decode(&extra); err != io.EOF {
		http.Error(w, "expected one JSON object", 400)
		return
	}
	if input.Value == nil || input.Sequence == nil {
		http.Error(w, "value and sequence are required", 400)
		return
	}
	reading := telemetry.Reading{NodeID: input.NodeID, SensorID: input.SensorID, SessionID: input.SessionID, Sequence: *input.Sequence, Metric: input.Metric, Value: *input.Value, Unit: input.Unit, MeasuredAt: input.MeasuredAt}
	if err := reading.Validate(); err != nil {
		http.Error(w, "invalid reading", 400)
		return
	}
	created, err := s.repo.Insert(r.Context(), reading, time.Now())
	if errors.Is(err, telemetry.ErrConflict) {
		http.Error(w, "conflicting event identity", 409)
		return
	}
	if err != nil {
		s.fail(w, err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	if created {
		w.WriteHeader(201)
		_, _ = io.WriteString(w, `{"status":"created"}`)
	} else {
		w.WriteHeader(200)
		_, _ = io.WriteString(w, `{"status":"duplicate"}`)
	}
}
