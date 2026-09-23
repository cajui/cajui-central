package telemetry

import (
	"bytes"
	"encoding/json"
	"io"
	"math"
	"sort"
	"strings"
	"time"
	"unicode/utf8"
)

const MaxSampleBytes = 16384

// Sample is an atomic, transport-independent collection of measurements.
// SampleID must remain stable across retries and change for each acquisition.
type Sample struct {
	Version                 int           `json:"version"`
	SourceID                string        `json:"source_id"`
	DeviceID                string        `json:"device_id"`
	SampleID                string        `json:"sample_id"`
	ExpectedIntervalSeconds int           `json:"expected_interval_seconds"`
	MeasuredAt              *time.Time    `json:"measured_at,omitempty"`
	Readings                []Measurement `json:"readings"`
}
type Measurement struct {
	SensorID string   `json:"sensor_id"`
	Metric   string   `json:"metric"`
	Value    *float64 `json:"value,omitempty"`
	Unit     string   `json:"unit"`
	Status   string   `json:"status"`
}
type StoredSample struct {
	Sample
	ReceivedAt time.Time `json:"received_at"`
}
type Device struct {
	SourceID                string    `json:"source_id"`
	DeviceID                string    `json:"device_id"`
	LastReceivedAt          time.Time `json:"last_received_at"`
	ExpectedIntervalSeconds int       `json:"expected_interval_seconds"`
	Stale                   bool      `json:"stale"`
	SensorError             bool      `json:"sensor_error"`
}

func (s Sample) Validate() error {
	if s.Version != 1 || s.ExpectedIntervalSeconds < 1 || s.ExpectedIntervalSeconds > 604800 || len(s.Readings) == 0 || len(s.Readings) > 64 {
		return ErrInvalid
	}
	for _, id := range []string{s.SourceID, s.DeviceID, s.SampleID} {
		if !identifier.MatchString(id) {
			return ErrInvalid
		}
	}
	if s.MeasuredAt != nil && (s.MeasuredAt.IsZero() || s.MeasuredAt.Year() < 1 || s.MeasuredAt.Year() > 9999) {
		return ErrInvalid
	}
	seen := map[string]bool{}
	for _, r := range s.Readings {
		key := r.SensorID + "/" + r.Metric
		if !identifier.MatchString(r.SensorID) || !identifier.MatchString(r.Metric) || len(r.Unit) < 1 || len(r.Unit) > 32 || seen[key] {
			return ErrInvalid
		}
		seen[key] = true
		switch r.Status {
		case "ok":
			if r.Value == nil || math.IsNaN(*r.Value) || math.IsInf(*r.Value, 0) {
				return ErrInvalid
			}
		case "error", "skipped":
			if r.Value != nil {
				return ErrInvalid
			}
		default:
			return ErrInvalid
		}
	}
	return nil
}
func DecodeSample(payload []byte) (Sample, error) {
	var s Sample
	if len(payload) > MaxSampleBytes || !utf8.Valid(payload) {
		return s, ErrInvalid
	}
	if err := checkJSON(json.NewDecoder(bytes.NewReader(payload)), 0); err != nil {
		return s, ErrInvalid
	}
	dec := json.NewDecoder(bytes.NewReader(payload))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&s); err != nil {
		return s, ErrInvalid
	}
	if dec.Decode(new(any)) != io.EOF {
		return s, ErrInvalid
	}
	return s, s.Validate()
}

// CanonicalJSON normalizes measurement order and timestamps without modifying the caller.
func (s Sample) CanonicalJSON() ([]byte, error) {
	if err := s.Validate(); err != nil {
		return nil, err
	}
	s.Readings = append([]Measurement(nil), s.Readings...)
	sort.Slice(s.Readings, func(i, j int) bool {
		a, b := s.Readings[i], s.Readings[j]
		return a.SensorID+"/"+a.Metric < b.SensorID+"/"+b.Metric
	})
	if s.MeasuredAt != nil {
		t := s.MeasuredAt.UTC()
		s.MeasuredAt = &t
	}
	return json.Marshal(s)
}

// Reject ambiguous object keys instead of letting different consumers choose
// different values. The schema needs only three container levels.
func checkJSON(dec *json.Decoder, depth int) error {
	if depth > 4 {
		return ErrInvalid
	}
	token, err := dec.Token()
	if err != nil {
		return err
	}
	delimiter, ok := token.(json.Delim)
	if !ok {
		return nil
	}
	switch delimiter {
	case '{':
		seen := map[string]bool{}
		for dec.More() {
			key, err := dec.Token()
			if err != nil {
				return err
			}
			name, ok := key.(string)
			if !ok || seen[name] || name != strings.ToLower(name) {
				return ErrInvalid
			}
			seen[name] = true
			if err = checkJSON(dec, depth+1); err != nil {
				return err
			}
		}
	case '[':
		for dec.More() {
			if err = checkJSON(dec, depth+1); err != nil {
				return err
			}
		}
	default:
		return ErrInvalid
	}
	_, err = dec.Token()
	return err
}
