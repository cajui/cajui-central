package storage

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/url"
	"time"

	"github.com/cajui/cajui-central/internal/history"
	"github.com/cajui/cajui-central/internal/telemetry"
)

const historySchema = `CREATE TABLE measurement_history (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 sensor_id INTEGER NOT NULL REFERENCES workspace_sensors(id),
 reading_id INTEGER REFERENCES readings(id), sample_id INTEGER REFERENCES samples(id),
 metric TEXT NOT NULL, unit TEXT NOT NULL, received_ms INTEGER NOT NULL,
 received_at TEXT NOT NULL, value REAL, status TEXT NOT NULL, interval INTEGER NOT NULL CHECK(interval>=0),
 CHECK((reading_id IS NULL) != (sample_id IS NULL)),
 CHECK(status IN ('ok','error','skipped')),
 CHECK((status='ok' AND value IS NOT NULL AND typeof(value) IN ('integer','real') AND abs(value)<=1.7976931348623157e308) OR (status!='ok' AND value IS NULL)),
 UNIQUE(reading_id), UNIQUE(sample_id,sensor_id,metric));
 CREATE INDEX history_channel_time ON measurement_history(sensor_id,metric,unit,received_ms,id);
 PRAGMA user_version=9;`

type historyOrigin struct{ ReadingID, SampleID int64 }

func (s *Store) openHistory(path string) error {
	if path == ":memory:" {
		s.historyDB = s.db
		return nil
	}
	u, err := url.Parse(path)
	if err != nil {
		return err
	}
	q := u.Query()
	if q.Get("mode") == "memory" || u.Opaque == ":memory:" || u.Path == ":memory:" {
		s.historyDB = s.db
		return nil
	}
	q.Set("mode", "ro")
	q.Del("_pragma")
	q.Add("_pragma", "query_only(1)")
	q.Add("_pragma", "busy_timeout(5000)")
	u.RawQuery = q.Encode()
	db, err := sql.Open("sqlite", u.String())
	if err != nil {
		return err
	}
	db.SetMaxOpenConns(2)
	db.SetMaxIdleConns(2)
	if err = db.Ping(); err != nil {
		_ = db.Close()
		return err
	}
	s.historyDB = db
	return nil
}

func insertHistory(ctx context.Context, tx *sql.Tx, sensorID int64, origin historyOrigin, r telemetry.Measurement, at time.Time, interval int) error {
	var readingID, sampleID any
	if origin.ReadingID != 0 {
		readingID = origin.ReadingID
	}
	if origin.SampleID != 0 {
		sampleID = origin.SampleID
	}
	_, err := tx.ExecContext(ctx, `INSERT INTO measurement_history(sensor_id,reading_id,sample_id,metric,unit,received_ms,received_at,value,status,interval) VALUES(?,?,?,?,?,?,?,?,?,?)`, sensorID, readingID, sampleID, r.Metric, r.Unit, at.UnixMilli(), at.UTC().Format(time.RFC3339Nano), r.Value, r.Status, interval)
	return err
}

func backfillHistory(tx *sql.Tx) error {
	lookup, err := tx.Prepare(`SELECT s.id FROM workspace_sensors s JOIN workspace_devices d ON d.id=s.device_id WHERE d.transport=? AND d.source=? AND d.device=? AND s.sensor=?`)
	if err != nil {
		return err
	}
	defer lookup.Close()
	return walkTelemetry(tx, func(transport, source, device string, readings []telemetry.Measurement, at time.Time, interval int, origin historyOrigin) error {
		for _, r := range readings {
			var sensorID int64
			if err := lookup.QueryRow(transport, source, device, r.SensorID).Scan(&sensorID); err != nil {
				return fmt.Errorf("history sensor identity: %w", err)
			}
			if err := insertHistory(context.Background(), tx, sensorID, origin, r, at, interval); err != nil {
				return err
			}
		}
		return nil
	})
}

