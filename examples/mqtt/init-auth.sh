#!/bin/sh
set -eu
umask 077
mkdir -p /auth
cp /acl-base /auth/acl.tmp
for name in central homeassistant demo-source; do
  printf '%s:' "$name"
  cat "/run/secrets/$name"
done > /auth/passwords.tmp
# Each producer may publish only under its own source namespace.
for path in /run/secrets/producers/*; do
  [ -f "$path" ] || continue
  name=$(basename "$path")
  case "$name" in
    [!A-Za-z0-9]* | *[!A-Za-z0-9._-]*) echo "Invalid producer name: $name" >&2; exit 1 ;;
    central | homeassistant | demo-source) echo "Reserved producer name: $name" >&2; exit 1 ;;
  esac
  printf '%s:' "$name" >> /auth/passwords.tmp
  cat "$path" >> /auth/passwords.tmp
  printf '\nuser %s\ntopic write telemetry/v1/%s/+/samples\n' "$name" "$name" >> /auth/acl.tmp
done
mosquitto_passwd -U /auth/passwords.tmp
chown 1883:1883 /auth/passwords.tmp /auth/acl.tmp
mv /auth/passwords.tmp /auth/passwords
mv /auth/acl.tmp /auth/acl
