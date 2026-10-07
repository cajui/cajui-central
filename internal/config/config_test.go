package config

import (
	"strings"
	"testing"
)

func TestLoad(t *testing.T) {
	values := map[string]string{"CAJUI_API_TOKEN": strings.Repeat("x", 24)}
	get := func(k string) string { return values[k] }
	c, err := Load(get)
	if err != nil || c.Address != "127.0.0.1:8080" || c.Database != "data/cajui.db" {
		t.Fatalf("%+v %v", c, err)
	}
	for _, addr := range []string{"0.0.0.0:8080", "localhost:8080", "broken", "127.0.0.1:0", "127.0.0.1:65536", "127.0.0.1:abc"} {
		values["CAJUI_ADDR"] = addr
		if _, err = Load(get); err == nil {
			t.Errorf("accepted %s", addr)
		}
	}
	values["CAJUI_ADDR"] = "[::1]:9090"
	values["CAJUI_DB"] = "example.db"
	if c, err = Load(get); err != nil || c.Database != "example.db" {
		t.Fatal(c, err)
	}
	values["CAJUI_ADDR"] = "0.0.0.0:8080"
	values["CAJUI_ALLOW_NON_LOOPBACK"] = "true"
	if _, err = Load(get); err == nil {
		t.Fatal("accepted non-loopback without the exact opt-in value")
	}
	values["CAJUI_ALLOW_NON_LOOPBACK"] = "1"
	values["CAJUI_ADDR"] = "localhost:8080"
	if _, err = Load(get); err == nil {
		t.Fatal("accepted hostname with opt-in")
	}
	values["CAJUI_ADDR"] = "0.0.0.0:8080"
	if c, err = Load(get); err != nil || c.Address != "0.0.0.0:8080" {
		t.Fatal(c, err)
	}
	values["CAJUI_API_TOKEN"] = "short"
	if _, err = Load(get); err == nil {
		t.Fatal("accepted short token")
	}
}

func TestReceiverSetupConfiguration(t *testing.T) {
	values := map[string]string{"CAJUI_API_TOKEN": strings.Repeat("x", 24), "CAJUI_RECEIVER_USERNAME": "receiver-1", "CAJUI_RECEIVER_PASSWORD_FILE": "/configured/producer", "CAJUI_RECEIVER_PORT": "1883"}
	get := func(k string) string { return values[k] }
	if c, err := Load(get); err != nil || c.ReceiverPort != 1883 || c.ReceiverUsername != "receiver-1" {
		t.Fatal(c, err)
	}
	for _, name := range []string{"", "central", "homeassistant", "bad/name", "bad name"} {
		values["CAJUI_RECEIVER_USERNAME"] = name
		if _, err := Load(get); err == nil {
			t.Fatalf("accepted receiver user %q", name)
		}
	}
	values["CAJUI_RECEIVER_USERNAME"] = "receiver-1"
	for _, port := range []string{"0", "65536", "abc"} {
		values["CAJUI_RECEIVER_PORT"] = port
		if _, err := Load(get); err == nil {
			t.Fatal("invalid port accepted")
		}
	}
	values["CAJUI_RECEIVER_PORT"] = ""
	values["CAJUI_RECEIVER_HOST"] = strings.Repeat("x", 254)
	if _, err := Load(get); err == nil {
		t.Fatal("oversized host accepted")
	}
}

func TestReceiverUsernameWithoutPasswordFile(t *testing.T) {
	values := map[string]string{"CAJUI_API_TOKEN": strings.Repeat("x", 24)}
	get := func(k string) string { return values[k] }
	for _, user := range []string{"central", "homeassistant", "bad name", "bad:name", strings.Repeat("a", 500)} {
		values["CAJUI_RECEIVER_USERNAME"] = user
		if _, err := Load(get); err == nil {
			t.Fatalf("accepted invalid external receiver user %q", user)
		}
	}
	for _, user := range []string{"", "receiver-1"} {
		values["CAJUI_RECEIVER_USERNAME"] = user
		if _, err := Load(get); err != nil {
			t.Fatal(err)
		}
	}
}
