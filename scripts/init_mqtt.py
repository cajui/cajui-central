#!/usr/bin/env python3
"""Create development secrets without overwriting existing credentials."""
import argparse
import os
from pathlib import Path
import re
import secrets

# Producer names become MQTT users, source_id values and topic levels. Mosquitto's
# password file uses ':' as its separator, so it is not allowed here.
PRODUCER = re.compile(r'[A-Za-z0-9][A-Za-z0-9._-]{0,63}')
RESERVED = {'api-token', 'central', 'homeassistant', 'demo-source', 'mosquitto_pub'}


def private_directory(path):
    if path.is_symlink():
        raise SystemExit('Refusing a symlink for the secrets directory')
    path.mkdir(mode=0o700, exist_ok=True)
    path.chmod(0o700)


def create_secret(path):
    if path.is_symlink():
        raise SystemExit('Refusing symlink secret files')
    try:
        # Readable by container users; the host directory is private (0700).
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o644)
    except FileExistsError:
        return False
    with os.fdopen(fd, 'w') as output:
        output.write(secrets.token_hex(32) + '\n')
    return True


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--producer', action='append', default=[],
                    help='Create a credential for a producer that may publish only '
                         'under telemetry/v1/<producer>/')
args = parser.parse_args()
for name in args.producer:
    if not PRODUCER.fullmatch(name) or name in RESERVED:
        raise SystemExit(f'Invalid producer name: {name!r}')

root = Path(__file__).resolve().parents[1] / '.local-mqtt'
private_directory(root)
for name in ('api-token', 'central', 'homeassistant', 'demo-source'):
    create_secret(root / name)
config = root / 'mosquitto_pub'
if config.is_symlink():
    raise SystemExit('Refusing a symlink publisher configuration')
config.write_text('-u demo-source\n-P ' + (root / 'demo-source').read_text().strip() + '\n')
config.chmod(0o644)
if args.producer:
    private_directory(root / 'producers')
for name in args.producer:
    created = create_secret(root / 'producers' / name)
    print(f'Producer {name}: {"created" if created else "kept existing"} credential.')
print('Development secrets ready in .local-mqtt (not printed).')
