package storage

import (
	"context"
	"github.com/cajui/cajui-central/internal/devicestate"
	"path/filepath"
	"testing"
	"time"
)

func TestDeviceStateInvalidationCoalescesAndIgnoresFailedWrites(t *testing.T) {
	db, err := Open(filepath.Join(t.TempDir(), "db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	changed := db.DeviceStateChanges()
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if db.SaveAvailability(ctx, "s", "d", "online", time.Now(), false) == nil {
		t.Fatal("cancelled write succeeded")
	}
	select {
	case <-changed:
		t.Fatal("failed write notified")
	default:
	}
	state := devicestate.State{SourceID: "s", DeviceID: "d", Role: "receiver"}
	if err = db.SaveDeviceState(context.Background(), state, time.Now(), true); err != nil {
		t.Fatal(err)
	}
	select {
	case <-changed:
	default:
		t.Fatal("missing commit notification")
	}
	changed = db.DeviceStateChanges()
	if err = db.SaveDeviceState(context.Background(), state, time.Now(), true); err != nil {
		t.Fatal(err)
	}
	select {
	case <-changed:
		t.Fatal("unchanged retained snapshot notified")
	default:
	}
	for i := 0; i < 100; i++ {
		if err = db.SaveAvailability(context.Background(), "s", "d", "online", time.Now(), false); err != nil {
			t.Fatal(err)
		}
	}
	select {
	case <-changed:
	default:
		t.Fatal("slow subscriber lost invalidation")
	}
}
