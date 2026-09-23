package config

import (
	"crypto/tls"
	"errors"
	"io"
	"net/url"
	"os"
	"strconv"
	"strings"

	"github.com/cajui/cajui-central/internal/mqttingest"
)

func secret(getenv func(string) string, name string) (string, error) {
	value, path := getenv(name), getenv(name+"_FILE")
	if path == "" {
		return value, nil
	}
	if value != "" {
		return "", errors.New(name + " and " + name + "_FILE are mutually exclusive")
	}
	file, err := os.Open(path)
	if err != nil {
		return "", errors.New("cannot read " + name + "_FILE")
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, 4097))
	if err != nil {
		return "", errors.New("cannot read " + name + "_FILE")
	}
	if len(data) > 4096 {
		return "", errors.New(name + "_FILE is too large")
	}
	return strings.TrimRight(string(data), "\r\n"), nil
}
func loadMQTT(getenv func(string) string) (mqttingest.Config, error) {
	c := mqttingest.Config{URL: getenv("CAJUI_MQTT_URL"), ClientID: getenv("CAJUI_MQTT_CLIENT_ID"), Username: getenv("CAJUI_MQTT_USERNAME")}
	if c.URL == "" {
		return c, nil
	}
	u, err := url.Parse(c.URL)
	if err != nil || u.Hostname() == "" || u.Port() == "" || u.User != nil || u.Path != "" || u.RawQuery != "" || u.Fragment != "" {
		return c, errors.New("invalid CAJUI_MQTT_URL")
	}
	port, err := strconv.Atoi(u.Port())
	if err != nil || port < 1 || port > 65535 {
		return c, errors.New("invalid MQTT port")
	}
	switch u.Scheme {
	case "ssl":
		c.TLS = &tls.Config{MinVersion: tls.VersionTLS12}
	case "tcp":
		if getenv("CAJUI_MQTT_ALLOW_PLAINTEXT") != "1" {
			return c, errors.New("plain MQTT requires CAJUI_MQTT_ALLOW_PLAINTEXT=1")
		}
	default:
		return c, errors.New("MQTT URL must use ssl or tcp")
	}
	if c.ClientID == "" {
		c.ClientID = "cajui-central"
	}
	if len(c.ClientID) > 64 || strings.ContainsAny(c.ClientID, "\x00\r\n") {
		return c, errors.New("invalid MQTT client ID")
	}
	c.Password, err = secret(getenv, "CAJUI_MQTT_PASSWORD")
	if err != nil {
		return c, err
	}
	if c.Username == "" || c.Password == "" {
		return c, errors.New("MQTT username and password are required")
	}
	return c, nil
}
