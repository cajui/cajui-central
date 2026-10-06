package mqttingest

import (
	"encoding/json"
	"errors"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/cajui/cajui-central/internal/devicestate"
	"github.com/cajui/cajui-central/internal/telemetry"
)

const MessageLimit = 100

type ObservedMessage struct {
	ID       uint64    `json:"id"`
	At       time.Time `json:"at"`
	Topic    string    `json:"topic"`
	Source   string    `json:"source"`
	Device   string    `json:"device"`
	Kind     string    `json:"kind"`
	Retained bool      `json:"retained"`
	Status   string    `json:"status"`
	Bytes    int       `json:"bytes"`
	// Only decoded, known fields. Rejected or oversized payloads are never exposed.
	Payload json.RawMessage `json:"payload,omitempty"`
}

type Diagnostics struct {
	Configured bool              `json:"configured"`
	Connected  bool              `json:"connected"`
	Host       string            `json:"host"`
	Port       int               `json:"port"`
	TLS        bool              `json:"tls"`
	Username   string            `json:"username"`
	ClientID   string            `json:"client_id"`
	Topics     []string          `json:"topics"`
	Total      uint64            `json:"total"`
	Rejected   uint64            `json:"rejected"`
	Problem    string            `json:"problem"`
	Messages   []ObservedMessage `json:"messages"`
	Limit      int               `json:"limit"`
}

// Diagnostics is bounded, process-local and independent of durable sample delivery.
func (c *Consumer) Diagnostics() Diagnostics {
	d := Diagnostics{Configured: c.config.URL != "", Connected: c.Connected(), Username: c.config.Username, ClientID: c.config.ClientID, Limit: MessageLimit, Messages: []ObservedMessage{}, Topics: []string{}}
	if u, err := url.Parse(c.config.URL); err == nil {
		d.Host = u.Hostname()
		d.Port, _ = strconv.Atoi(u.Port())
		d.TLS = u.Scheme == "ssl"
	}
	for topic := range Topics {
		d.Topics = append(d.Topics, topic)
	}
	sort.Strings(d.Topics)
	c.observationMu.Lock()
	defer c.observationMu.Unlock()
	d.Total = c.observed
	d.Rejected = c.rejected
	d.Problem = c.problem
	for i := len(c.messages) - 1; i >= 0; i-- {
		m := c.messages[i]
		m.Payload = append(json.RawMessage(nil), m.Payload...)
		d.Messages = append(d.Messages, m)
	}
	return d
}
func (c *Consumer) connectionProblem(code string) {
	c.observationMu.Lock()
	defer c.observationMu.Unlock()
	c.problem = code
}
func (c *Consumer) observe(topic string, payload []byte, retained, accepted bool, err error) {
	status := "accepted"
	switch {
	case errors.Is(err, telemetry.ErrInvalid), errors.Is(err, telemetry.ErrConflict):
		status = "rejected"
	case err != nil:
		status = "retry"
	case !accepted:
		status = "ignored"
	}
	var normalized any
	source, device, kind, managed := devicestate.ParseTopic(topic)
	if err == nil && accepted {
		switch {
		case managed && len(payload) == 0:
			kind = "deleted"
		case managed && kind == "state":
			normalized, _ = devicestate.Decode(source, device, payload)
		case managed && kind == "availability":
			normalized, _ = devicestate.DecodeAvailability(payload)
		case managed && kind == "results":
			normalized, _ = devicestate.DecodeResult(payload)
		default:
			sample, e := telemetry.DecodeSample(payload)
			if e == nil {
				normalized = sample
				source = sample.SourceID
				device = sample.DeviceID
				kind = "samples"
			}
		}
	}
	m := ObservedMessage{At: time.Now().UTC(), Topic: topic, Source: source, Device: device, Kind: kind, Retained: retained, Status: status, Bytes: len(payload)}
	// An untrusted topic cannot grow the diagnostic ring without bounds.
	if len(m.Topic) > 256 {
		m.Topic = m.Topic[:256]
	}
	if normalized != nil {
		m.Payload, _ = json.Marshal(normalized)
	}
	if len(m.Payload) > telemetry.MaxSampleBytes {
		m.Payload = nil
	}
	c.observationMu.Lock()
	defer c.observationMu.Unlock()
	c.observed++
	m.ID = c.observed
	if status == "rejected" || status == "retry" {
		c.rejected++
	}
	if len(c.messages) == MessageLimit {
		copy(c.messages, c.messages[1:])
		c.messages = c.messages[:MessageLimit-1]
	}
	c.messages = append(c.messages, m)
}

// ReceiverEndpoint hides container-only addresses from setup instructions.
func (d Diagnostics) ReceiverEndpoint() string {
	if d.Host == "broker" || d.Host == "localhost" || d.Host == "127.0.0.1" || d.Host == "::1" {
		return ""
	}
	return strings.TrimSpace(d.Host)
}
