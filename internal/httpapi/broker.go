package httpapi

import (
	"crypto/subtle"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"strings"

	"github.com/cajui/cajui-central/internal/mqttingest"
)

type BrokerObserver interface{ Diagnostics() mqttingest.Diagnostics }

// ReceiverSetup points only to a dedicated producer credential, never Central's account.
type ReceiverSetup struct {
	Username, PasswordFile, Host string
	Port                         int
}

func WithBroker(observer BrokerObserver, setup ReceiverSetup) Option {
	return func(s *server) { s.broker = observer; s.receiverSetup = setup }
}
func (s *server) brokerStatus(w http.ResponseWriter, r *http.Request) {
	if !localHost(r.Host) || subtle.ConstantTimeCompare([]byte(r.Header.Get("X-Cajui-Workspace")), []byte(s.uiToken)) != 1 {
		http.Error(w, "reload the local page", 403)
		return
	}
	d := mqttingest.Diagnostics{Messages: []mqttingest.ObservedMessage{}, Limit: mqttingest.MessageLimit, Topics: []string{}}
	if s.broker != nil {
		d = s.broker.Diagnostics()
	}
	host := s.receiverSetup.Host
	if host == "" {
		host = d.ReceiverEndpoint()
	}
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
	if s.broker == nil || !s.broker.Diagnostics().Configured || setup.PasswordFile == "" {
		http.Error(w, "receiver credentials are not configured", 409)
		return
	}
	// Do not follow symlinks or read special files. The path is configured by the operator,
	// never selected by a browser. Bound reads and return no filesystem details on failure.
	st, err := os.Lstat(setup.PasswordFile)
	if err != nil || !st.Mode().IsRegular() || st.Size() > 128 {
		http.Error(w, "receiver credential unavailable", 503)
		return
	}
	f, err := os.Open(setup.PasswordFile)
	if err != nil {
		http.Error(w, "receiver credential unavailable", 503)
		return
	}
	defer f.Close()
	b, err := io.ReadAll(io.LimitReader(f, 129))
	password := strings.TrimRight(string(b), "\r\n")
	if err != nil || len(password) < 1 || len(password) > 64 {
		http.Error(w, "receiver credential unavailable", 503)
		return
	}
	for _, c := range password {
		if c < '!' || c > '~' {
			http.Error(w, "receiver credential unavailable", 503)
			return
		}
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}{setup.Username, password})
}
