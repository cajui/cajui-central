#!/bin/sh
# Manages broker credentials in the /secrets volume. Run through Compose:
#   docker compose run --rm credentials <command> [name]
# The broker reloads producer credentials within a few seconds.
set -eu
secrets=/secrets
umask 077

usage() {
  cat >&2 <<'USAGE'
Commands:
  producer NAME   Create a producer credential if missing and print its password.
  import NAME     Set a producer password from the first line of standard input.
  remove NAME     Delete a producer credential; the broker stops accepting it.
  list            List producer names.
  homeassistant   Print the password of the read-only homeassistant user.
  token           Print the Central API token.
USAGE
  exit 2
}
valid_producer() {
  case "$1" in
    '' | [!A-Za-z0-9]* | *[!A-Za-z0-9._-]* | central | homeassistant | demo-source) return 1 ;;
  esac
  [ "${#1}" -le 64 ]
}
named() {
  [ $# -eq 2 ] || usage
  valid_producer "$2" || { echo "Invalid producer name: use 1-64 of A-Z a-z 0-9 . _ - starting with a letter or digit" >&2; exit 2; }
  mkdir -p "$secrets/producers"
  file="$secrets/producers/$2"
}
require() {
  [ -s "$secrets/$1" ] || { echo 'Credentials are created when the broker first starts. Run: docker compose up -d' >&2; exit 1; }
}

[ $# -ge 1 ] || usage
case "$1" in
  producer)
    named "$@"
    if [ ! -s "$file" ]; then
      od -An -tx1 -N32 /dev/urandom | tr -d ' \n' > "$file.tmp"
      mv "$file.tmp" "$file"
    fi
    cat "$file"; echo ;;
  import)
    named "$@"
    IFS= read -r password || true
    # Printable ASCII without spaces keeps the value safe to type on a device page.
    case "$password" in
      '' | *[!!-~]*) echo 'Password must be 1-64 printable characters without spaces' >&2; exit 2 ;;
    esac
    [ "${#password}" -le 64 ] || { echo 'Password must be 1-64 printable characters without spaces' >&2; exit 2; }
    printf '%s' "$password" > "$file.tmp"
    mv "$file.tmp" "$file"
    echo "Imported credential for $2" ;;
  remove)
    named "$@"
    rm -f "$file"
    echo "Removed $2" ;;
  list)
    [ $# -eq 1 ] || usage
    ls -1 "$secrets/producers" 2>/dev/null || true ;;
  homeassistant)
    [ $# -eq 1 ] || usage
    require homeassistant
    cat "$secrets/homeassistant"; echo ;;
  token)
    [ $# -eq 1 ] || usage
    require api-token
    cat "$secrets/api-token"; echo ;;
  *) usage ;;
esac
