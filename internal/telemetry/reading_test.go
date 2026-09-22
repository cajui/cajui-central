package telemetry

import (
	"math"
	"strings"
	"testing"
	"time"
)

func TestValidation(t *testing.T) {
	valid := Reading{NodeID: "node-1", SensorID: "ambient", SessionID: "boot:1", Metric: "temperature", Value: 0, Unit: "degC"}
	if err := valid.Validate(); err != nil {
		t.Fatal(err)
	}
	cases := map[string]func(*Reading){
		"empty node": func(r *Reading) { r.NodeID = "" }, "invalid sensor": func(r *Reading) { r.SensorID = "sensor/1" },
		"long session": func(r *Reading) { r.SessionID = strings.Repeat("x", 65) }, "empty metric": func(r *Reading) { r.Metric = "" },
		"negative sequence": func(r *Reading) { r.Sequence = -1 }, "nan": func(r *Reading) { r.Value = math.NaN() }, "infinity": func(r *Reading) { r.Value = math.Inf(1) },
		"empty unit": func(r *Reading) { r.Unit = "" }, "long unit": func(r *Reading) { r.Unit = strings.Repeat("x", 33) },
		"zero timestamp": func(r *Reading) { r.MeasuredAt = &time.Time{} },
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			r := valid
			mutate(&r)
			if r.Validate() == nil {
				t.Fatal("invalid measurement accepted")
			}
		})
	}
	now := time.Now()
	valid.MeasuredAt = &now
	if err := valid.Validate(); err != nil {
		t.Fatal(err)
	}
}
