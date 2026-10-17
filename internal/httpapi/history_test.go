package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/cajui/cajui-central/internal/history"
	"github.com/cajui/cajui-central/internal/storage"
	"github.com/cajui/cajui-central/internal/telemetry"
)

func TestHistoryAccessAndValidation(t *testing.T) {
	db, err := storage.Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	at := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	_, err = db.Insert(context.Background(), telemetry.Reading{NodeID: "n", SensorID: "s", SessionID: "boot", Metric: "temperature", Unit: "degC", Value: 0}, at)
	if err != nil {
		t.Fatal(err)
	}
	h, err := New(db, token, nil)
	if err != nil {
		t.Fatal(err)
	}
	w := request(h, "GET", "/", "", "", "")
	body := w.Body.String()
	start := strings.Index(body, `"ui_token":"`) + len(`"ui_token":"`)
	capability := strings.Split(body[start:], `"`)[0]
	path := "/ui-api/history?sensor=1&metric=temperature&unit=degC&from=2026-01-01T00:00:00Z&to=2026-01-02T00:00:00Z"
	for _, tc := range []struct {
		host, cap, path string
		status          int
	}{
		{"localhost", capability, path, 200}, {"localhost", "", path, 403}, {"evil.example", capability, path, 403},
		{"localhost", capability, path + "&sensor=2", 400}, {"localhost", capability, path + "&extra=x", 400},
		{"localhost", capability, strings.Replace(path, "sensor=1", "sensor=no", 1), 400},
		{"localhost", capability, strings.Replace(path, "2026-01-02", "2028-01-02", 1), 400},
		{"localhost", capability, path + "&before=1:2", 400}, {"localhost", capability, path + "&anchor=3&before=no", 400},
		{"localhost", capability, path + "&view=bad", 400}, {"localhost", capability, path + "&view=rows", 200},
	} {
		r := httptest.NewRequest("GET", "http://"+tc.host+tc.path, nil)
		r.Header.Set("X-Cajui-Workspace", tc.cap)
		w = httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != tc.status {
			t.Fatal(tc, w.Code, w.Body)
		}
	}
	r := httptest.NewRequest("GET", "http://localhost"+path, nil)
	r.Header.Set("X-Cajui-Workspace", capability)
	w = httptest.NewRecorder()
	h.ServeHTTP(w, r)
	var result history.Result
	if err = json.Unmarshal(w.Body.Bytes(), &result); err != nil || (result.Count == nil || *result.Count != 1) || result.Points[0].Value == nil || *result.Points[0].Value != 0 {
		t.Fatal(result, err)
	}
}

func TestHistoryStorageFailureAndBusy(t *testing.T) {
	s := &server{repo: brokenRepo{}, uiToken: "test", historyRequests: make(chan struct{}, 1), logger: slog.New(slog.NewTextHandler(io.Discard, nil))}
	q := url.Values{"sensor": {"1"}, "metric": {"t"}, "unit": {"C"}, "from": {"2026-01-01T00:00:00Z"}, "to": {"2026-01-02T00:00:00Z"}}
	r := httptest.NewRequest("GET", "http://localhost/ui-api/history?"+q.Encode(), nil)
	r.Header.Set("X-Cajui-Workspace", "test")
	s.historyRequests <- struct{}{}
	w := httptest.NewRecorder()
	s.measurementHistory(w, r)
	if w.Code != http.StatusServiceUnavailable {
		t.Fatal(w.Code)
	}
	<-s.historyRequests
	w = httptest.NewRecorder()
	s.measurementHistory(w, r)
	if w.Code != 500 {
		t.Fatal(w.Code)
	}
}

type canceledHistoryRepo struct{ brokenRepo }

func (canceledHistoryRepo) History(context.Context, history.Query, bool) (history.Result, error) {
	return history.Result{}, context.Canceled
}
func TestHistoryCancellationDoesNotLogServerFailure(t *testing.T) {
	var logs bytes.Buffer
	s := &server{repo: canceledHistoryRepo{}, uiToken: "test", historyRequests: make(chan struct{}, 2), logger: slog.New(slog.NewTextHandler(&logs, nil))}
	r := httptest.NewRequest("GET", "http://localhost/ui-api/history?sensor=1&metric=t&unit=C&from=2026-01-01T00:00:00Z&to=2026-01-02T00:00:00Z", nil)
	r.Header.Set("X-Cajui-Workspace", "test")
	w := httptest.NewRecorder()
	s.measurementHistory(w, r)
	if w.Code >= 500 || w.Body.Len() != 0 || logs.Len() != 0 {
		t.Fatal(w.Code, w.Body, logs.String())
	}
}
