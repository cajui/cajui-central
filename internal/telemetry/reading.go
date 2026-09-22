// Package telemetry defines the transport-independent measurement contract.
package telemetry

import (
	"errors"
	"math"
	"regexp"
	"time"
)

var ErrInvalid = errors.New("invalid reading")
var ErrConflict = errors.New("event identity already exists with different content")
var identifier = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,63}$`)

// Reading identifies one measurement. A node can expose multiple sensors.
// Session must change on each node reboot; sequence counts samples in that session.
type Reading struct {
	NodeID     string     `json:"node_id"`
	SensorID   string     `json:"sensor_id"`
	SessionID  string     `json:"session_id"`
	Sequence   int64      `json:"sequence"`
	Metric     string     `json:"metric"`
	Value      float64    `json:"value"`
	Unit       string     `json:"unit"`
	MeasuredAt *time.Time `json:"measured_at,omitempty"`
	ReceivedAt time.Time  `json:"received_at"`
}

func (r Reading) Validate() error {
	for _, id := range []string{r.NodeID, r.SensorID, r.SessionID, r.Metric} {
		if !identifier.MatchString(id) {
			return ErrInvalid
		}
	}
	if r.Sequence < 0 || len(r.Unit) == 0 || len(r.Unit) > 32 || math.IsNaN(r.Value) || math.IsInf(r.Value, 0) {
		return ErrInvalid
	}
	if r.MeasuredAt != nil && (r.MeasuredAt.IsZero() || r.MeasuredAt.Year() < 1 || r.MeasuredAt.Year() > 9999) {
		return ErrInvalid
	}
	return nil
}
