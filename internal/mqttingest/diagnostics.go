package mqttingest

import (
	"encoding/json"
	"errors"
	"net/url"
	"sort"
	"strconv"
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
	d := Diagnostics{Configured: c.Configured(), Connected: c.Connected(), Username: c.config.Username, ClientID: c.config.ClientID, Limit: MessageLimit, Messages: []ObservedMessage{}, Topics: []string{}}
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
	d.Total, d.Rejected, d.Problem = c.observed, c.rejected, c.problem
	for offset := 0; offset < c.messageCount; offset++ {
		index := (c.messageHead - 1 - offset + MessageLimit) % MessageLimit
		d.Messages = append(d.Messages, c.messages[index])
	}
	c.observationMu.Unlock()
	// Stored payloads are immutable; copy for callers outside the ingestion lock.
	for i := range d.Messages {
		d.Messages[i].Payload = append(json.RawMessage(nil), d.Messages[i].Payload...)
	}

	return d
}
func (c *Consumer) connectionProblem(code string) {
	c.observationMu.Lock()
	defer c.observationMu.Unlock()
	c.problem = code
}
func (c *Consumer) observe(topic string, payload []byte, retained, accepted bool, err error, normalized any) {
	status := "accepted"
	switch {
	case errors.Is(err, telemetry.ErrInvalid), errors.Is(err, telemetry.ErrConflict):
		status = "rejected"
	case err != nil:
		status = "retry"
	case !accepted:
		status = "ignored"
	}
	source, device, kind, managed := devicestate.ParseTopic(topic)
	if err != nil || !accepted {
		normalized = nil
	}
	if managed && accepted && err == nil && len(payload) == 0 {
		kind = "deleted"
	}
	if sample, ok := normalized.(telemetry.Sample); ok {
		source, device, kind = sample.SourceID, sample.DeviceID, "samples"
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
	c.messages[c.messageHead] = m
	c.messageHead = (c.messageHead + 1) % MessageLimit
	if c.messageCount < MessageLimit {
		c.messageCount++
	}
}
