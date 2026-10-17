package history

import (
	"testing"
	"time"
)

func TestSummaryPreservesExtremesErrorsGapsAndBounds(t *testing.T) {
	from := time.Unix(100, 0)
	s := NewSummary(from, from.Add(24*time.Hour))
	for i := 0; i < 2000; i++ {
		v := float64(i % 17)
		if i == 12 {
			v = -900
		}
		if i == 18 {
			v = 900
		}
		p := Point{ID: int64(i + 1), Time: from.UnixMilli() + int64(i)*1000, Value: &v, Status: "ok", Interval: 1}
		if i > 1000 {
			p.Time += 600000
		}
		if i == 20 {
			p.Value = nil
			p.Status = "error"
		}
		s.Add(p)
	}
	points, sampled := s.Points()
	if !sampled || len(points) > Buckets*5 {
		t.Fatal(len(points), sampled)
	}
	minFound, maxFound, errorFound, gapFound := false, false, false, false
	for i, p := range points {
		if p.Value != nil {
			minFound = minFound || *p.Value == -900
			maxFound = maxFound || *p.Value == 900
		} else {
			errorFound = true
		}
		gapFound = gapFound || p.BreakBefore
		if i > 0 && p.Time < points[i-1].Time {
			t.Fatal("unordered points")
		}
	}
	if !minFound || !maxFound || !errorFound || !gapFound {
		t.Fatal(minFound, maxFound, errorFound, gapFound)
	}
	if points[0].ID != 1 || points[len(points)-1].ID != 2000 {
		t.Fatal("lost endpoints")
	}
}
func TestSummaryExactAndEmpty(t *testing.T) {
	from := time.Unix(100, 0)
	s := NewSummary(from, from.Add(time.Hour))
	if p, sampled := s.Points(); p == nil || len(p) != 0 || sampled {
		t.Fatal(p, sampled)
	}
	v := 0.0
	s.Add(Point{ID: 1, Time: 100000, Value: &v, Interval: 1})
	s.Add(Point{ID: 2, Time: 100000, Value: &v, Interval: 1})
	s.Add(Point{ID: 3, Time: 105000, Value: &v, Interval: 1})
	p, sampled := s.Points()
	if sampled || len(p) != 3 || p[0].Value == nil || *p[0].Value != 0 || !p[2].BreakBefore {
		t.Fatal(p, sampled)
	}
}
func TestQueryBounds(t *testing.T) {
	valid := Query{SensorID: 1, Metric: "temperature", Unit: "degC", From: time.Unix(100, 0), To: time.Unix(200, 0)}
	if valid.Validate() != nil {
		t.Fatal("valid query")
	}
	for _, change := range []func(*Query){
		func(q *Query) { q.SensorID = 0 }, func(q *Query) { q.Metric = "" }, func(q *Query) { q.Unit = string(make([]byte, 33)) },
		func(q *Query) { q.To = q.From }, func(q *Query) { q.To = q.From.Add(MaxPeriod + time.Second) }, func(q *Query) { q.From = time.Unix(-1, 0) },
		func(q *Query) { q.Anchor = -1 }, func(q *Query) { q.BeforeID = 1 }, func(q *Query) { q.BeforeTime = -1 },
	} {
		q := valid
		change(&q)
		if q.Validate() == nil {
			t.Fatal(q)
		}
	}
}
