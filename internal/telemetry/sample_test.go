package telemetry

import (
	"encoding/json"
	"math"
	"os"
	"strings"
	"testing"
	"time"
)

func fixture(t *testing.T) Sample {
	t.Helper()
	b, e := os.ReadFile("../../examples/mqtt/sample.json")
	if e != nil {
		t.Fatal(e)
	}
	s, e := DecodeSample(b)
	if e != nil {
		t.Fatal(e)
	}
	return s
}
func TestSampleValidation(t *testing.T) {
	cases := map[string]func(*Sample){
		"version": func(s *Sample) { s.Version = 2 }, "interval zero": func(s *Sample) { s.ExpectedIntervalSeconds = 0 }, "interval large": func(s *Sample) { s.ExpectedIntervalSeconds = 604801 },
		"source": func(s *Sample) { s.SourceID = "bad/+" }, "device": func(s *Sample) { s.DeviceID = "" }, "sample": func(s *Sample) { s.SampleID = "../bad" },
		"empty": func(s *Sample) { s.Readings = nil }, "too many": func(s *Sample) { s.Readings = make([]Measurement, 65) },
		"sensor": func(s *Sample) { s.Readings[0].SensorID = "" }, "metric": func(s *Sample) { s.Readings[0].Metric = "+" }, "unit": func(s *Sample) { s.Readings[0].Unit = "" },
		"duplicate": func(s *Sample) { s.Readings = append(s.Readings, s.Readings[0]) }, "missing value": func(s *Sample) { s.Readings[0].Value = nil },
		"nan": func(s *Sample) { v := math.NaN(); s.Readings[0].Value = &v }, "infinity": func(s *Sample) { v := math.Inf(1); s.Readings[0].Value = &v },
		"unknown status": func(s *Sample) { s.Readings[0].Status = "unknown" }, "error with value": func(s *Sample) { s.Readings[0].Status = "error" },
		"zero time": func(s *Sample) { v := time.Time{}; s.MeasuredAt = &v },
	}
	for name, change := range cases {
		t.Run(name, func(t *testing.T) {
			s := fixture(t)
			change(&s)
			if s.Validate() == nil {
				t.Fatal("accepted invalid sample")
			}
			if _, e := s.CanonicalJSON(); e == nil {
				t.Fatal("canonicalized invalid sample")
			}
		})
	}
	for _, status := range []string{"error", "skipped"} {
		s := fixture(t)
		s.Readings[0].Status = status
		s.Readings[0].Value = nil
		if e := s.Validate(); e != nil {
			t.Fatal(e)
		}
	}
	s := fixture(t)
	v := 0.0
	s.Readings[0].Value = &v
	if e := s.Validate(); e != nil {
		t.Fatal(e)
	}
}
func TestDecodeSample(t *testing.T) {
	s := fixture(t)
	valid, _ := json.Marshal(s)
	for _, b := range [][]byte{nil, []byte("null"), []byte("[]"), []byte(`{"unexpected":true}`), append(append([]byte{}, valid...), []byte(" {}")...), make([]byte, MaxSampleBytes+1)} {
		if _, e := DecodeSample(b); e == nil {
			t.Fatalf("accepted %q", b)
		}
	}
}
func TestCanonicalSample(t *testing.T) {
	s := fixture(t)
	instant := time.Date(2026, 1, 1, 12, 0, 0, 0, time.FixedZone("offset", 3600))
	s.MeasuredAt = &instant
	first, e := s.CanonicalJSON()
	if e != nil {
		t.Fatal(e)
	}
	if s.Readings[0].Metric != "temperature" {
		t.Fatal("mutated caller")
	}
	s.Readings[0], s.Readings[1] = s.Readings[1], s.Readings[0]
	utc := instant.UTC()
	s.MeasuredAt = &utc
	second, _ := s.CanonicalJSON()
	if string(first) != string(second) {
		t.Fatal("order or timezone affects identity")
	}
}

func TestAmbiguousJSON(t *testing.T) {
	valid, _ := json.Marshal(fixture(t))
	for _, input := range []string{
		strings.Replace(string(valid), `"version":1`, `"version":1,"version":2`, 1),
		strings.Replace(string(valid), `"version":1`, `"Version":1`, 1),
		`{"readings":[[[[[[1]]]]]]}`, `{"x":`, `{"x"`, `[`, string([]byte{0xff}),
	} {
		if _, err := DecodeSample([]byte(input)); err == nil {
			t.Fatalf("accepted ambiguous JSON: %s", input)
		}
	}
}
