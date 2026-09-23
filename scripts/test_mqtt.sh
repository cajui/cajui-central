#!/bin/sh
# Run from the repository root. Isolated project; only its test volumes are removed.
set -eu
export CAJUI_MQTT_PORT="${CAJUI_TEST_MQTT_PORT:-18883}"
project="cajui-mqtt-integration-$$"
compose() { docker compose -p "$project" -f compose.mqtt.yaml "$@"; }
cleanup() { compose down -v >/dev/null 2>&1; }
trap cleanup EXIT
python3 scripts/init_mqtt.py
compose up -d broker
docker run --rm --network "${project}_default" \
  -e CAJUI_TEST_MQTT_URL=tcp://broker:1883 \
  -v "$PWD":/src -w /src \
  -v cajui-go-mod:/go/pkg/mod -v cajui-go-build:/root/.cache/go-build \
  golang:1.27 make check
# MQTT 3.1.1 PUBACK has no negative reason code. MQTT 5 makes ACL rejection observable.
result=$(compose run --rm publish -h broker -V mqttv5 -q 1 -t telemetry/v1/other/device/samples -m denied 2>&1)
printf '%s\n' "$result" | grep -q 'Not authorized' || { printf '%s\n' 'ACL rejection was not observed'; exit 1; }
printf '%s\n' 'Broker integration and topic ACL checks passed.'
