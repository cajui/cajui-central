package config

import (
	"errors"
	"net"
	"net/netip"
	"strconv"
)

type Config struct{ Address, Database, Token string }

// Load deliberately restricts this unauthenticated dashboard to loopback.
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
	if err != nil || !ip.IsLoopback() {
		return c, errors.New("CAJUI_ADDR must use a loopback IP")
	}
	n, err := strconv.Atoi(port)
	if err != nil || n < 1 || n > 65535 {
		return c, errors.New("invalid port")
	}
	if len(c.Token) < 24 {
		return c, errors.New("CAJUI_API_TOKEN must contain at least 24 characters")
	}
	return c, nil
}
