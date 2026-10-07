package config

import (
	"errors"
	"net"
	"net/netip"
	"regexp"
	"strconv"

	"github.com/cajui/cajui-central/internal/mqttingest"
)

type Config struct {
	Address, Database, Token                             string
	MQTT                                                 mqttingest.Config
	ReceiverUsername, ReceiverPasswordFile, ReceiverHost string
	ReceiverPort                                         int
}

// Load deliberately restricts this unauthenticated dashboard to loopback.
// CAJUI_ALLOW_NON_LOOPBACK=1 exists for containers only: the process has to bind
// the container interface, and the host-side port publication keeps loopback.
func Load(getenv func(string) string) (Config, error) {
	c := Config{Address: getenv("CAJUI_ADDR"), Database: getenv("CAJUI_DB"), Token: getenv("CAJUI_API_TOKEN")}
	if c.Address == "" {
		c.Address = "127.0.0.1:8080"
	}
	if c.Database == "" {
		c.Database = "data/cajui.db"
	}
	host, port, err := net.SplitHostPort(c.Address)
	if err != nil {
		return c, errors.New("invalid CAJUI_ADDR")
	}
	ip, err := netip.ParseAddr(host)
	if err != nil || (!ip.IsLoopback() && getenv("CAJUI_ALLOW_NON_LOOPBACK") != "1") {
		return c, errors.New("CAJUI_ADDR must use a loopback IP unless CAJUI_ALLOW_NON_LOOPBACK=1")
	}
	n, err := strconv.Atoi(port)
	if err != nil || n < 1 || n > 65535 {
		return c, errors.New("invalid port")
	}
	c.Token, err = secret(getenv, "CAJUI_API_TOKEN")
	if err != nil {
		return c, err
	}
	if len(c.Token) < 24 {
		return c, errors.New("CAJUI_API_TOKEN must contain at least 24 characters")
	}
	c.MQTT, err = loadMQTT(getenv)
	if err != nil {
		return c, err
	}
	c.ReceiverUsername = getenv("CAJUI_RECEIVER_USERNAME")
	c.ReceiverPasswordFile = getenv("CAJUI_RECEIVER_PASSWORD_FILE")
	c.ReceiverHost = getenv("CAJUI_RECEIVER_HOST")
	if (c.ReceiverUsername != "" || c.ReceiverPasswordFile != "") && (!regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`).MatchString(c.ReceiverUsername) || c.ReceiverUsername == "central" || c.ReceiverUsername == "homeassistant" || c.ReceiverUsername == c.MQTT.Username) {
		return c, errors.New("invalid CAJUI_RECEIVER_USERNAME")
	}
	if raw := getenv("CAJUI_RECEIVER_PORT"); raw != "" {
		c.ReceiverPort, err = strconv.Atoi(raw)
		if err != nil || c.ReceiverPort < 1 || c.ReceiverPort > 65535 {
			return c, errors.New("invalid CAJUI_RECEIVER_PORT")
		}
	}
	if len(c.ReceiverHost) > 253 {
		return c, errors.New("invalid CAJUI_RECEIVER_HOST")
	}
	return c, nil
}
