package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/cajui/cajui-central/internal/devicestate"
)

type stateChanges interface{ DeviceStateChanges() <-chan struct{} }
type stateSnapshot struct {
	GeneratedAt time.Time            `json:"generated_at"`
	States      []devicestate.Stored `json:"device_states"`
}

func (s *server) stateSnapshot(ctx context.Context) (stateSnapshot, error) {
	snapshot := stateSnapshot{GeneratedAt: time.Now().UTC()}
	var err error
	snapshot.States, err = s.repo.DeviceStates(ctx)
	if snapshot.States == nil {
		snapshot.States = []devicestate.Stored{}
	}
	return snapshot, err
}
func (s *server) localDeviceStates(w http.ResponseWriter, r *http.Request) {
	if !s.trustedLocalRead(r) {
		http.Error(w, "reload the local page", http.StatusForbidden)
		return
	}
	snapshot, err := s.stateSnapshot(r.Context())
	if err != nil {
		s.fail(w, err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(snapshot)
}
func (s *server) deviceStateEvents(w http.ResponseWriter, r *http.Request) {
	if !s.trustedLocalRead(r) {
		http.Error(w, "reload the local page", http.StatusForbidden)
		return
	}
	changes, ok := s.repo.(stateChanges)
	if !ok {
		http.Error(w, "state events unavailable", http.StatusServiceUnavailable)
		return
	}
	select {
	case s.stateStreams <- struct{}{}:
		defer func() { <-s.stateStreams }()
	default:
		http.Error(w, "too many state streams", http.StatusServiceUnavailable)
		return
	}
	changed := changes.DeviceStateChanges()
	snapshot, err := s.stateSnapshot(r.Context())
	if err != nil {
		s.fail(w, err)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("X-Accel-Buffering", "no")
	control := http.NewResponseController(w)
	write := func(value any) error {
		// Override the ordinary HTTP write timeout, but never allow a slow tab to
		// keep a database change handler blocked on a socket indefinitely.
		if err := control.SetWriteDeadline(time.Now().Add(5 * time.Second)); err != nil {
			return err
		}
		if value == nil {
			_, err = fmt.Fprint(w, ": heartbeat\n\n")
		} else {
			var payload []byte
			payload, err = json.Marshal(value)
			if err == nil {
				_, err = fmt.Fprintf(w, "event: states\ndata: %s\n\n", payload)
			}
		}
		if err != nil {
			return err
		}
		return control.Flush()
	}
	if write(snapshot) != nil {
		return
	}
	heartbeat := time.NewTicker(15 * time.Second)
	defer heartbeat.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-heartbeat.C:
			if write(nil) != nil {
				return
			}
		case <-changed:
			changed = changes.DeviceStateChanges()
			snapshot, err = s.stateSnapshot(r.Context())
			if err != nil {
				s.logger.Warn("state stream snapshot failed")
				return
			}
			if write(snapshot) != nil {
				return
			}
		}
	}
}
