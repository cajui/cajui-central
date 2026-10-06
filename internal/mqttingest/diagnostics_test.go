package mqttingest

import (
	"context"
	"encoding/json"
	"os"
	"strings"
	"sync"
	"testing"
)

func TestDiagnosticsBoundedAndPrivate(t *testing.T) {
	c := New(Config{URL: "tcp://private:secret@broker:1883", Username: "central"}, &repository{}, nil)
	payload, err := os.ReadFile("../../examples/mqtt/sample.json")
	if err != nil {
		t.Fatal(err)
	}
	topic := "telemetry/v1/demo-source/demo-device/samples"
	if _, err = c.Handle(context.Background(), topic, payload, false); err != nil {
		t.Fatal(err)
	}
	first := c.Diagnostics()
	if len(first.Messages) != 1 || len(first.Messages[0].Payload) == 0 {
		t.Fatal(first)
	}
	first.Messages[0].Payload[0] = '!'
	if c.Diagnostics().Messages[0].Payload[0] == '!' {
		t.Fatal("mutable snapshot")
	}
	for i := 0; i < 105; i++ {
		_, _ = c.Handle(context.Background(), topic, []byte(`{"password":"do-not-expose"}`), false)
	}
	d := c.Diagnostics()
	if d.Total != 106 || d.Rejected != 105 || len(d.Messages) != MessageLimit || d.Messages[0].ID != 106 || d.Messages[99].ID != 7 {
		t.Fatal(d)
	}
	b, _ := json.Marshal(d)
	for _, secret := range []string{"do-not-expose", "secret", "private"} {
		if strings.Contains(string(b), secret) {
			t.Fatal("secret exposed")
		}
	}
	if d.Host != "broker" || d.Port != 1883 || d.ReceiverEndpoint() != "" {
		t.Fatal(d)
	}
	if len(d.Messages[0].Payload) != 0 {
		t.Fatal("invalid payload exposed")
	}
}
func TestDiagnosticsConcurrentSnapshots(t *testing.T) {
	c := New(Config{}, &repository{}, nil)
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < 150; j++ {
				c.observe("unknown", nil, false, false, nil)
				c.Diagnostics()
				c.connectionProblem("connection")
			}
		}()
	}
	wg.Wait()
	if c.Diagnostics().Total != 1200 {
		t.Fatal("lost observations")
	}
}
