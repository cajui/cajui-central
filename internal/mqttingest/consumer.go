// Package mqttingest consumes an open telemetry stream without publishing application receipts.
package mqttingest

import (
	"context"
	"crypto/tls"
	"errors"
	"log/slog"
	"sync/atomic"
	"time"

	"github.com/cajui/cajui-central/internal/telemetry"
	mqtt "github.com/eclipse/paho.mqtt.golang"
)

const Topic = "telemetry/v1/+/+/samples"

type Repository interface {
	InsertSample(context.Context, telemetry.Sample, time.Time) (bool, error)
}
type Config struct {
	URL, ClientID, Username, Password string
	TLS                               *tls.Config
}
type Consumer struct {
	config    Config
	repo      Repository
	logger    *slog.Logger
	connected atomic.Bool
}

func New(config Config, repo Repository, logger *slog.Logger) *Consumer {
	if logger == nil {
		logger = slog.Default()
	}
	return &Consumer{config: config, repo: repo, logger: logger}
}
func (c *Consumer) Connected() bool { return c.connected.Load() }

// Handle rejects retained snapshots: an old retained sample is not a new arrival.
func (c *Consumer) Handle(ctx context.Context, topic string, payload []byte, retained bool) (bool, error) {
	if retained {
		return false, nil
	}
	s, err := telemetry.DecodeSample(payload)
	if err != nil {
		return false, err
	}
	if topic != "telemetry/v1/"+s.SourceID+"/"+s.DeviceID+"/samples" {
		return false, telemetry.ErrInvalid
	}
	return c.repo.InsertSample(ctx, s, time.Now())
}

type message struct {
	topic    string
	payload  []byte
	retained bool
}

// Run reconnects until cancellation. The bounded queue deliberately permits loss
// under overload. Broker PUBACK is independent of Central's database commit.
func (c *Consumer) Run(ctx context.Context) {
	inbox := make(chan message, 128)
	options := mqtt.NewClientOptions().AddBroker(c.config.URL).SetClientID(c.config.ClientID).
		SetUsername(c.config.Username).SetPassword(c.config.Password).SetTLSConfig(c.config.TLS).
		SetCleanSession(true).SetAutoReconnect(false).SetConnectRetry(false).
		SetConnectTimeout(5 * time.Second).SetWriteTimeout(5 * time.Second).
		SetKeepAlive(30 * time.Second).SetPingTimeout(5 * time.Second)
	lost := make(chan struct{}, 1)
	options.SetConnectionLostHandler(func(_ mqtt.Client, _ error) {
		c.connected.Store(false)
		select {
		case lost <- struct{}{}:
		default:
		}
	})
	handler := func(_ mqtt.Client, m mqtt.Message) {
		if m.Retained() || len(m.Payload()) > telemetry.MaxSampleBytes {
			return
		}
		item := message{m.Topic(), append([]byte(nil), m.Payload()...), m.Retained()}
		select {
		case inbox <- item:
		default:
			c.logger.Warn("MQTT ingestion queue full; sample dropped")
		}
	}
	client := mqtt.NewClient(options)
	defer func() { c.connected.Store(false); client.Disconnect(250) }()
	retry := time.Second
	for ctx.Err() == nil {
		if err := wait(ctx, client.Connect()); err != nil {
			c.logger.Warn("MQTT connection unavailable")
			if !pause(ctx, retry) {
				return
			}
			retry = min(retry*2, 30*time.Second)
			continue
		}
		subscription := client.Subscribe(Topic, 1, handler)
		subscriptionError := wait(ctx, subscription)
		if subscriptionError == nil {
			if result, ok := subscription.(*mqtt.SubscribeToken); !ok || result.Result()[Topic] > 1 {
				subscriptionError = errors.New("subscription refused")
			}
		}
		if subscriptionError != nil {
			client.Disconnect(250)
			if !pause(ctx, retry) {
				return
			}
			retry = min(retry*2, 30*time.Second)
			continue
		}
		retry = time.Second
		c.connected.Store(true)
		c.logger.Info("MQTT subscription ready")
	connected:
		for {
			select {
			case <-ctx.Done():
				return
			case <-lost:
				break connected
			case m := <-inbox:
				operation, cancel := context.WithTimeout(ctx, 5*time.Second)
				_, err := c.Handle(operation, m.topic, m.payload, m.retained)
				cancel()
				if err != nil {
					if errors.Is(err, telemetry.ErrInvalid) || errors.Is(err, telemetry.ErrConflict) {
						c.logger.Warn("MQTT sample rejected")
					} else {
						c.logger.Error("MQTT sample storage failed")
					}
				}
			}
		}
		client.Disconnect(250)
	}
}
func wait(ctx context.Context, t mqtt.Token) error {
	timer := time.NewTimer(10 * time.Second)
	defer timer.Stop()
	select {
	case <-timer.C:
		return context.DeadlineExceeded
	case <-ctx.Done():
		return ctx.Err()
	case <-t.Done():
		return t.Error()
	}
}
func pause(ctx context.Context, d time.Duration) bool {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-t.C:
		return true
	}
}
