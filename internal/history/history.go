package history

import (
	"errors"
	"sort"
	"time"
)

var ErrInvalid = errors.New("invalid history query")

const PageSize = 100
const RawLimit = 600
const Buckets = 120
const MaxPeriod = 366 * 24 * time.Hour

type Query struct {
	SensorID   int64
	Metric     string
	Unit       string
	From       time.Time
	To         time.Time
	Anchor     int64
	BeforeTime int64
	BeforeID   int64
}

func (q Query) Validate() error {
	if q.SensorID <= 0 || len(q.Metric) == 0 || len(q.Metric) > 64 || len(q.Unit) > 32 ||
		q.From.Before(time.Unix(0, 0)) || q.To.UnixMilli() <= q.From.UnixMilli() || q.To.Sub(q.From) > MaxPeriod ||
		q.Anchor < 0 || q.BeforeTime < 0 || q.BeforeID < 0 || (q.BeforeID > 0 && q.Anchor == 0) {
		return ErrInvalid
	}
	return nil
}

type Point struct {
	ID          int64    `json:"id"`
	Time        int64    `json:"time"`
	ReceivedAt  string   `json:"received_at"`
	Value       *float64 `json:"value"`
	Status      string   `json:"status"`
	Interval    int      `json:"interval"`
	BreakBefore bool     `json:"break_before,omitempty"`
}

type Result struct {
	Points  []Point `json:"points"`
	Rows    []Point `json:"rows"`
	Count   int     `json:"count"`
	Sampled bool    `json:"sampled"`
	Anchor  int64   `json:"anchor"`
	Next    string  `json:"next"`
}

type bucket struct {
	first, last, min, max, invalid *Point
	broken                         bool
}

type Summary struct {
	from, width int64
	count       int
	raw         []Point
	buckets     [Buckets]bucket
	previous    *Point
}

func NewSummary(from, to time.Time) *Summary {
	return &Summary{from: from.UnixMilli(), width: max(1, (to.UnixMilli()-from.UnixMilli()+Buckets-1)/Buckets)}
}

func (s *Summary) Add(p Point) {
	p.BreakBefore = s.previous != nil && s.previous.Interval > 0 && p.Time-s.previous.Time > int64(s.previous.Interval)*3000
	s.count++
	if s.count <= RawLimit {
		s.raw = append(s.raw, p)
	} else {
		s.raw = nil
	}
	i := min(Buckets-1, max(0, int((p.Time-s.from)/s.width)))
	b := &s.buckets[i]
	if b.first == nil {
		b.first = &p
	}
	b.last = &p
	if p.Value == nil {
		b.invalid = &p
	} else {
		if b.min == nil || *p.Value < *b.min.Value {
			b.min = &p
		}
		if b.max == nil || *p.Value > *b.max.Value {
			b.max = &p
		}
	}
	if p.BreakBefore {
		b.broken = true
	}
	s.previous = &p
}

func (s *Summary) Points() ([]Point, bool) {
	if s.count <= RawLimit {
		if s.raw == nil {
			return []Point{}, false
		}
		return s.raw, false
	}
	out := []Point{}
	for _, b := range s.buckets {
		unique := map[int64]Point{}
		for _, p := range []*Point{b.first, b.last, b.min, b.max, b.invalid} {
			if p != nil {
				copy := *p
				copy.BreakBefore = b.broken || b.invalid != nil
				unique[p.ID] = copy
			}
		}
		part := []Point{}
		for _, p := range unique {
			part = append(part, p)
		}
		sort.Slice(part, func(i, j int) bool {
			if part[i].Time == part[j].Time {
				return part[i].ID < part[j].ID
			}
			return part[i].Time < part[j].Time
		})
		out = append(out, part...)
	}
	return out, true
}
