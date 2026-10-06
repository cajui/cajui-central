package httpapi

import (
	"crypto/subtle"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/cajui/cajui-central/internal/devicestate"
	"github.com/cajui/cajui-central/internal/mqttingest"
)

type BrokerObserver interface {
	Diagnostics() mqttingest.Diagnostics
	Configured() bool
}

// ReceiverSetup points only to a dedicated producer credential, never Central's account.
type ReceiverSetup struct {
	Username, PasswordFile, Host string
	Port                         int
}

func WithBroker(observer BrokerObserver, setup ReceiverSetup) Option {
	return func(s *server) { s.broker = observer; s.receiverSetup = setup }
}
func (s *server) brokerStatus(w http.ResponseWriter, r *http.Request) {
	if !s.trustedLocalRead(r) {
		http.Error(w, "reload the local page", 403)
		return
	}
	d := mqttingest.Diagnostics{Messages: []mqttingest.ObservedMessage{}, Limit: mqttingest.MessageLimit, Topics: []string{}}
	if s.broker != nil {
		d = s.broker.Diagnostics()
	}
	host := s.receiverSetup.Host

	port := s.receiverSetup.Port
	if port == 0 {
		port = d.Port
	}
	out := struct {
		mqttingest.Diagnostics
		ReceiverHost         string `json:"receiver_host"`
		ReceiverPort         int    `json:"receiver_port"`
		ReceiverUsername     string `json:"receiver_username"`
		CredentialsAvailable bool   `json:"credentials_available"`
	}{d, host, port, s.receiverSetup.Username, d.Configured && s.receiverSetup.PasswordFile != ""}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(out)
}
func (s *server) receiverCredentials(w http.ResponseWriter, r *http.Request) {
	if !s.trustedLocalWrite(r) {
		http.Error(w, "reload the local page", 403)
		return
	}
	if r.Header.Get("Content-Type") != "application/json" {
		http.Error(w, "use application/json", 415)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 128)
	var input struct{}
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if dec.Decode(&input) != nil || dec.Decode(new(any)) != io.EOF {
		http.Error(w, "invalid request", 400)
		return
	}
	setup := s.receiverSetup
	if s.broker == nil || !s.broker.Configured() || setup.PasswordFile == "" {
		http.Error(w, "receiver credentials are not configured", 409)
		return
	}
	// Do not follow symlinks or read special files. The path is configured by the operator,
	// never selected by a browser. Bound reads and return no filesystem details on failure.
	st, err := os.Lstat(setup.PasswordFile)
	if err != nil {
		s.credentialUnavailable(w, "stat_failed")
		return
	}
	if !st.Mode().IsRegular() {
		s.credentialUnavailable(w, "not_regular")
		return
	}
	if st.Size() > 128 {
		s.credentialUnavailable(w, "file_too_large")
		return
	}
	f, err := os.Open(setup.PasswordFile)
	if err != nil {
		s.credentialUnavailable(w, "open_failed")
		return
	}
	defer f.Close()
	b, err := io.ReadAll(io.LimitReader(f, 129))
	password := strings.TrimRight(string(b), "\r\n")
	if err != nil {
		s.credentialUnavailable(w, "read_failed")
		return
	}
	// The receiver firmware accepts MQTT passwords of 1–64 bytes.
	if len(password) < 1 || len(password) > 64 {
		s.credentialUnavailable(w, "invalid_length")
		return
	}
	for _, c := range password {
		if c < '!' || c > '~' {
			s.credentialUnavailable(w, "invalid_character")
			return
		}
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}{setup.Username, password})
}

func (s *server) credentialUnavailable(w http.ResponseWriter, reason string) {
	s.logger.Warn("receiver credential unavailable", "reason", reason)
	http.Error(w, "receiver credential unavailable", http.StatusServiceUnavailable)
}
func (s *server) trustedLocalRead(r *http.Request) bool {
	return localHost(r.Host) && subtle.ConstantTimeCompare([]byte(r.Header.Get("X-Cajui-Workspace")), []byte(s.uiToken)) == 1
}

// receiverStates avoids loading telemetry and rendering HTML during enrollment polling.
func (s *server) receiverStates(w http.ResponseWriter, r *http.Request) {
	if !s.trustedLocalRead(r) {
		http.Error(w, "reload the local page", http.StatusForbidden)
		return
	}
	at := time.Now().UTC()
	states, err := s.repo.DeviceStates(r.Context())
	if err != nil {
		s.fail(w, err)
		return
	}
	receivers := []devicestate.Stored{}
	for _, state := range states {
		if state.Role == "receiver" {
			receivers = append(receivers, state)
		}
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(struct {
		GeneratedAt time.Time            `json:"generated_at"`
		States      []devicestate.Stored `json:"device_states"`
	}{at, receivers})
}
