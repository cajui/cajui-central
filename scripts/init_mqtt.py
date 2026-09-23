#!/usr/bin/env python3
"""Create development secrets without overwriting existing credentials."""
import os
from pathlib import Path
import secrets

root = Path(__file__).resolve().parents[1] / '.local-mqtt'
if root.is_symlink():
    raise SystemExit('Refusing a symlink for the secrets directory')
root.mkdir(mode=0o700, exist_ok=True)
root.chmod(0o700)
for name in ('api-token', 'central', 'homeassistant', 'demo-source'):
    path = root / name
    if path.is_symlink():
        raise SystemExit('Refusing symlink secret files')
    try:
        # Readable by container users; the host directory is private (0700).
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o644)
    except FileExistsError:
        continue
    with os.fdopen(fd, 'w') as output:
        output.write(secrets.token_hex(32) + '\n')
config = root / 'mosquitto_pub'
if config.is_symlink():
    raise SystemExit('Refusing a symlink publisher configuration')
config.write_text('-u demo-source\n-P ' + (root / 'demo-source').read_text().strip() + '\n')
config.chmod(0o644)
print('Development secrets ready in .local-mqtt (not printed).')
