package storage

import (
	"context"
	"database/sql"
	"fmt"
	"path/filepath"
	"testing"
	"time"

	"github.com/cajui/cajui-central/internal/history"
	"github.com/cajui/cajui-central/internal/telemetry"
)

func TestHistoryMigrationPagingIsolationAndPersistence(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "history.db")
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	at := time.Date(2026, 1, 10, 12, 0, 0, 123456789, time.UTC)
	sample := sampleFixture(t)
	for i := 0; i < 220; i++ {
		sample.SampleID = fmt.Sprint(i)
		if _, err = s.InsertSample(ctx, sample, at.Add(time.Duration(i/2)*time.Minute)); err != nil {
			t.Fatal(err)
		}
	}
	if inserted, e := s.InsertSample(ctx, sample, at.Add(24*time.Hour)); inserted || e != nil {
		t.Fatal(inserted, e)
	}
	other := sample
	other.SourceID = "other"
	other.Readings = append([]telemetry.Measurement{}, sample.Readings...)
	if _, err = s.InsertSample(ctx, other, at); err != nil {
		t.Fatal(err)
	}
	other = sample
	other.SampleID = "unit"
	other.Readings = append([]telemetry.Measurement{}, sample.Readings...)
	other.Readings[0].Unit = "other"
	if _, err = s.InsertSample(ctx, other, at); err != nil {
		t.Fatal(err)
	}
	r := telemetry.Reading{NodeID: sample.DeviceID, SensorID: sample.Readings[0].SensorID, SessionID: "boot", Metric: sample.Readings[0].Metric, Unit: sample.Readings[0].Unit, Value: 42}
	if _, err = s.Insert(ctx, r, at); err != nil {
		t.Fatal(err)
	}
	if _, err = s.db.Exec(`DROP TABLE measurement_history; PRAGMA user_version=7`); err != nil {
		t.Fatal(err)
	}
	s.Close()
	s, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	var sensor int64
	if err = s.db.QueryRow(`SELECT s.id FROM workspace_sensors s JOIN workspace_devices d ON d.id=s.device_id WHERE d.transport='mqtt' AND d.source=? AND s.sensor=?`, sample.SourceID, sample.Readings[0].SensorID).Scan(&sensor); err != nil {
		t.Fatal(err)
	}
	q := history.Query{SensorID: sensor, Metric: sample.Readings[0].Metric, Unit: sample.Readings[0].Unit, From: at.Truncate(time.Second), To: at.Add(24 * time.Hour)}
	got, err := s.History(ctx, q, true)
	if err != nil || got.Count != 220 || len(got.Points) != 220 || len(got.Rows) != 100 || got.Next == "" {
		t.Fatal(got.Count, len(got.Rows), err)
	}
	if got.Points[0].ReceivedAt != at.Format(time.RFC3339Nano) {
		t.Fatal(got.Points[0])
	}
	ids := map[int64]bool{}
	anchor := got.Anchor
	newer := sample
	newer.SampleID = "later"
	if _, err = s.InsertSample(ctx, newer, at.Add(time.Second)); err != nil {
		t.Fatal(err)
	}
	for {
		for _, p := range got.Rows {
			if ids[p.ID] {
				t.Fatal("duplicate page row")
			}
			ids[p.ID] = true
		}
		if got.Next == "" {
			break
		}
		q.Anchor = anchor
		if _, err = fmt.Sscanf(got.Next, "%d:%d", &q.BeforeTime, &q.BeforeID); err != nil {
			t.Fatal(err)
		}
		got, err = s.History(ctx, q, false)
		if err != nil {
			t.Fatal(err)
		}
	}
	if len(ids) != 220 {
		t.Fatal(len(ids))
	}
	q.BeforeID, q.BeforeTime, q.Anchor = 0, 0, 0
	q.To = at.Add(time.Minute).Truncate(time.Second)
	got, err = s.History(ctx, q, true)
	if err != nil || got.Count != 3 {
		t.Fatal(got.Count, err)
	}
	q.Unit = "nonexistent"
	got, err = s.History(ctx, q, true)
	if err != nil || got.Count != 0 || len(got.Rows) != 0 {
		t.Fatal(got, err)
	}
	q.SensorID = 0
	if _, err = s.History(ctx, q, true); err == nil {
		t.Fatal("invalid query accepted")
	}
	q.SensorID = sensor
	canceled, cancel := context.WithCancel(ctx)
	cancel()
	if _, err = s.History(canceled, q, true); err == nil {
		t.Fatal("ignored cancellation")
	}
}

