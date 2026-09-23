package mqttingest

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/cajui/cajui-central/internal/storage"
	"github.com/cajui/cajui-central/internal/telemetry"
	mqtt "github.com/eclipse/paho.mqtt.golang"
)

// This test uses the authenticated development broker, never an in-memory substitute.
func TestBrokerIntegration(t *testing.T) {
	url := os.Getenv("CAJUI_TEST_MQTT_URL")
	if url == "" {
		t.Skip("set CAJUI_TEST_MQTT_URL for real broker integration")
	}
	secret := func(name string) string {
		b, e := os.ReadFile(filepath.Join("../../.local-mqtt", name))
		if e != nil {
			t.Fatal(e)
		}
		return strings.TrimSpace(string(b))
	}
	db, e := storage.Open(filepath.Join(t.TempDir(), "db"))
	if e != nil {
		t.Fatal(e)
	}
	defer db.Close()
	config := Config{URL: url, Username: "central", Password: secret("central"), ClientID: "integration-central"}
	c := New(config, db, slog.New(slog.NewTextHandler(io.Discard, nil)))
	start := func() (context.CancelFunc, chan struct{}) {
		ctx, cancel := context.WithCancel(context.Background())
		done := make(chan struct{})
		go func() { defer close(done); c.Run(ctx) }()
		return cancel, done
	}
	cancel, done := start()
	defer func() { cancel(); <-done }()
	eventually(t, func() bool { return c.Connected() })
	publisher := mqtt.NewClient(mqtt.NewClientOptions().AddBroker(url).SetClientID("integration-publisher").SetUsername("demo-source").SetPassword(secret("demo-source")))
	await := func(token mqtt.Token) {
		t.Helper()
		if !token.WaitTimeout(5*time.Second) || token.Error() != nil {
			t.Fatalf("MQTT operation failed: %v", token.Error())
		}
	}
	await(publisher.Connect())
	defer publisher.Disconnect(0)
	bytes, e := os.ReadFile("../../examples/mqtt/sample.json")
	if e != nil {
		t.Fatal(e)
	}
	topic := "telemetry/v1/demo-source/demo-device/samples"
	publish := func(b []byte) { await(publisher.Publish(topic, 1, false, b)) }
	count := func() int {
		all, e := db.RecentSamples(context.Background(), 100)
		if e != nil {
			t.Error(e)
		}
		return len(all)
	}
	publish(bytes)
	eventually(t, func() bool { return count() == 1 })
	publish(bytes)
	publish([]byte("invalid"))
	publish([]byte(strings.Replace(string(bytes), "demo-source", "other", 1)))
	s, e := telemetry.DecodeSample(bytes)
	if e != nil {
		t.Fatal(e)
	}
	s.SampleID = "integration.2"
	s.Readings[0].Value = nil
	s.Readings[0].Status = "error"
	payload, _ := json.Marshal(s)
	publish(payload)
	eventually(t, func() bool { return count() == 2 })
	d, e := db.Devices(context.Background(), time.Now())
	if e != nil || len(d) != 1 || !d[0].SensorError {
		t.Fatal(d, e)
	}
	// A duplicate client ID forces a real connection loss. Stop the competing
	// client immediately, then verify the consumer reconnects and resubscribes.
	competitor := mqtt.NewClient(mqtt.NewClientOptions().AddBroker(url).SetClientID(config.ClientID).SetUsername("central").SetPassword(secret("central")))
	await(competitor.Connect())
	competitor.Disconnect(0)
	s.SampleID = "integration.3"
	payload, _ = json.Marshal(s)
	eventually(t, func() bool { publish(payload); return count() == 3 })
	// Subscriber restart: clean sessions ignore retained historical samples.
	cancel()
	<-done
	s.SampleID = "retained.old"
	payload, _ = json.Marshal(s)
	await(publisher.Publish(topic, 1, true, payload))
	cancel, done = start()
	eventually(t, func() bool { return c.Connected() })
	s.SampleID = "integration.4"
	payload, _ = json.Marshal(s)
	publish(payload)
	eventually(t, func() bool { return count() == 4 })
	await(publisher.Publish(topic, 1, true, []byte{})) // remove retained test state
	// An independent read-only consumer continues receiving with Central stopped.
	cancel()
	<-done
	observer := mqtt.NewClient(mqtt.NewClientOptions().AddBroker(url).SetClientID("integration-homeassistant").SetUsername("homeassistant").SetPassword(secret("homeassistant")))
	await(observer.Connect())
	defer observer.Disconnect(250)
	received := make(chan string, 1)
	await(observer.Subscribe(topic, 1, func(_ mqtt.Client, m mqtt.Message) {
		select {
		case received <- string(m.Payload()):
		default:
		}
	}))
	s.SampleID = "independent-consumer"
	payload, _ = json.Marshal(s)
	publish(payload)
	select {
	case got := <-received:
		if got != string(payload) {
			t.Fatal("independent consumer received different payload")
		}
	case <-time.After(5 * time.Second):
		t.Fatal("independent consumer did not receive")
	}
	if count() != 4 {
		t.Fatal("Central ingested while stopped")
	}

}
func eventually(t *testing.T, condition func() bool) {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		if condition() {
			return
		}
		time.Sleep(25 * time.Millisecond)
	}
	t.Fatal("condition not met before timeout")
}