func walkTelemetry(tx *sql.Tx, visit func(string, string, string, []telemetry.Measurement, time.Time, int, historyOrigin) error) error {
	for _, table := range []string{"readings", "samples"} {
		query := `SELECT id,payload,'' FROM readings ORDER BY id`
		if table == "samples" {
			query = `SELECT id,payload,received_at FROM samples ORDER BY id`
		}
		rows, err := tx.Query(query)
		if err != nil {
			return err
		}
		for rows.Next() {
			var id int64
			var payload, stamp string
			if err = rows.Scan(&id, &payload, &stamp); err == nil {
				if table == "readings" {
					var r telemetry.Reading
					if err = json.Unmarshal([]byte(payload), &r); err == nil {
						err = visit("http", "HTTP", r.NodeID, []telemetry.Measurement{{SensorID: r.SensorID, Metric: r.Metric, Unit: r.Unit, Value: &r.Value, Status: "ok"}}, r.ReceivedAt, 0, historyOrigin{ReadingID: id})
					}
				} else {
					var sample telemetry.Sample
					var at time.Time
					if err = json.Unmarshal([]byte(payload), &sample); err == nil {
						at, err = time.Parse(time.RFC3339Nano, stamp)
					}
					if err == nil {
						err = visit("mqtt", sample.SourceID, sample.DeviceID, sample.Readings, at, sample.ExpectedIntervalSeconds, historyOrigin{SampleID: id})
					}
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

func (s *Store) History(ctx context.Context, q history.Query, chart bool) (history.Result, error) {
	result := history.Result{Points: []history.Point{}, Rows: []history.Point{}}
	if err := q.Validate(); err != nil {
		return result, err
	}
	tx, err := s.historyDB.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return result, err
	}
	defer tx.Rollback()
	if q.Anchor == 0 {
		if err = tx.QueryRowContext(ctx, `SELECT COALESCE(MAX(id),0) FROM measurement_history`).Scan(&q.Anchor); err != nil {
			return result, err
		}
	}
	result.Anchor = q.Anchor
	where := ` WHERE sensor_id=? AND metric=? AND unit=? AND received_ms>=? AND received_ms<? AND id<=?`
	args := []any{q.SensorID, q.Metric, q.Unit, q.From.UnixMilli(), q.To.UnixMilli(), q.Anchor}
	columns := `SELECT id,received_ms,received_at,value,status,interval FROM measurement_history`
	if chart {
		rows, e := tx.QueryContext(ctx, columns+where+` ORDER BY received_ms,id`, args...)
		if e != nil {
			return result, e
		}
		count := 0
		summary := history.NewSummary(q.From, q.To)
		for rows.Next() {
			var p history.Point
			if e = rows.Scan(&p.ID, &p.Time, &p.ReceivedAt, &p.Value, &p.Status, &p.Interval); e != nil {
				rows.Close()
				return result, e
			}
			summary.Add(p)
			count++
		}
		e = rows.Err()
		rows.Close()
		if e != nil {
			return result, e
		}
		points, sampled := summary.Points()
		result.Points, result.Count, result.Sampled = points, &count, &sampled
	}
	if q.BeforeID > 0 {
		where += ` AND (received_ms,id)<(?,?)`
		args = append(args, q.BeforeTime, q.BeforeID)
	}
	rows, err := tx.QueryContext(ctx, columns+where+` ORDER BY received_ms DESC,id DESC LIMIT ?`, append(args, history.PageSize+1)...)
	if err != nil {
		return result, err
	}
	for rows.Next() {
		var p history.Point
		if err = rows.Scan(&p.ID, &p.Time, &p.ReceivedAt, &p.Value, &p.Status, &p.Interval); err != nil {
			rows.Close()
			return result, err
		}
		result.Rows = append(result.Rows, p)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return result, err
	}
	if len(result.Rows) > history.PageSize {
		result.Rows = result.Rows[:history.PageSize]
		last := result.Rows[len(result.Rows)-1]
		result.Next = fmt.Sprintf("%d:%d", last.Time, last.ID)
	}
	return result, tx.Commit()
}
