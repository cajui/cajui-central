package storage

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/cajui/cajui-central/internal/history"
	"github.com/cajui/cajui-central/internal/telemetry"
	"github.com/cajui/cajui-central/internal/workspace"
)

func catalog(t *testing.T, s *Store) workspace.Catalog {
	t.Helper()
	c, err := s.Catalog(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	return c
}
func TestWorkspaceInventoryNamesAndPersistence(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "db")
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	at := time.Now().UTC()
	r := sample()
	if _, err = s.Insert(ctx, r, at); err != nil {
		t.Fatal(err)
	}
	initial := catalog(t, s)
	if len(initial.Devices) != 1 || len(initial.Sensors) != 1 || initial.Devices[0].Name != "" {
		t.Fatal(initial)
	}
	d, sen := initial.Devices[0], initial.Sensors[0]
	if err = s.SaveSensor(ctx, sen.ID, workspace.SensorSettings{Settings: workspace.Settings{Name: "Ambient"}}); !errors.Is(err, workspace.ErrUnregistered) {
		t.Fatal(err)
	}
	if err = s.SaveDevice(ctx, d.ID, workspace.Settings{Name: "North", Location: "Field"}); err != nil {
		t.Fatal(err)
	}
	if err = s.SaveDevice(ctx, d.ID, workspace.Settings{Name: "Lost update"}); !errors.Is(err, workspace.ErrConflict) {
		t.Fatal(err)
	}
	if err = s.SaveSensor(ctx, sen.ID, workspace.SensorSettings{Settings: workspace.Settings{Name: "Ambient"}}); err != nil {
		t.Fatal(err)
	}
	if _, err = s.Insert(ctx, r, at.Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	c := catalog(t, s)
	if c.Devices[0].ReceivedAt != d.ReceivedAt || c.Devices[0].Name != "North" || c.Sensors[0].Name != "Ambient" {
		t.Fatal(c)
	}
	// Move the sensor outside the last 100 records. Inventory and last value persist.
	r.SensorID = "other"
	for i := 0; i < 105; i++ {
		r.Sequence = int64(i + 2)
		if _, err = s.Insert(ctx, r, at.Add(time.Duration(i)*time.Second)); err != nil {
			t.Fatal(err)
		}
	}
	c = catalog(t, s)
	if len(c.Sensors) != 2 || c.Sensors[0].Measurements[0].Value == nil {
		t.Fatal(c)
	}
	if err = s.Close(); err != nil {
		t.Fatal(err)
	}
	s, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if !reflect.DeepEqual(c, catalog(t, s)) {
		t.Fatal("reopen changed catalog")
	}
	if err = s.SaveSensor(ctx, sen.ID, workspace.SensorSettings{Settings: workspace.Settings{Name: "Renamed", Revision: 1}}); err != nil {
		t.Fatal(err)
	}
	// A sensor's own name is optional: clearing it returns to the name built from its
	// readings. A device still needs one.
	if err = s.SaveSensor(ctx, sen.ID, workspace.SensorSettings{Settings: workspace.Settings{Location: "Shelf", Revision: 2}}); err != nil {
		t.Fatal(err)
	}
	if got := catalog(t, s).Sensors[0]; got.Name != "" || got.Location != "Shelf" {
		t.Fatal(got)
	}
	if err = s.SaveDevice(ctx, d.ID, workspace.Settings{Revision: 1}); !errors.Is(err, workspace.ErrInvalid) {
		t.Fatal(err)
	}
	var count int
	if err = s.db.QueryRow(`SELECT COUNT(*) FROM readings`).Scan(&count); err != nil || count != 106 {
		t.Fatal(count, err)
	}
}
func TestWorkspaceScopesLatestStatusAndAtomicity(t *testing.T) {
	s := openTest(t)
	ctx := context.Background()
	at := time.Now().UTC()
	msg := sampleFixture(t)
	msg.DeviceID = "node"
	msg.SourceID = "HTTP"
	msg.Readings = []telemetry.Measurement{{SensorID: "sensor", Metric: "temperature", Unit: "degC", Status: "error"}}
	for i, source := range []string{"HTTP", "another"} {
		msg.SourceID = source
		msg.SampleID = fmt.Sprint(i)
		if _, err := s.InsertSample(ctx, msg, at); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := s.Insert(ctx, sample(), at); err != nil {
		t.Fatal(err)
	}
	c := catalog(t, s)
	if len(c.Devices) != 3 || len(c.Sensors) != 3 {
		t.Fatal(c)
	}
	if c.Sensors[0].Measurements[0].Value != nil || c.Sensors[0].Measurements[0].Status != "error" {
		t.Fatal(c)
	}
	before := c
	if _, err := s.InsertSample(ctx, msg, at.Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(before, catalog(t, s)) {
		t.Fatal("retry refreshed inventory")
	}
	// An inventory failure must roll back the entire new sample.
	if _, err := s.db.Exec(`CREATE TRIGGER reject_observation BEFORE INSERT ON workspace_measurements BEGIN SELECT RAISE(ABORT,'injected failure'); END;`); err != nil {
		t.Fatal(err)
	}
	msg.SampleID = "fail"
	if _, err := s.InsertSample(ctx, msg, at.Add(time.Hour)); err == nil {
		t.Fatal("failed inventory committed")
	}
	r := sample()
	r.Sequence++
	if _, err := s.Insert(ctx, r, at.Add(time.Hour)); err == nil {
		t.Fatal("failed HTTP inventory committed")
	}
	if !reflect.DeepEqual(before, catalog(t, s)) {
		t.Fatal("partial inventory write")
	}
	samples, err := s.RecentSamples(ctx, 100)
	if err != nil || len(samples) != 2 {
		t.Fatal(samples, err)
	}
}
func TestWorkspaceLayoutValidationAndConflict(t *testing.T) {
	s := openTest(t)
	ctx := context.Background()
	if _, err := s.Insert(ctx, sample(), time.Now()); err != nil {
		t.Fatal(err)
	}
	c := catalog(t, s)
	d, sen := c.Devices[0].ID, c.Sensors[0].ID
	deviceItem := workspace.Item{Kind: "device", DeviceID: d}
	sensorItem := workspace.Item{Kind: "sensor", SensorID: sen}
	metricItem := workspace.Item{Kind: "measurement", SensorID: sen, Metric: "temperature", Unit: "degC"}
	layout := workspace.Layout{Sections: []workspace.Section{{Title: "North", Items: []workspace.Item{deviceItem, sensorItem, metricItem}}}}
	if err := s.SaveLayout(ctx, layout); !errors.Is(err, workspace.ErrUnregistered) {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		id       int64
		settings workspace.Settings
		want     error
	}{{-1, workspace.Settings{Name: "x"}, workspace.ErrInvalid}, {d, workspace.Settings{}, workspace.ErrInvalid}, {999, workspace.Settings{Name: "x"}, workspace.ErrNotFound}} {
		if err := s.SaveDevice(ctx, tc.id, tc.settings); !errors.Is(err, tc.want) {
			t.Fatal(err)
		}
	}
	if err := s.SaveDevice(ctx, d, workspace.Settings{Name: "Device"}); err != nil {
		t.Fatal(err)
	}
	// Once its device was added, a sensor goes on the dashboard without a name of its own.
	if err := s.SaveLayout(ctx, layout); err != nil {
		t.Fatal(err)
	}
	layout.Revision = 1
	if err := s.SaveSensor(ctx, sen, workspace.SensorSettings{Settings: workspace.Settings{Name: "Sensor"}}); err != nil {
		t.Fatal(err)
	}
	for _, bad := range []workspace.Item{{Kind: "device", DeviceID: 999}, {Kind: "sensor", SensorID: 999}, {Kind: "measurement", SensorID: sen, Metric: "missing", Unit: "degC"}} {
		if err := s.SaveLayout(ctx, workspace.Layout{Revision: 1, Sections: []workspace.Section{{Title: "Bad", Items: []workspace.Item{bad}}}}); !errors.Is(err, workspace.ErrNotFound) {
			t.Fatal(err)
		}
	}
	if err := s.SaveLayout(ctx, layout); err != nil {
		t.Fatal(err)
	}
	if err := s.SaveLayout(ctx, layout); !errors.Is(err, workspace.ErrConflict) {
		t.Fatal(err)
	}
	c = catalog(t, s)
	if c.Layout.Revision != 2 || !reflect.DeepEqual(c.Layout.Sections, layout.Sections) {
		t.Fatal(c.Layout)
	}
	if err := s.SaveLayout(ctx, workspace.Layout{Revision: 2, Sections: []workspace.Section{}}); err != nil {
		t.Fatal(err)
	}
	c = catalog(t, s)
	if c.Layout.Sections == nil || c.Devices[0].Name == "" || len(c.Sensors) != 1 {
		t.Fatal("removing dashboard items changed registration")
	}
	if err := s.SaveLayout(ctx, workspace.Layout{Revision: 3}); err != nil {
		t.Fatal(err)
	}
	if catalog(t, s).Layout.Sections != nil {
		t.Fatal("automatic layout not restored")
	}
	if err := s.SaveLayout(ctx, workspace.Layout{Revision: -1}); !errors.Is(err, workspace.ErrInvalid) {
		t.Fatal(err)
	}
}
func TestWorkspaceDiagnosticsAndFailure(t *testing.T) {
	s := openTest(t)
	ctx := context.Background()
	r := sample()
	r.SensorID = "radio"
	r.Metric = "rssi"
	r.Unit = "dBm"
	if _, err := s.Insert(ctx, r, time.Now()); err != nil {
		t.Fatal(err)
	}
	c := catalog(t, s)
	d, sen := c.Devices[0].ID, c.Sensors[0].ID
	if err := s.SaveDevice(ctx, d, workspace.Settings{Name: "D"}); err != nil {
		t.Fatal(err)
	}
	if err := s.SaveSensor(ctx, sen, workspace.SensorSettings{Settings: workspace.Settings{Name: "Radio"}}); !errors.Is(err, workspace.ErrInvalid) {
		t.Fatal(err)
	}
	if err := s.SaveLayout(ctx, workspace.Layout{Sections: []workspace.Section{{Title: "X", Items: []workspace.Item{{Kind: "measurement", SensorID: sen, Metric: "rssi", Unit: "dBm"}}}}}); !errors.Is(err, workspace.ErrInvalid) {
		t.Fatal(err)
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Catalog(ctx); err == nil {
		t.Fatal("closed database read")
	}
	if err := s.SaveDevice(ctx, d, workspace.Settings{Name: "X"}); err == nil {
		t.Fatal("closed database write")
	}
	if err := s.SaveLayout(ctx, workspace.Layout{}); err == nil {
		t.Fatal("closed database write")
	}
}
func TestWorkspaceMigrationBackfillsAllHistory(t *testing.T) {
	path := filepath.Join(t.TempDir(), "old.db")
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	at := time.Now().UTC()
	if _, err = s.Insert(ctx, sample(), at); err != nil {
		t.Fatal(err)
	}
	msg := sampleFixture(t)
	if _, err = s.InsertSample(ctx, msg, at); err != nil {
		t.Fatal(err)
	}
	before := catalog(t, s)
	if _, err = s.db.Exec(`DROP TABLE measurement_history; DROP TABLE workspace_measurements; DROP TABLE workspace_sensors; DROP TABLE workspace_devices; DROP TABLE workspace_layout; DROP TABLE device_states; DROP TABLE device_availability; DROP TABLE device_commands; PRAGMA user_version=2;`); err != nil {
		t.Fatal(err)
	}
	s.Close()
	s, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if !reflect.DeepEqual(before, catalog(t, s)) {
		t.Fatal("migration changed discovered identity, values or receipt time")
	}
}

func TestWorkspaceMigrationFailureRollsBack(t *testing.T) {
	s := openTest(t)
	if _, err := s.Insert(context.Background(), sample(), time.Now()); err != nil {
		t.Fatal(err)
	}
	if _, err := s.db.Exec(`DROP TABLE measurement_history; DROP TABLE workspace_measurements; DROP TABLE workspace_sensors; DROP TABLE workspace_devices; DROP TABLE workspace_layout; DROP TABLE device_states; DROP TABLE device_availability; DROP TABLE device_commands; UPDATE readings SET payload='broken'; PRAGMA user_version=2;`); err != nil {
		t.Fatal(err)
	}
	// The failure must come from the backfill itself, after every schema step ran.
	if err := s.migrate(); err == nil || !strings.Contains(err.Error(), "invalid character") {
		t.Fatal("corrupt telemetry migrated", err)
	}
	var version, count int
	if err := s.db.QueryRow(`PRAGMA user_version`).Scan(&version); err != nil || version != 2 {
		t.Fatal(version, err)
	}
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE name='workspace_devices'`).Scan(&count); err != nil || count != 0 {
		t.Fatal("partial migration", count, err)
	}
}

func TestArchiveDeviceHidesItUntilItReportsAgain(t *testing.T) {
	ctx := context.Background()
	s := openTest(t)
	at := time.Now().UTC()
	r := sample()
	if _, err := s.Insert(ctx, r, at); err != nil {
		t.Fatal(err)
	}
	d := catalog(t, s).Devices[0]
	if err := s.SaveDevice(ctx, d.ID, workspace.Settings{Name: "North"}); err != nil {
		t.Fatal(err)
	}
	if err := s.ArchiveDevice(ctx, d.ID, 0); !errors.Is(err, workspace.ErrConflict) {
		t.Fatal(err)
	}
	if err := s.ArchiveDevice(ctx, 0, 1); !errors.Is(err, workspace.ErrInvalid) {
		t.Fatal(err)
	}
	if err := s.ArchiveDevice(ctx, d.ID+100, 1); !errors.Is(err, workspace.ErrNotFound) {
		t.Fatal(err)
	}
	if err := s.ArchiveDevice(ctx, d.ID, 1); err != nil {
		t.Fatal(err)
	}
	if c := catalog(t, s); len(c.Devices) != 0 || len(c.Sensors) != 0 {
		t.Fatal("archived device still listed", c)
	}
	if err := s.ArchiveDevice(ctx, d.ID, 2); !errors.Is(err, workspace.ErrNotFound) {
		t.Fatal(err)
	}
	if recent, err := s.Recent(ctx, 10); err != nil || len(recent) != 1 {
		t.Fatal("telemetry lost", recent, err)
	}
	r.Sequence++
	if _, err := s.Insert(ctx, r, at.Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	c := catalog(t, s)
	if len(c.Devices) != 1 || c.Devices[0].Name != "North" || len(c.Sensors) != 1 || len(c.Sensors[0].Measurements) != 1 {
		t.Fatal("device did not return with its name", c)
	}
}
func TestArchiveMigrationKeepsDevices(t *testing.T) {
	ctx := context.Background()
	s := openTest(t)
	if _, err := s.Insert(ctx, sample(), time.Now().UTC()); err != nil {
		t.Fatal(err)
	}
	if _, err := s.db.Exec(dropSensorTypes + `DROP TABLE measurement_history; ALTER TABLE workspace_devices DROP COLUMN archived; ALTER TABLE workspace_sensors DROP COLUMN archived; ALTER TABLE device_states DROP COLUMN archived; PRAGMA user_version=5;`); err != nil {
		t.Fatal(err)
	}
	if err := s.migrate(); err != nil {
		t.Fatal(err)
	}
	var version int
	if err := s.db.QueryRow(`PRAGMA user_version`).Scan(&version); err != nil || version != 10 {
		t.Fatal(version, err)
	}
	if c := catalog(t, s); len(c.Devices) != 1 {
		t.Fatal("device lost in migration", c)
	}
}

func TestArchiveSensorKeepsHistoryAndRestoresOnFreshReading(t *testing.T) {
	ctx := context.Background()
	s := openTest(t)
	at := time.Now().UTC()
	r := sample()
	if _, err := s.Insert(ctx, r, at); err != nil {
		t.Fatal(err)
	}
	if err := s.SaveDevice(ctx, catalog(t, s).Devices[0].ID, workspace.Settings{Name: "Node"}); err != nil {
		t.Fatal(err)
	}
	item := catalog(t, s).Sensors[0]
	if err := s.SaveSensor(ctx, item.ID, workspace.SensorSettings{Settings: workspace.Settings{Name: "Orchard"}}); err != nil {
		t.Fatal(err)
	}
	if err := s.ArchiveSensor(ctx, item.ID, 0); !errors.Is(err, workspace.ErrConflict) {
		t.Fatal(err)
	}
	if err := s.ArchiveSensor(ctx, item.ID, 1); err != nil {
		t.Fatal(err)
	}
	if c := catalog(t, s); len(c.Sensors) != 0 || len(c.Devices) != 1 {
		t.Fatal(c)
	}
	if _, err := s.Insert(ctx, r, at.Add(time.Second)); err != nil {
		t.Fatal(err)
	}
	if len(catalog(t, s).Sensors) != 0 {
		t.Fatal("duplicate restored sensor")
	}
	if rows, err := s.Recent(ctx, 10); err != nil || len(rows) != 1 {
		t.Fatal("history lost", err)
	}
	r.Sequence++
	if _, err := s.Insert(ctx, r, at.Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	if c := catalog(t, s); len(c.Sensors) != 1 || c.Sensors[0].Name != "Orchard" {
		t.Fatal(c)
	}
}

func TestSensorTypeKeepsRawReadingsAndCalibration(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "db")
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	at := time.Now().UTC()
	probe := telemetry.Reading{NodeID: "node", SensorID: "probe", SessionID: "boot", Sequence: 1, Metric: "voltage", Value: 2.69, Unit: "V"}
	battery := probe
	battery.SensorID, battery.Value = "battery", 3.9
	for _, r := range []telemetry.Reading{probe, battery, sample()} {
		if _, err = s.Insert(ctx, r, at); err != nil {
			t.Fatal(err)
		}
	}
	c := catalog(t, s)
	if err = s.SaveDevice(ctx, c.Devices[0].ID, workspace.Settings{Name: "Garden"}); err != nil {
		t.Fatal(err)
	}
	ids := map[string]int64{}
	for _, item := range c.Sensors {
		ids[item.Sensor] = item.ID
	}
	dry, wet := 2.69, 1.04
	soil := func(revision int64, zero, full *float64) workspace.SensorSettings {
		return workspace.SensorSettings{Settings: workspace.Settings{Revision: revision}, Type: workspace.SoilMoisture, Calibration: workspace.Calibration{Zero: zero, Full: full}}
	}
	// A type needs the measurement it reads, and the battery is a device diagnostic.
	for _, sensor := range []string{"sensor", "battery"} {
		if err = s.SaveSensor(ctx, ids[sensor], soil(0, nil, nil)); !errors.Is(err, workspace.ErrInvalid) {
			t.Fatal(sensor, err)
		}
	}
	// Each point is marked on its own, so one may exist before the other.
	if err = s.SaveSensor(ctx, ids["probe"], soil(0, &dry, nil)); err != nil {
		t.Fatal(err)
	}
	if err = s.SaveSensor(ctx, ids["probe"], soil(1, &dry, &dry)); !errors.Is(err, workspace.ErrInvalid) {
		t.Fatal(err)
	}
	if err = s.SaveSensor(ctx, ids["probe"], soil(1, &dry, &wet)); err != nil {
		t.Fatal(err)
	}
	probe.Sequence, probe.Value = 2, 1.5
	if _, err = s.Insert(ctx, probe, at.Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	if err = s.Close(); err != nil {
		t.Fatal(err)
	}
	if s, err = Open(path); err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	find := func() workspace.Sensor {
		t.Helper()
		for _, item := range catalog(t, s).Sensors {
			if item.Sensor == "probe" {
				return item
			}
		}
		t.Fatal("probe not listed")
		return workspace.Sensor{}
	}
	item := find()
	if item.Type != workspace.SoilMoisture || item.Calibration.Zero == nil || *item.Calibration.Zero != dry || item.Calibration.Full == nil || *item.Calibration.Full != wet || item.Revision != 2 {
		t.Fatalf("type or calibration lost: %#v", item)
	}
	// The stored reading stays what the device sent.
	if m := item.Measurements; len(m) != 1 || m[0].Metric != "voltage" || m[0].Unit != "V" || *m[0].Value != 1.5 {
		t.Fatalf("raw reading changed: %#v", m)
	}
	if h, e := s.History(ctx, history.Query{SensorID: item.ID, Metric: "voltage", Unit: "V", From: at.Add(-time.Hour), To: at.Add(time.Hour)}, true); e != nil || len(h.Points) != 2 || *h.Points[0].Value != 2.69 {
		t.Fatal("raw history changed", h, e)
	}
	// The database guards the structure even against a write that skips validation.
	for _, statement := range []string{
		`UPDATE workspace_sensors SET calibration_full=calibration_zero WHERE id=?`,
		`UPDATE workspace_sensors SET type='' WHERE id=?`,
	} {
		if _, err = s.db.Exec(statement, item.ID); err == nil {
			t.Fatal("constraint missing for", statement)
		}
	}
	// Returning to generic discards the calibration.
	if err = s.SaveSensor(ctx, item.ID, workspace.SensorSettings{Settings: workspace.Settings{Name: "Bed 1", Revision: 2}}); err != nil {
		t.Fatal(err)
	}
	if item = find(); item.Type != "" || item.Calibration.Zero != nil || item.Calibration.Full != nil || item.Name != "Bed 1" {
		t.Fatalf("generic sensor kept a calibration: %#v", item)
	}
}

func TestSensorTypeMigrationKeepsSensorsGeneric(t *testing.T) {
	ctx := context.Background()
	s := openTest(t)
	if _, err := s.Insert(ctx, sample(), time.Now().UTC()); err != nil {
		t.Fatal(err)
	}
	if err := s.SaveDevice(ctx, catalog(t, s).Devices[0].ID, workspace.Settings{Name: "Node"}); err != nil {
		t.Fatal(err)
	}
	if err := s.SaveSensor(ctx, catalog(t, s).Sensors[0].ID, workspace.SensorSettings{Settings: workspace.Settings{Name: "Orchard"}}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.db.Exec(dropSensorTypes + `PRAGMA user_version=9;`); err != nil {
		t.Fatal(err)
	}
	if err := s.migrate(); err != nil {
		t.Fatal(err)
	}
	var version int
	if err := s.db.QueryRow(`PRAGMA user_version`).Scan(&version); err != nil || version != 10 {
		t.Fatal(version, err)
	}
	item := catalog(t, s).Sensors[0]
	if item.Name != "Orchard" || item.Revision != 1 || item.Type != "" || item.Calibration.Zero != nil || item.Calibration.Full != nil || len(item.Measurements) != 1 {
		t.Fatalf("sensor changed in migration: %#v", item)
	}
}
