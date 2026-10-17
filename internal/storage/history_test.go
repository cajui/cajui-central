package storage

import (
	"context"
	"database/sql"
	"errors"
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
	if err != nil || (got.Count == nil || *got.Count != 220) || len(got.Points) != 220 || len(got.Rows) != 100 || got.Next == "" {
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
	if err != nil || (got.Count == nil || *got.Count != 3) {
		t.Fatal(got.Count, err)
	}
	q.Unit = "nonexistent"
	got, err = s.History(ctx, q, true)
	if err != nil || (got.Count == nil || *got.Count != 0) || len(got.Rows) != 0 {
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
	if err != nil || (got.Sampled == nil || !*got.Sampled) || (got.Count == nil || *got.Count != 700) || len(got.Points) > 600 {
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

func TestHistoryReadersDoNotBlockIngestionOrHealth(t *testing.T) {
	s, err := Open(filepath.Join(t.TempDir(), "history ? & mode=memory.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	sample := sampleFixture(t)
	at := time.Now()
	if _, err = s.InsertSample(context.Background(), sample, at); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		tx, e := s.historyDB.Begin()
		if e != nil {
			t.Fatal(e)
		}
		defer tx.Rollback()
		var count int
		if e = tx.QueryRow(`SELECT COUNT(*) FROM measurement_history`).Scan(&count); e != nil || count == 0 {
			t.Fatal(count, e)
		}
		if _, e = tx.Exec(`DELETE FROM measurement_history`); e == nil {
			t.Fatal("history connection accepted a write")
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	sample.SampleID = "while-reading"
	if ok, e := s.InsertSample(ctx, sample, at); !ok || e != nil {
		t.Fatal("reader blocked ingestion", ok, e)
	}
	if e := s.Ping(ctx); e != nil {
		t.Fatal(e)
	}
	if rows, e := s.RecentSamples(ctx, 100); e != nil || len(rows) != 2 {
		t.Fatal(rows, e)
	}
	blocked, stop := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer stop()
	q := history.Query{SensorID: 1, Metric: "temperature", Unit: "degC", From: at.Add(-time.Hour), To: at.Add(time.Hour)}
	if _, e := s.History(blocked, q, true); !errors.Is(e, context.DeadlineExceeded) {
		t.Fatal("reader pool ignored cancellation", e)
	}
}

func TestHistorySchemaEightUpgradeAndConstraints(t *testing.T) {
	path := filepath.Join(t.TempDir(), "db")
	s, e := Open(path)
	if e != nil {
		t.Fatal(e)
	}
	sample := sampleFixture(t)
	at := time.Now()
	if _, e = s.InsertSample(context.Background(), sample, at); e != nil {
		t.Fatal(e)
	}
	if _, e = s.Insert(context.Background(), telemetry.Reading{NodeID: "http", SensorID: "probe", SessionID: "boot", Metric: "temperature", Unit: "degC", Value: 12}, at); e != nil {
		t.Fatal(e)
	}
	var count, maxID int
	s.db.QueryRow(`SELECT COUNT(*),MAX(id) FROM measurement_history`).Scan(&count, &maxID)
	_, e = s.db.Exec(`UPDATE workspace_devices SET name='Preserved',archived=1;
 CREATE TABLE old_history AS SELECT id,sensor_id,metric,unit,received_ms,received_at,value,status,interval FROM measurement_history;
 DROP TABLE measurement_history; ALTER TABLE old_history RENAME TO measurement_history; PRAGMA user_version=8;`)
	if e != nil {
		t.Fatal(e)
	}
	s.Close()
	s, e = Open(path)
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	var got, minID, version int
	s.db.QueryRow(`SELECT COUNT(*),MIN(id) FROM measurement_history`).Scan(&got, &minID)
	s.db.QueryRow(`PRAGMA user_version`).Scan(&version)
	if count != got || minID <= maxID || version != 9 {
		t.Fatal(count, got, minID, maxID, version)
	}
	var changed int
	s.db.QueryRow(`SELECT COUNT(*) FROM workspace_devices WHERE name!='Preserved' OR archived!=1`).Scan(&changed)
	if changed != 0 {
		t.Fatal("migration changed registrations")
	}
	for _, query := range []string{
		`UPDATE measurement_history SET status='invented'`,
		`UPDATE measurement_history SET value=NULL WHERE status='ok'`,
		`UPDATE measurement_history SET status='error' WHERE value IS NOT NULL`,
		`UPDATE measurement_history SET reading_id=NULL,sample_id=NULL`,
		`UPDATE measurement_history SET sample_id=999999 WHERE sample_id IS NOT NULL`,
		`INSERT INTO measurement_history(sensor_id,reading_id,sample_id,metric,unit,received_ms,received_at,value,status,interval) SELECT sensor_id,reading_id,sample_id,metric,unit,received_ms,received_at,value,status,interval FROM measurement_history`,
	} {
		if _, e = s.db.Exec(query); e == nil {
			t.Fatal("constraint accepted invalid projection", query)
		}
	}
	if ok, e := s.InsertSample(context.Background(), sample, at.Add(time.Hour)); ok || e != nil {
		t.Fatal("retry changed migrated history", ok, e)
	}
	var after int
	s.db.QueryRow(`SELECT COUNT(*) FROM measurement_history`).Scan(&after)
	if after != count {
		t.Fatal(after, count)
	}
}

func TestHistoryRowsDoNotInventChartStatistics(t *testing.T) {
	s, e := Open(":memory:")
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	at := time.Now()
	sample := sampleFixture(t)
	if _, e = s.InsertSample(context.Background(), sample, at); e != nil {
		t.Fatal(e)
	}
	var sensor int64
	r := sample.Readings[0]
	s.db.QueryRow(`SELECT id FROM workspace_sensors WHERE sensor=?`, r.SensorID).Scan(&sensor)
	q := history.Query{SensorID: sensor, Metric: r.Metric, Unit: r.Unit, From: at.Add(-time.Hour), To: at.Add(time.Hour)}
	result, e := s.History(context.Background(), q, false)
	if e != nil || len(result.Rows) != 1 || result.Count != nil || result.Sampled != nil {
		t.Fatal(result, e)
	}
}

func TestHistorySchemaEightFailurePreservesPreviousProjection(t *testing.T) {
	path := filepath.Join(t.TempDir(), "db")
	s, e := Open(path)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = s.InsertSample(context.Background(), sampleFixture(t), time.Now()); e != nil {
		t.Fatal(e)
	}
	var before int
	s.db.QueryRow(`SELECT COUNT(*) FROM measurement_history`).Scan(&before)
	if _, e = s.db.Exec(`UPDATE samples SET payload='broken'; PRAGMA user_version=8;`); e != nil {
		t.Fatal(e)
	}
	s.Close()
	if opened, e := Open(path); e == nil {
		opened.Close()
		t.Fatal("migration accepted corrupt source")
	}
	raw, e := sql.Open("sqlite", path)
	if e != nil {
		t.Fatal(e)
	}
	defer raw.Close()
	var count, version int
	if e = raw.QueryRow(`SELECT COUNT(*) FROM measurement_history`).Scan(&count); e != nil {
		t.Fatal(e)
	}
	if e = raw.QueryRow(`PRAGMA user_version`).Scan(&version); e != nil {
		t.Fatal(e)
	}
	if count != before || version != 8 {
		t.Fatal(count, before, version)
	}
}

func TestHistoryDoesNotAcquireWriterConnection(t *testing.T) {
	s, e := Open(filepath.Join(t.TempDir(), "db"))
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	at := time.Now()
	sample := sampleFixture(t)
	if _, e = s.InsertSample(context.Background(), sample, at); e != nil {
		t.Fatal(e)
	}
	writer, e := s.db.Conn(context.Background())
	if e != nil {
		t.Fatal(e)
	}
	defer writer.Close()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	result, e := s.History(ctx, history.Query{SensorID: 1, Metric: sample.Readings[0].Metric, Unit: sample.Readings[0].Unit, From: at.Add(-time.Hour), To: at.Add(time.Hour)}, true)
	if e != nil || result.Count == nil || *result.Count != 1 {
		t.Fatal("history used writer connection", result, e)
	}
}
