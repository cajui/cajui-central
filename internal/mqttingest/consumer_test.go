package mqttingest

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"os"
	"testing"
	"time"

	"github.com/cajui/cajui-central/internal/telemetry"
)

type repository struct {
	calls int
	err   error
}

func (r *repository) InsertSample(context.Context, telemetry.Sample, time.Time) (bool, error) {
	r.calls++
	return true, r.err
}
func TestHandle(t *testing.T) {
	b, e := os.ReadFile("../../examples/mqtt/sample.json")
	if e != nil {
		t.Fatal(e)
	}
	repo := &repository{}
	c := New(Config{}, repo, nil)
	topic := "telemetry/v1/demo-source/demo-device/samples"
	if ok, e := c.Handle(context.Background(), topic, b, false); !ok || e != nil || repo.calls != 1 {
		t.Fatal(ok, e, repo.calls)
	}
	if ok, e := c.Handle(context.Background(), topic, b, true); ok || e != nil || repo.calls != 1 {
		t.Fatal("retained snapshot accepted")
	}
	for _, tc := range []struct {
		topic string
		data  []byte
	}{{topic, []byte("bad")}, {"telemetry/v1/other/demo-device/samples", b}} {
		if _, e := c.Handle(context.Background(), tc.topic, tc.data, false); !errors.Is(e, telemetry.ErrInvalid) {
			t.Fatal(e)
		}
	}
	repo.err = errors.New("storage failed")
	if _, e := c.Handle(context.Background(), topic, b, false); e == nil {
		t.Fatal("swallowed storage failure")
	}
}
func TestRunCanceledAndUnavailable(t *testing.T) {
	c := New(Config{URL: "tcp://127.0.0.1:1", ClientID: "test"}, &repository{}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	c.Run(ctx)
	if c.Connected() {
		t.Fatal("connected without broker")
	}
	if pause(ctx, time.Hour) {
		t.Fatal("ignored cancellation")
	}
	if !pause(context.Background(), time.Millisecond) {
		t.Fatal("timer canceled")
	}
}
