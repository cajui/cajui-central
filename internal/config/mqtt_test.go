package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestMQTTConfig(t *testing.T) {
	base := map[string]string{"CAJUI_MQTT_URL": "ssl://example.com:8883", "CAJUI_MQTT_USERNAME": "central", "CAJUI_MQTT_PASSWORD": "secret"}
	get := func(k string) string { return base[k] }
	c, e := loadMQTT(get)
	if e != nil || c.TLS == nil || c.ClientID != "cajui-central" {
		t.Fatal(c, e)
	}
	for _, url := range []string{"tcp://localhost:1883", "ssl://user:pass@host:8883", "ssl://host:8883/path", "ssl://host:8883?q=1", "ssl://host:8883#x", "http://host:1883", "ssl://host", "ssl://host:0", "ssl://host:70000", "%"} {
		base["CAJUI_MQTT_URL"] = url
		if _, e := loadMQTT(get); e == nil {
			t.Fatalf("accepted %s", url)
		}
	}
	base["CAJUI_MQTT_URL"] = "tcp://localhost:1883"
	base["CAJUI_MQTT_ALLOW_PLAINTEXT"] = "1"
	if _, e := loadMQTT(get); e != nil {
		t.Fatal(e)
	}
	base["CAJUI_MQTT_CLIENT_ID"] = strings.Repeat("x", 65)
	if _, e := loadMQTT(get); e == nil {
		t.Fatal("long ID")
	}
	delete(base, "CAJUI_MQTT_CLIENT_ID")
	delete(base, "CAJUI_MQTT_PASSWORD")
	if _, e := loadMQTT(get); e == nil {
		t.Fatal("no password")
	}
	base["CAJUI_MQTT_PASSWORD_FILE"] = "/missing-secret"
	if _, e := loadMQTT(get); e == nil {
		t.Fatal("missing file")
	}
}
func TestSecretFiles(t *testing.T) {
	path := filepath.Join(t.TempDir(), "secret")
	if e := os.WriteFile(path, []byte("secret\n"), 0600); e != nil {
		t.Fatal(e)
	}
	values := map[string]string{"TOKEN_FILE": path}
	get := func(k string) string { return values[k] }
	if v, e := secret(get, "TOKEN"); e != nil || v != "secret" {
		t.Fatal(v, e)
	}
	values["TOKEN"] = "other"
	if _, e := secret(get, "TOKEN"); e == nil {
		t.Fatal("ambiguous secret")
	}
	delete(values, "TOKEN")
	if e := os.WriteFile(path, make([]byte, 4097), 0600); e != nil {
		t.Fatal(e)
	}
	if _, e := secret(get, "TOKEN"); e == nil {
		t.Fatal("large secret")
	}
	values["CAJUI_API_TOKEN_FILE"] = "/missing"
	if _, e := Load(get); e == nil {
		t.Fatal("missing API secret")
	}
}
