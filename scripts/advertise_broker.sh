#!/bin/sh
# Announce the MQTT broker on the local network (mDNS/DNS-SD, _mqtt._tcp) so devices
# can discover it instead of typing its address. Runs until interrupted.
# Docker Desktop cannot multicast from containers, so this runs on the host.
set -eu
port="${CAJUI_MQTT_PORT:-1883}"
name="${CAJUI_MQTT_SERVICE_NAME:-Cajui MQTT broker}"
if command -v dns-sd >/dev/null 2>&1; then
  exec dns-sd -R "$name" _mqtt._tcp local "$port"
elif command -v avahi-publish-service >/dev/null 2>&1; then
  exec avahi-publish-service "$name" _mqtt._tcp "$port"
fi
echo 'Neither dns-sd (macOS) nor avahi-publish-service (Linux, avahi-utils) is available.' >&2
exit 1
