// Package workspace describes local inventory and dashboard preferences.
// Display names never replace identities received through telemetry.
package workspace

import (
	"errors"
	"math"
	"strings"
	"unicode"
	"unicode/utf8"
)

var (
	ErrInvalid      = errors.New("invalid workspace settings")
	ErrNotFound     = errors.New("observed item not found")
	ErrConflict     = errors.New("settings changed; reload before saving")
	ErrUnregistered = errors.New("register the device or sensor first")
)

type Settings struct {
	Name     string `json:"name"`
	Location string `json:"location"`
	Revision int64  `json:"revision"`
}

func validText(s string, required bool) bool {
	if !utf8.ValidString(s) || utf8.RuneCountInString(s) > 80 || s != strings.TrimSpace(s) || (required && s == "") {
		return false
	}
	return !strings.ContainsFunc(s, unicode.IsControl)
}

// ValidateSensor allows an empty name: a sensor then shows a name built from what it
// measures, in the viewer's language, instead of a stored one.
func (s Settings) ValidateSensor() error {
	if !validText(s.Name, false) || !validText(s.Location, false) || s.Revision < 0 {
		return ErrInvalid
	}
	return nil
}
func (s Settings) Validate() error {
	if !validText(s.Name, true) || !validText(s.Location, false) || s.Revision < 0 {
		return ErrInvalid
	}
	return nil
}

// SoilMoisture is a capacitive probe on an analog input (ADR 0004).
const SoilMoisture = "soil_moisture"

// TypeReads names the raw measurement a sensor type interprets.
func TypeReads(sensorType string) (metric, unit string, ok bool) {
	if sensorType == SoilMoisture {
		return "voltage", "V", true
	}
	return "", "", false
}

// Calibration holds the raw readings a typed sensor shows as 0 % and as 100 %. Either
// may be missing while the sensor is being calibrated.
type Calibration struct {
	Zero *float64 `json:"zero"`
	Full *float64 `json:"full"`
}

// SensorSettings adds what is connected to the sensor's input. An empty type shows the
// reading as telemetry describes it and has no calibration.
type SensorSettings struct {
	Settings
	Type        string      `json:"type"`
	Calibration Calibration `json:"calibration"`
}

func (s SensorSettings) Validate() error {
	if err := s.ValidateSensor(); err != nil {
		return err
	}
	zero, full := s.Calibration.Zero, s.Calibration.Full
	if s.Type == "" {
		if zero != nil || full != nil {
			return ErrInvalid
		}
		return nil
	}
	if _, _, ok := TypeReads(s.Type); !ok {
		return ErrInvalid
	}
	for _, point := range []*float64{zero, full} {
		if point != nil && (math.IsNaN(*point) || math.IsInf(*point, 0)) {
			return ErrInvalid
		}
	}
	// Equal points would leave no scale between them.
	if zero != nil && full != nil && *zero == *full {
		return ErrInvalid
	}
	return nil
}

type Device struct {
	ID        int64  `json:"id"`
	Transport string `json:"transport"`
	Source    string `json:"source"`
	Device    string `json:"device"`
	Settings
	ReceivedAt string `json:"received_at"`
	Interval   int    `json:"interval"`
}
type Measurement struct {
	Metric     string   `json:"metric"`
	Unit       string   `json:"unit"`
	Value      *float64 `json:"value"`
	Status     string   `json:"status"`
	ReceivedAt string   `json:"received_at"`
	Interval   int      `json:"interval"`
}
type Sensor struct {
	ID       int64  `json:"id"`
	DeviceID int64  `json:"device_id"`
	Sensor   string `json:"sensor"`
	SensorSettings
	Measurements []Measurement `json:"measurements"`
}
type Catalog struct {
	Devices []Device `json:"devices"`
	Sensors []Sensor `json:"sensors"`
	Layout  Layout   `json:"layout"`
}
type Item struct {
	Kind     string `json:"kind"`
	DeviceID int64  `json:"device_id,omitempty"`
	SensorID int64  `json:"sensor_id,omitempty"`
	Metric   string `json:"metric,omitempty"`
	Unit     string `json:"unit,omitempty"`
}
type Section struct {
	Title string `json:"title"`
	Items []Item `json:"items"`
}
type Layout struct {
	Revision int64 `json:"revision"`
	// nil means automatic; an empty array is an explicitly empty dashboard.
	Sections []Section `json:"sections"`
}

func (l Layout) Validate() error {
	if l.Revision < 0 || len(l.Sections) > 20 {
		return ErrInvalid
	}
	total := 0
	for _, section := range l.Sections {
		if !validText(section.Title, true) || len(section.Items) > 50 {
			return ErrInvalid
		}
		seen := map[Item]bool{}
		for _, item := range section.Items {
			total++
			if total > 200 || seen[item] {
				return ErrInvalid
			}
			seen[item] = true
			switch item.Kind {
			case "device":
				if item.DeviceID <= 0 || item.SensorID != 0 || item.Metric != "" || item.Unit != "" {
					return ErrInvalid
				}
			case "sensor":
				if item.SensorID <= 0 || item.DeviceID != 0 || item.Metric != "" || item.Unit != "" {
					return ErrInvalid
				}
			case "measurement":
				if item.SensorID <= 0 || item.DeviceID != 0 || item.Metric == "" || len(item.Metric) > 64 || item.Unit == "" || len(item.Unit) > 32 {
					return ErrInvalid
				}
			default:
				return ErrInvalid
			}
		}
	}
	return nil
}

// IsDiagnostic matches only the established device-diagnostic conventions of cajui-firmware:
// the receiver's measurement of the radio link and the node's own battery voltage.
func IsDiagnostic(sensor, metric, unit string) bool {
	return sensor == "radio" && (metric == "rssi" && unit == "dBm" || metric == "snr" && unit == "dB") ||
		sensor == "battery" && metric == "voltage" && unit == "V"
}
