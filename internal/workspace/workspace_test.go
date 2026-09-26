package workspace

import (
	"strings"
	"testing"
)

func TestSettings(t *testing.T) {
	for _, s := range []Settings{{Name: "Weather station"}, {Name: "温度", Location: "North"}, {Name: strings.Repeat("a", 80), Revision: 2}} {
		if s.Validate() != nil {
			t.Fatalf("valid settings rejected: %#v", s)
		}
	}
	for _, s := range []Settings{{}, {Name: " "}, {Name: " name"}, {Name: "name "}, {Name: "a\nb"}, {Name: "\xff"}, {Name: strings.Repeat("a", 81)}, {Name: "ok", Location: " x "}, {Name: "ok", Revision: -1}} {
		if s.Validate() == nil {
			t.Fatalf("invalid settings accepted: %#v", s)
		}
	}
}
func TestLayout(t *testing.T) {
	valid := []Item{{Kind: "device", DeviceID: 1}, {Kind: "sensor", SensorID: 1}, {Kind: "measurement", SensorID: 1, Metric: "temperature", Unit: "degC"}}
	for _, l := range []Layout{{}, {Sections: []Section{}}, {Sections: []Section{{Title: "North", Items: valid}}}} {
		if l.Validate() != nil {
			t.Fatal("valid layout rejected")
		}
	}
	invalid := []Item{{Kind: "other"}, {Kind: "device"}, {Kind: "device", DeviceID: 1, SensorID: 2}, {Kind: "device", DeviceID: 1, Metric: "x"}, {Kind: "sensor"}, {Kind: "sensor", SensorID: 1, DeviceID: 2}, {Kind: "sensor", SensorID: 1, Unit: "x"}, {Kind: "measurement", SensorID: 1}, {Kind: "measurement", SensorID: 1, Metric: "x", Unit: strings.Repeat("x", 33)}, {Kind: "measurement", SensorID: 1, Metric: strings.Repeat("x", 65), Unit: "x"}, {Kind: "measurement", DeviceID: 2, SensorID: 1, Metric: "x", Unit: "x"}}
	for _, item := range invalid {
		if (Layout{Sections: []Section{{Title: "North", Items: []Item{item}}}}).Validate() == nil {
			t.Fatalf("accepted %#v", item)
		}
	}
	for _, l := range []Layout{{Revision: -1}, {Sections: make([]Section, 21)}, {Sections: []Section{{Title: ""}}}, {Sections: []Section{{Title: "X", Items: make([]Item, 51)}}}, {Sections: []Section{{Title: "X", Items: []Item{valid[0], valid[0]}}}}} {
		if l.Validate() == nil {
			t.Fatal("invalid layout accepted")
		}
	}
	var many Layout
	for i := 0; i < 5; i++ {
		sec := Section{Title: "X"}
		for j := 1; j <= 50; j++ {
			sec.Items = append(sec.Items, Item{Kind: "device", DeviceID: int64(j)})
		}
		many.Sections = append(many.Sections, sec)
	}
	if many.Validate() == nil {
		t.Fatal("total limit ignored")
	}
}
func TestDiagnostics(t *testing.T) {
	for _, tc := range []struct {
		s, m, u string
		want    bool
	}{{"radio", "rssi", "dBm", true}, {"radio", "snr", "dB", true}, {"ambient", "snr", "dB", false}, {"radio", "snr", "other", false}, {"radio", "other", "dBm", false}} {
		if IsDiagnostic(tc.s, tc.m, tc.u) != tc.want {
			t.Fatal(tc)
		}
	}
}
