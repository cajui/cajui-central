package main

import (
	"context"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestStartupConfigurationErrors(t *testing.T) {
	t.Setenv("CAJUI_API_TOKEN", "")
	if err := run(context.Background()); err == nil {
		t.Fatal("started without credentials")
	}
	t.Setenv("CAJUI_API_TOKEN", "test-token-with-at-least-24-characters")
	t.Setenv("CAJUI_ADDR", "127.0.0.1:8080")
	dir := t.TempDir()
	file := filepath.Join(dir, "file")
	if err := os.WriteFile(file, []byte("not a directory"), 0600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("CAJUI_DB", filepath.Join(file, "nested", "db"))
	if err := run(context.Background()); err == nil {
		t.Fatal("started with invalid directory")
	}
	t.Setenv("CAJUI_DB", dir)
	if err := run(context.Background()); err == nil {
		t.Fatal("started with directory as database")
	}
}

func TestServerLifecycle(t *testing.T) {
	for _, mode := range []string{"http", "mqtt-unavailable"} {
		t.Run(mode, func(t *testing.T) {
			if mode == "mqtt-unavailable" {
				t.Setenv("CAJUI_MQTT_URL", "tcp://127.0.0.1:1")
				t.Setenv("CAJUI_MQTT_ALLOW_PLAINTEXT", "1")
				t.Setenv("CAJUI_MQTT_USERNAME", "test")
				t.Setenv("CAJUI_MQTT_PASSWORD", "test-password")
			}
			testServerLifecycle(t)
		})
	}
}
func testServerLifecycle(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	address := listener.Addr().String()
	if err = listener.Close(); err != nil {
		t.Fatal(err)
	}
	t.Setenv("CAJUI_ADDR", address)
	t.Setenv("CAJUI_API_TOKEN", "test-token-with-at-least-24-characters")
	t.Setenv("CAJUI_DB", filepath.Join(t.TempDir(), "app.db"))
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	result := make(chan error, 1)
	go func() { result <- run(ctx) }()
	client := &http.Client{Timeout: 100 * time.Millisecond}
	deadline := time.NewTimer(5 * time.Second)
	defer deadline.Stop()
	ticker := time.NewTicker(10 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case err := <-result:
			t.Fatalf("server exited before readiness: %v", err)
		case <-deadline.C:
			t.Fatal("server did not become ready")
		case <-ticker.C:
			response, err := client.Get("http://" + address + "/healthz")
			if err != nil {
				continue
			}
			_ = response.Body.Close()
			if response.StatusCode != 200 {
				t.Fatalf("health status %d", response.StatusCode)
			}
			cancel()
			select {
			case err := <-result:
				if err != nil {
					t.Fatal(err)
				}
			case <-time.After(5 * time.Second):
				t.Fatal("shutdown timed out")
			}
			return
		}
	}
}
