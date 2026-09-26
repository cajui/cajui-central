package storage

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"time"

	"github.com/cajui/cajui-central/internal/telemetry"
	"github.com/cajui/cajui-central/internal/workspace"
)

const workspaceSchema = `
CREATE TABLE workspace_devices (
 id INTEGER PRIMARY KEY, transport TEXT NOT NULL, source TEXT NOT NULL, device TEXT NOT NULL,
 name TEXT NOT NULL DEFAULT '', location TEXT NOT NULL DEFAULT '', revision INTEGER NOT NULL DEFAULT 0,
 received_at TEXT NOT NULL, interval INTEGER NOT NULL,
 UNIQUE(transport,source,device));
CREATE TABLE workspace_sensors (
 id INTEGER PRIMARY KEY, device_id INTEGER NOT NULL REFERENCES workspace_devices(id), sensor TEXT NOT NULL,
 name TEXT NOT NULL DEFAULT '', location TEXT NOT NULL DEFAULT '', revision INTEGER NOT NULL DEFAULT 0,
 UNIQUE(device_id,sensor));
CREATE TABLE workspace_measurements (
 sensor_id INTEGER NOT NULL REFERENCES workspace_sensors(id), metric TEXT NOT NULL, unit TEXT NOT NULL,
 value REAL, status TEXT NOT NULL, received_at TEXT NOT NULL, interval INTEGER NOT NULL,
 PRIMARY KEY(sensor_id,metric,unit));
CREATE TABLE workspace_layout (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, sections TEXT NOT NULL);
INSERT INTO workspace_layout VALUES(1,0,'null');
PRAGMA user_version=3;`

