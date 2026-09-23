package storage

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/cajui/cajui-central/internal/telemetry"
)

// InsertSample commits the complete sample atomically. Retries never refresh its receipt time.
func (s *Store) InsertSample(ctx context.Context, sample telemetry.Sample, at time.Time) (bool, error) {
	payload, err := sample.CanonicalJSON()
	if err != nil {
		return false, err
	}
	result, err := s.db.ExecContext(ctx, `INSERT INTO samples(source_id,device_id,sample_id,payload,received_at) VALUES(?,?,?,?,?) ON CONFLICT(source_id,device_id,sample_id) DO NOTHING`, sample.SourceID, sample.DeviceID, sample.SampleID, string(payload), at.UTC().Format(time.RFC3339Nano))
	if err != nil {
		return false, err
	}
	n, err := result.RowsAffected()
	if err != nil {
		return false, err
	}
	if n == 1 {
		return true, nil
	}
	var previous string
	if err = s.db.QueryRowContext(ctx, `SELECT payload FROM samples WHERE source_id=? AND device_id=? AND sample_id=?`, sample.SourceID, sample.DeviceID, sample.SampleID).Scan(&previous); err != nil {
		return false, err
	}
	if previous != string(payload) {
		return false, telemetry.ErrConflict
	}
	return false, nil
}
func (s *Store) RecentSamples(ctx context.Context, limit int) ([]telemetry.StoredSample, error) {
	if limit < 1 || limit > 100 {
		return nil, errors.New("limit must be between 1 and 100")
	}
	return s.samples(ctx, `SELECT payload,received_at FROM samples ORDER BY id DESC LIMIT ?`, limit)
}
func (s *Store) samples(ctx context.Context, query string, args ...any) ([]telemetry.StoredSample, error) {
	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []telemetry.StoredSample{}
	for rows.Next() {
		var payload, at string
		var sample telemetry.StoredSample
		if err = rows.Scan(&payload, &at); err != nil {
			return nil, err
		}
		if err = json.Unmarshal([]byte(payload), &sample.Sample); err != nil {
			return nil, err
		}
		if sample.ReceivedAt, err = time.Parse(time.RFC3339Nano, at); err != nil {
			return nil, err
		}
		result = append(result, sample)
	}
	return result, rows.Err()
}

// Devices returns at most 100 known devices, newest first. Silence is based on
// arrival of unique samples, not measurement time or evidence of radio connectivity.
func (s *Store) Devices(ctx context.Context, now time.Time) ([]telemetry.Device, error) {
	samples, err := s.samples(ctx, `SELECT payload,received_at FROM samples WHERE id IN (SELECT MAX(id) FROM samples GROUP BY source_id,device_id) ORDER BY id DESC LIMIT 100`)
	if err != nil {
		return nil, err
	}
	devices := []telemetry.Device{}
	for _, s := range samples {
		d := telemetry.Device{SourceID: s.SourceID, DeviceID: s.DeviceID, LastReceivedAt: s.ReceivedAt, ExpectedIntervalSeconds: s.ExpectedIntervalSeconds, Stale: !now.Before(s.ReceivedAt.Add(3 * time.Duration(s.ExpectedIntervalSeconds) * time.Second))}
		for _, r := range s.Readings {
			if r.Status == "error" {
				d.SensorError = true
			}
		}
		devices = append(devices, d)
	}
	return devices, nil
}
