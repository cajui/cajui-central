package storage

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	"github.com/cajui/cajui-central/internal/history"
	"github.com/cajui/cajui-central/internal/telemetry"
)

const historySchema = `CREATE TABLE measurement_history (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 sensor_id INTEGER NOT NULL REFERENCES workspace_sensors(id),
 metric TEXT NOT NULL, unit TEXT NOT NULL, received_ms INTEGER NOT NULL,
 received_at TEXT NOT NULL, value REAL, status TEXT NOT NULL, interval INTEGER NOT NULL);
 CREATE INDEX history_channel_time ON measurement_history(sensor_id,metric,unit,received_ms,id);
 PRAGMA user_version=8;`

func recordHistory(ctx context.Context, tx *sql.Tx, transport, source, device string, readings []telemetry.Measurement, at time.Time, interval int) error {
	for _, r := range readings {
		result, err := tx.ExecContext(ctx, `INSERT INTO measurement_history(sensor_id,metric,unit,received_ms,received_at,value,status,interval)
 SELECT s.id,?,?,?,?,?,?,? FROM workspace_sensors s JOIN workspace_devices d ON d.id=s.device_id
 WHERE d.transport=? AND d.source=? AND d.device=? AND s.sensor=?`, r.Metric, r.Unit, at.UnixMilli(), at.UTC().Format(time.RFC3339Nano), r.Value, r.Status, interval, transport, source, device, r.SensorID)
		if err != nil {
			return err
		}
		n, err := result.RowsAffected()
		if err != nil {
			return err
		}
		if n != 1 {
			return fmt.Errorf("history sensor identity missing")
		}
	}
	return nil
}

func backfillHistory(tx *sql.Tx) error {
	for _, table := range []string{"readings", "samples"} {
		query := `SELECT payload,'' FROM readings ORDER BY id`
		if table == "samples" {
			query = `SELECT payload,received_at FROM samples ORDER BY id`
		}
		rows, err := tx.Query(query)
		if err != nil {
			return err
		}
		for rows.Next() {
			var payload, stamp string
			if err = rows.Scan(&payload, &stamp); err == nil {
				if table == "readings" {
					var r telemetry.Reading
					if err = json.Unmarshal([]byte(payload), &r); err == nil {
						err = recordHistory(context.Background(), tx, "http", "HTTP", r.NodeID, []telemetry.Measurement{{SensorID: r.SensorID, Metric: r.Metric, Unit: r.Unit, Value: &r.Value, Status: "ok"}}, r.ReceivedAt, 0)
					}
				} else {
					var sample telemetry.Sample
					var at time.Time
					if err = json.Unmarshal([]byte(payload), &sample); err == nil {
						at, err = time.Parse(time.RFC3339Nano, stamp)
					}
					if err == nil {
						err = recordHistory(context.Background(), tx, "mqtt", sample.SourceID, sample.DeviceID, sample.Readings, at, sample.ExpectedIntervalSeconds)
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
	tx, err := s.db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
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
		summary := history.NewSummary(q.From, q.To)
		for rows.Next() {
			var p history.Point
			if e = rows.Scan(&p.ID, &p.Time, &p.ReceivedAt, &p.Value, &p.Status, &p.Interval); e != nil {
				rows.Close()
				return result, e
			}
			summary.Add(p)
			result.Count++
		}
		e = rows.Err()
		rows.Close()
		if e != nil {
			return result, e
		}
		result.Points, result.Sampled = summary.Points()
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