// Observation and telemetry share a transaction, so retries cannot refresh inventory.
func observe(ctx context.Context, tx *sql.Tx, transport, source, device string, readings []telemetry.Measurement, at time.Time, interval int) error {
	stamp := at.UTC().Format(time.RFC3339Nano)
	var deviceID int64
	err := tx.QueryRowContext(ctx, `INSERT INTO workspace_devices(transport,source,device,received_at,interval) VALUES(?,?,?,?,?)
 ON CONFLICT(transport,source,device) DO UPDATE SET received_at=excluded.received_at,interval=excluded.interval RETURNING id`, transport, source, device, stamp, interval).Scan(&deviceID)
	if err != nil {
		return err
	}
	for _, r := range readings {
		var sensorID int64
		err = tx.QueryRowContext(ctx, `INSERT INTO workspace_sensors(device_id,sensor) VALUES(?,?) ON CONFLICT(device_id,sensor) DO UPDATE SET sensor=excluded.sensor RETURNING id`, deviceID, r.SensorID).Scan(&sensorID)
		if err != nil {
			return err
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO workspace_measurements(sensor_id,metric,unit,value,status,received_at,interval) VALUES(?,?,?,?,?,?,?)
 ON CONFLICT(sensor_id,metric,unit) DO UPDATE SET value=excluded.value,status=excluded.status,received_at=excluded.received_at,interval=excluded.interval`, sensorID, r.Metric, r.Unit, r.Value, r.Status, stamp, interval)
		if err != nil {
			return err
		}
	}
	return nil
}
func observeReading(ctx context.Context, tx *sql.Tx, r telemetry.Reading) error {
	return observe(ctx, tx, "http", "HTTP", r.NodeID, []telemetry.Measurement{{SensorID: r.SensorID, Metric: r.Metric, Unit: r.Unit, Value: &r.Value, Status: "ok"}}, r.ReceivedAt, 0)
}

// Backfill scans stored telemetry once, in receipt order and without loading all
// history into memory. No names are guessed and existing telemetry is untouched.
func backfillWorkspace(tx *sql.Tx) error {
	ctx := context.Background()
	for _, table := range []string{"readings", "samples"} {
		query := `SELECT payload FROM readings ORDER BY id`
		if table == "samples" {
			query = `SELECT payload,received_at FROM samples ORDER BY id`
		}
		rows, err := tx.Query(query)
		if err != nil {
			return err
		}
		for rows.Next() {
			var payload, stamp string
			if table == "readings" {
				err = rows.Scan(&payload)
				var r telemetry.Reading
				if err == nil {
					err = json.Unmarshal([]byte(payload), &r)
				}
				if err == nil {
					err = observeReading(ctx, tx, r)
				}
			} else {
				err = rows.Scan(&payload, &stamp)
				var s telemetry.Sample
				var at time.Time
				if err == nil {
					err = json.Unmarshal([]byte(payload), &s)
				}
				if err == nil {
					at, err = time.Parse(time.RFC3339Nano, stamp)
				}
				if err == nil {
					err = observe(ctx, tx, "mqtt", s.SourceID, s.DeviceID, s.Readings, at, s.ExpectedIntervalSeconds)
				}
			}
			if err != nil {
				rows.Close()
				return err
			}
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return err
		}
	}
	return nil
}
func (s *Store) Catalog(ctx context.Context) (workspace.Catalog, error) {
	c := workspace.Catalog{Devices: []workspace.Device{}, Sensors: []workspace.Sensor{}}
	tx, err := s.db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return c, err
	}
	defer tx.Rollback()
	rows, err := tx.QueryContext(ctx, `SELECT id,transport,source,device,name,location,revision,received_at,interval FROM workspace_devices ORDER BY id`)
	if err != nil {
		return c, err
	}
	for rows.Next() {
		var d workspace.Device
		if err = rows.Scan(&d.ID, &d.Transport, &d.Source, &d.Device, &d.Name, &d.Location, &d.Revision, &d.ReceivedAt, &d.Interval); err != nil {
			rows.Close()
			return c, err
		}
		c.Devices = append(c.Devices, d)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return c, err
	}
	rows, err = tx.QueryContext(ctx, `SELECT id,device_id,sensor,name,location,revision FROM workspace_sensors ORDER BY id`)
	if err != nil {
		return c, err
	}
	indexes := map[int64]int{}
	for rows.Next() {
		var item workspace.Sensor
		if err = rows.Scan(&item.ID, &item.DeviceID, &item.Sensor, &item.Name, &item.Location, &item.Revision); err != nil {
			rows.Close()
			return c, err
		}
		item.Measurements = []workspace.Measurement{}
		indexes[item.ID] = len(c.Sensors)
		c.Sensors = append(c.Sensors, item)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return c, err
	}
	rows, err = tx.QueryContext(ctx, `SELECT sensor_id,metric,unit,value,status,received_at,interval FROM workspace_measurements ORDER BY sensor_id,metric,unit`)
	if err != nil {
		return c, err
	}
	for rows.Next() {
		var id int64
		var m workspace.Measurement
		if err = rows.Scan(&id, &m.Metric, &m.Unit, &m.Value, &m.Status, &m.ReceivedAt, &m.Interval); err != nil {
			rows.Close()
			return c, err
		}
		i := indexes[id]
		c.Sensors[i].Measurements = append(c.Sensors[i].Measurements, m)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return c, err
	}
	var sections string
	err = tx.QueryRowContext(ctx, `SELECT revision,sections FROM workspace_layout WHERE id=1`).Scan(&c.Layout.Revision, &sections)
	if err != nil {
		return c, err
	}
	if err = json.Unmarshal([]byte(sections), &c.Layout.Sections); err != nil {
		return c, err
	}
	return c, tx.Commit()
}
func (s *Store) SaveDevice(ctx context.Context, id int64, settings workspace.Settings) error {
	return s.saveSettings(ctx, "workspace_devices", id, settings)
}
func (s *Store) SaveSensor(ctx context.Context, id int64, settings workspace.Settings) error {
	return s.saveSettings(ctx, "workspace_sensors", id, settings)
}
func (s *Store) saveSettings(ctx context.Context, table string, id int64, settings workspace.Settings) error {
	if id <= 0 {
		return workspace.ErrInvalid
	}
	if err := settings.Validate(); err != nil {
		return err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var revision int64
	// table is a private constant selected by the two typed entry points above.
	err = tx.QueryRowContext(ctx, `SELECT revision FROM `+table+` WHERE id=?`, id).Scan(&revision)
	if errors.Is(err, sql.ErrNoRows) {
		return workspace.ErrNotFound
	}
	if err != nil {
		return err
	}
	if revision != settings.Revision {
		return workspace.ErrConflict
	}
	if table == "workspace_sensors" {
		var name, sensor string
		if err = tx.QueryRowContext(ctx, `SELECT d.name,s.sensor FROM workspace_sensors s JOIN workspace_devices d ON d.id=s.device_id WHERE s.id=?`, id).Scan(&name, &sensor); err != nil {
			return err
		}
		if name == "" {
			return workspace.ErrUnregistered
		}
		var count int
		err = tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM workspace_measurements WHERE sensor_id=? AND NOT (?='radio' AND ((metric='rssi' AND unit='dBm') OR (metric='snr' AND unit='dB')))`, id, sensor).Scan(&count)
		if err != nil {
			return err
		}
		if count == 0 {
			return workspace.ErrInvalid
		}
	}
	_, err = tx.ExecContext(ctx, `UPDATE `+table+` SET name=?,location=?,revision=revision+1 WHERE id=?`, settings.Name, settings.Location, id)
	if err != nil {
		return err
	}
	return tx.Commit()
}
func (s *Store) SaveLayout(ctx context.Context, layout workspace.Layout) error {
	if err := layout.Validate(); err != nil {
		return err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var revision int64
	if err = tx.QueryRowContext(ctx, `SELECT revision FROM workspace_layout WHERE id=1`).Scan(&revision); err != nil {
		return err
	}
	if revision != layout.Revision {
		return workspace.ErrConflict
	}
	for _, section := range layout.Sections {
		for _, item := range section.Items {
			var name string
			if item.Kind == "device" {
				err = tx.QueryRowContext(ctx, `SELECT name FROM workspace_devices WHERE id=?`, item.DeviceID).Scan(&name)
			} else {
				var sensor string
				err = tx.QueryRowContext(ctx, `SELECT name,sensor FROM workspace_sensors WHERE id=?`, item.SensorID).Scan(&name, &sensor)
				if err == nil && item.Kind == "measurement" {
					if workspace.IsDiagnostic(sensor, item.Metric, item.Unit) {
						return workspace.ErrInvalid
					}
					var exists int
					err = tx.QueryRowContext(ctx, `SELECT 1 FROM workspace_measurements WHERE sensor_id=? AND metric=? AND unit=?`, item.SensorID, item.Metric, item.Unit).Scan(&exists)
				}
			}
			if errors.Is(err, sql.ErrNoRows) {
				return workspace.ErrNotFound
			}
			if err != nil {
				return err
			}
			if name == "" {
				return workspace.ErrUnregistered
			}
		}
	}
	data, err := json.Marshal(layout.Sections)
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `UPDATE workspace_layout SET sections=?,revision=revision+1 WHERE id=1`, string(data))
	if err != nil {
		return err
	}
	return tx.Commit()
}
