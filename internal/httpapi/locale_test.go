package httpapi

import (
	"crypto/tls"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestRequestLocale(t *testing.T) {
	for _, tc := range []struct {
		name, query, cookie, accept, want string
		persist                           bool
	}{
		{"default", "", "", "", "en-US", false},
		{"browser Portuguese", "", "", "pt-BR,pt;q=0.9,en-US;q=0.8", "pt-BR", false},
		{"weighted English", "", "", "pt-BR;q=0.2,en-US;q=0.9", "en-US", false},
		{"language fallback", "", "", "fr-FR,pt-PT;q=0.8", "pt-BR", false},
		{"unsupported", "", "", "fr-FR,de", "en-US", false},
		{"cookie", "", "pt-BR", "en-US", "pt-BR", false},
		{"selection", "en-US", "pt-BR", "pt", "en-US", true},
		{"case", "pt-br", "", "en-US", "pt-BR", true},
		{"invalid selection", "unknown", "pt-BR", "en", "pt-BR", false},
		{"invalid cookie", "", "unknown", "pt", "pt-BR", false},
		{"zero quality", "", "", "pt;q=0,en;q=1", "en-US", false},
		{"bad quality", "", "", "pt;q=broken,en", "en-US", false},
		{"nan quality", "", "", "pt;q=NaN,en", "en-US", false},
		{"quality too high", "", "", "pt;q=2,en", "en-US", false},
		{"extra parameters", "", "", "pt;q=1;bad=1,en", "en-US", false},
		{"invalid parameter", "", "", "pt;bad=1,en", "en-US", false},
		{"tie order", "", "", "pt;q=0.8,en;q=0.8", "pt-BR", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := httptest.NewRequest("GET", "http://localhost/?lang="+tc.query, nil)
			r.Header.Set("Accept-Language", tc.accept)
			if tc.cookie != "" {
				r.AddCookie(&http.Cookie{Name: "cajui-locale", Value: tc.cookie})
			}
			w := httptest.NewRecorder()
			if got := requestLocale(w, r); got != tc.want {
				t.Fatalf("locale = %q, want %q", got, tc.want)
			}
			cookies := w.Result().Cookies()
			if tc.persist {
				if len(cookies) != 1 || cookies[0].Value != tc.want || !cookies[0].HttpOnly || cookies[0].Path != "/" || cookies[0].SameSite != http.SameSiteLaxMode {
					t.Fatal("invalid preference cookie", cookies)
				}
			} else if len(cookies) != 0 {
				t.Fatal("implicit preference must not set a cookie")
			}
		})
	}
	r := httptest.NewRequest("GET", "https://localhost/?lang=pt-BR", nil)
	r.TLS = &tls.ConnectionState{}
	w := httptest.NewRecorder()
	requestLocale(w, r)
	if !w.Result().Cookies()[0].Secure {
		t.Fatal("HTTPS preference cookie must be secure")
	}
}

func TestLocalizedPagesAndSnapshot(t *testing.T) {
	h := testHandler(t)
	for _, route := range []string{"/", "/devices", "/sensors"} {
		for _, language := range []string{"pt-BR", "en-US"} {
			w := request(h, "GET", route+"?lang="+language, "", "", "")
			if w.Code != 200 || w.Header().Get("Content-Language") != language {
				t.Fatal(route, language, w.Code, w.Header())
			}
			body := w.Body.String()
			for _, want := range []string{`lang="` + language + `"`, `"locale":"` + language + `"`, catalogs[language]["ssr.heading"], catalogs[language]["nav.skip"]} {
				if !strings.Contains(body, want) {
					t.Fatal("missing localized content", want)
				}
			}
			if strings.Contains(body, token) {
				t.Fatal("API token leaked")
			}
		}
	}
	// Localization cannot bypass the local-page boundary or authenticate the API.
	r := httptest.NewRequest("GET", "http://untrusted.example/?lang=pt-BR", nil)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != http.StatusForbidden || w.Header().Get("Set-Cookie") != "" {
		t.Fatal("locale selection bypassed local access policy", w.Code)
	}
	if w = request(h, "GET", "/api/v1/readings?lang=pt-BR", "", "", ""); w.Code != http.StatusUnauthorized {
		t.Fatal("locale selection bypassed API authentication", w.Code)
	}
}

func TestLocalePresentationFallbacks(t *testing.T) {
	pt := dashboardPage{State: dashboardState{Locale: "pt-BR"}}
	en := dashboardPage{State: dashboardState{Locale: "en-US"}}
	unknown := dashboardPage{State: dashboardState{Locale: "unsupported"}}
	if unknown.Text("common.devices") != "Devices" || pt.Text("missing") != "missing" {
		t.Fatal("invalid fallback")
	}
	value := 24.5
	var absent *float64
	if pt.Number(value) != "24,5" || pt.Number(&value) != "24,5" || en.Number(value) != "24.5" || pt.Number(absent) != "—" || pt.Number(nil) != "—" {
		t.Fatal("invalid number formatting")
	}
	at := time.Date(2026, 9, 26, 15, 4, 5, 0, time.UTC)
	if pt.Date(at) != "26/09/2026 15:04:05" || en.Date(at) != "09/26/2026 3:04:05 PM" {
		t.Fatal("invalid date formatting")
	}
	if pt.Metric("temperature") != "Temperatura" || pt.Metric("custom_metric") != "custom_metric" || pt.Status("error") != "Erro de leitura" || pt.Status("custom") != "custom" {
		t.Fatal("invalid display label")
	}
}
