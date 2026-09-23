#!/bin/sh
set -eu
umask 077
mkdir -p /auth
for name in central homeassistant demo-source; do
  printf '%s:' "$name"
  cat "/run/secrets/$name"
done > /auth/passwords.tmp
mosquitto_passwd -U /auth/passwords.tmp
chown 1883:1883 /auth/passwords.tmp
mv /auth/passwords.tmp /auth/passwords