func TestHistoryWritesAreAtomicAndMigrationRollsBack(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "db")
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.db.Exec(`CREATE TRIGGER fail_history BEFORE INSERT ON measurement_history BEGIN SELECT RAISE(ABORT,'history failed'); END`); err != nil {
		t.Fatal(err)
	}
	if _, err = s.InsertSample(ctx, sampleFixture(t), time.Now()); err == nil {
		t.Fatal("missing error")
	}
	r := telemetry.Reading{NodeID: "node", SensorID: "sensor", SessionID: "boot", Metric: "temperature", Value: 0, Unit: "degC"}
	if _, err = s.Insert(ctx, r, time.Now()); err == nil {
		t.Fatal("missing error")
	}
	for _, table := range []string{"samples", "readings", "workspace_devices"} {
		var count int
		s.db.QueryRow(`SELECT COUNT(*) FROM ` + table).Scan(&count)
		if count != 0 {
			t.Fatal(table, count)
		}
	}
	s.db.Exec(`DROP TRIGGER fail_history`)
	if _, err = s.Insert(ctx, r, time.Now()); err != nil {
		t.Fatal(err)
	}
	if _, err = s.db.Exec(`DROP TABLE measurement_history; UPDATE readings SET payload='broken'; PRAGMA user_version=7;`); err != nil {
		t.Fatal(err)
	}
	s.Close()
	if s, err = Open(path); err == nil {
		s.Close()
		t.Fatal("bad migration accepted")
	}
	raw, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer raw.Close()
	var version int
	raw.QueryRow(`PRAGMA user_version`).Scan(&version)
	if version != 7 {
		t.Fatal(version)
	}
	var name string
	if err = raw.QueryRow(`SELECT name FROM sqlite_master WHERE name='measurement_history'`).Scan(&name); err != sql.ErrNoRows {
		t.Fatal(name, err)
	}

}

func TestHistoryLargeSeriesKeepsSensorFailuresAndExtremes(t *testing.T) {
	s, err := Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	ctx := context.Background()
	at := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	sample := sampleFixture(t)
	sample.Readings = sample.Readings[:1]
	for i := 0; i < 700; i++ {
		sample.SampleID = fmt.Sprint(i)
		value := float64(i)
		sample.Readings[0].Value = &value
		sample.Readings[0].Status = "ok"
		if i == 698 {
			sample.Readings[0].Value = nil
			sample.Readings[0].Status = "error"
		}
		if i == 699 {
			sample.Readings[0].Value = nil
			sample.Readings[0].Status = "skipped"
		}
		if _, err = s.InsertSample(ctx, sample, at.Add(time.Duration(i)*time.Minute)); err != nil {
			t.Fatal(err)
		}
	}
	var sensor int64
	if err = s.db.QueryRow(`SELECT id FROM workspace_sensors WHERE sensor=?`, sample.Readings[0].SensorID).Scan(&sensor); err != nil {
		t.Fatal(err)
	}
	q := history.Query{SensorID: sensor, Metric: sample.Readings[0].Metric, Unit: sample.Readings[0].Unit, From: at, To: at.Add(24 * time.Hour)}
	got, err := s.History(ctx, q, true)
	if err != nil || !got.Sampled || got.Count != 700 || len(got.Points) > 600 {
		t.Fatal(got.Count, len(got.Points), err)
	}
	if got.Rows[0].Status != "skipped" || got.Rows[0].Value != nil || got.Rows[1].Status != "error" {
		t.Fatal(got.Rows[:2])
	}
	low, high, broken := false, false, false
	for _, p := range got.Points {
		if p.Value != nil {
			low = low || *p.Value == 0
			high = high || *p.Value == 697
		}
		broken = broken || p.BreakBefore
	}
	if !low || !high || !broken {
		t.Fatal(low, high, broken)
	}
}
