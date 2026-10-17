package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/cajui/cajui-central/internal/history"
)

func (s *server) measurementHistory(w http.ResponseWriter, r *http.Request) {
	if !s.trustedLocalRead(r) {
		http.Error(w, "reload the local page", http.StatusForbidden)
		return
	}
	values, err := url.ParseQuery(r.URL.RawQuery)
	if err != nil {
		http.Error(w, "invalid history query", 400)
		return
	}
	for key, v := range values {
		switch key {
		case "sensor", "metric", "unit", "from", "to", "anchor", "before", "view":
		default:
			http.Error(w, "invalid history query", 400)
			return
		}
		if len(v) != 1 {
			http.Error(w, "invalid history query", 400)
			return
		}
	}
	var q history.Query
	q.SensorID, err = strconv.ParseInt(values.Get("sensor"), 10, 64)
	if err == nil {
		q.From, err = time.Parse(time.RFC3339Nano, values.Get("from"))
	}
	if err == nil {
		q.To, err = time.Parse(time.RFC3339Nano, values.Get("to"))
	}
	q.Metric, q.Unit = values.Get("metric"), values.Get("unit")
	if err == nil && values.Has("anchor") {
		q.Anchor, err = strconv.ParseInt(values.Get("anchor"), 10, 64)
	}
	if err == nil && values.Has("before") {
		parts := strings.Split(values.Get("before"), ":")
		if len(parts) != 2 {
			err = history.ErrInvalid
		} else {
			q.BeforeTime, err = strconv.ParseInt(parts[0], 10, 64)
			if err == nil {
				q.BeforeID, err = strconv.ParseInt(parts[1], 10, 64)
			}
			if q.BeforeID <= 0 {
				err = history.ErrInvalid
			}
		}
	}
	view := values.Get("view")
	if err != nil || q.Validate() != nil || (view != "" && view != "rows") {
		http.Error(w, "invalid history query", 400)
		return
	}
	select {
	case s.historyRequests <- struct{}{}:
		defer func() { <-s.historyRequests }()
	default:
		http.Error(w, "history busy; retry later", http.StatusServiceUnavailable)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	result, err := s.repo.History(ctx, q, view != "rows")
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			http.Error(w, "choose a shorter period", http.StatusServiceUnavailable)
		} else {
			s.fail(w, err)
		}
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(result)
}
