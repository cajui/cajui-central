package httpapi

import (
	_ "embed"
	"encoding/json"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// Generated from locales/*.yml; shared with the browser, with no runtime parser.
//
//go:embed locales/catalogs.json
var catalogJSON []byte

var catalogs = loadCatalogs()

func loadCatalogs() map[string]map[string]string {
	var result map[string]map[string]string
	if err := json.Unmarshal(catalogJSON, &result); err != nil {
		panic("invalid embedded locale catalogs: " + err.Error())
	}
	return result
}

func canonicalLocale(value string) string {
	switch strings.ToLower(value) {
	case "en-us":
		return "en-US"
	case "pt-br":
		return "pt-BR"
	default:
		return ""
	}
}

// Preferences are scoped to a request, never shared between users. Explicit
// selection wins over the cookie, which wins over the browser's weighted list.
func requestLocale(w http.ResponseWriter, r *http.Request) string {
	if selected := canonicalLocale(r.URL.Query().Get("lang")); selected != "" {
		http.SetCookie(w, &http.Cookie{
			Name: "cajui-locale", Value: selected, Path: "/", MaxAge: 31536000,
			HttpOnly: true, Secure: r.TLS != nil, SameSite: http.SameSiteLaxMode,
		})
		return selected
	}
	if cookie, err := r.Cookie("cajui-locale"); err == nil {
		if selected := canonicalLocale(cookie.Value); selected != "" {
			return selected
		}
	}
	selected, best := "en-US", 0.0
	for _, entry := range strings.Split(r.Header.Get("Accept-Language"), ",") {
		parts := strings.Split(strings.TrimSpace(entry), ";")
		tag := strings.ToLower(strings.TrimSpace(parts[0]))
		quality := 1.0
		if len(parts) > 2 {
			continue
		}
		if len(parts) == 2 {
			parameter := strings.TrimSpace(parts[1])
			if !strings.HasPrefix(parameter, "q=") {
				continue
			}
			var err error
			quality, err = strconv.ParseFloat(strings.TrimPrefix(parameter, "q="), 64)
			if err != nil || math.IsNaN(quality) || quality <= 0 || quality > 1 {
				continue
			}
		}
		candidate := ""
		switch strings.Split(tag, "-")[0] {
		case "en":
			candidate = "en-US"
		case "pt":
			candidate = "pt-BR"
		}
		if candidate != "" && quality > best {
			selected, best = candidate, quality
		}
	}
	return selected
}

func (p dashboardPage) Text(key string) string {
	if message := catalogs[p.State.Locale][key]; message != "" {
		return message
	}
	if message := catalogs["en-US"][key]; message != "" {
		return message
	}
	return key
}

func (p dashboardPage) Number(value any) string {
	var number float64
	switch value := value.(type) {
	case float64:
		number = value
	case *float64:
		if value == nil {
			return "—"
		}
		number = *value
	default:
		return "—"
	}
	text := strconv.FormatFloat(number, 'f', -1, 64)
	if p.State.Locale == "pt-BR" {
		text = strings.Replace(text, ".", ",", 1)
	}
	return text
}

// The no-JavaScript view labels UTC explicitly. Interactive charts use local time.
func (p dashboardPage) Date(value time.Time) string {
	if p.State.Locale == "pt-BR" {
		return value.UTC().Format("02/01/2006 15:04:05")
	}
	return value.UTC().Format("01/02/2006 3:04:05 PM")
}

func (p dashboardPage) Metric(value string) string {
	if message := catalogs[p.State.Locale]["metrics."+value]; message != "" {
		return message
	}
	return value
}

func (p dashboardPage) Status(value string) string {
	if message := catalogs[p.State.Locale]["states."+value]; message != "" {
		return message
	}
	return value
}
