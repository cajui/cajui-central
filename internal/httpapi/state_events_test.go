package httpapi

import (
	"bufio"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/cajui/cajui-central/internal/devicestate"
	"github.com/cajui/cajui-central/internal/storage"
)

func TestStateEventsDeliverCommitsAndReleaseDisconnectedClient(t *testing.T) {
	db, err := storage.Open(filepath.Join(t.TempDir(), "db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	at := time.Now().UTC()
	state := devicestate.State{SourceID: "source", DeviceID: "0000000000000001", Role: "receiver"}
	if err = db.SaveDeviceState(context.Background(), state, at, false); err != nil {
		t.Fatal(err)
	}
	var instance *server
	h, err := New(db, token, nil, func(s *server) { instance = s })
	if err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(h)
	defer srv.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, "GET", srv.URL+"/ui-api/device-states/events", nil)
	req.Header.Set("X-Cajui-Workspace", instance.uiToken)
	response, err := srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != 200 || response.Header.Get("Content-Type") != "text/event-stream" {
		t.Fatal(response.Status, response.Header)
	}
	scan := bufio.NewScanner(response.Body)
	next := func() stateSnapshot {
		t.Helper()
		for scan.Scan() {
			if value, ok := strings.CutPrefix(scan.Text(), "data: "); ok {
				var snapshot stateSnapshot
				if err := json.Unmarshal([]byte(value), &snapshot); err != nil {
					t.Fatal(err)
				}
				return snapshot
			}
		}
		t.Fatal("missing state event", scan.Err())
		return stateSnapshot{}
	}
	if first := next(); len(first.States) != 1 || first.GeneratedAt.IsZero() {
		t.Fatal(first)
	}
	for _, value := range []string{"online", "offline", "online"} {
		if err := db.SaveAvailability(ctx, state.SourceID, state.DeviceID, value, time.Now(), false); err != nil {
			t.Fatal(err)
		}
		got := next()
		if len(got.States) != 1 || got.States[0].Availability == nil || *got.States[0].Availability != value {
			t.Fatal(got)
		}
	}
	if err := db.ArchiveReceiver(ctx, state.SourceID, state.DeviceID, at); err != nil {
		t.Fatal(err)
	}
	if got := next(); len(got.States) != 0 {
		t.Fatal(got)
	}
	response.Body.Close()
	deadline := time.Now().Add(time.Second)
	for len(instance.stateStreams) > 0 && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	if len(instance.stateStreams) != 0 {
		t.Fatal("disconnected stream not released")
	}
}

func TestStateEndpointsRequireLocalCapabilityAndBoundConnections(t *testing.T) {
	db, err := storage.Open(filepath.Join(t.TempDir(), "db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	var instance *server
	h, err := New(db, token, nil, func(s *server) { instance = s })
	if err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{"/ui-api/device-states", "/ui-api/device-states/events"} {
		for _, host := range []string{"localhost", "evil.example"} {
			req := httptest.NewRequest("GET", path, nil)
			req.Host = host
			if host != "localhost" {
				req.Header.Set("X-Cajui-Workspace", instance.uiToken)
			}
			out := httptest.NewRecorder()
			h.ServeHTTP(out, req)
			if out.Code != 403 {
				t.Fatal(path, host, out.Code)
			}
		}
	}
	req := httptest.NewRequest("GET", "/ui-api/device-states", nil)
	req.Host = "localhost"
	req.Header.Set("X-Cajui-Workspace", instance.uiToken)
	out := httptest.NewRecorder()
	h.ServeHTTP(out, req)
	if out.Code != 200 || !strings.Contains(out.Body.String(), `"device_states":[]`) {
		t.Fatal(out.Code, out.Body)
	}
	for i := 0; i < cap(instance.stateStreams); i++ {
		instance.stateStreams <- struct{}{}
	}
	req = httptest.NewRequest("GET", "/ui-api/device-states/events", nil)
	req.Host = "localhost"
	req.Header.Set("X-Cajui-Workspace", instance.uiToken)
	out = httptest.NewRecorder()
	h.ServeHTTP(out, req)
	if out.Code != 503 {
		t.Fatal(out.Code)
	}
}
