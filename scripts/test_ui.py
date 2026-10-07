import os
from pathlib import Path
import secrets
import socket
import subprocess
import tempfile
import time
import urllib.error
import urllib.request


def main():
    root = Path(__file__).resolve().parents[1]
    with tempfile.TemporaryDirectory(prefix="cajui-ui-") as directory:
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            port = listener.getsockname()[1]
        base = f"http://127.0.0.1:{port}"
        token_file = Path(directory) / "token"
        token_file.write_text(secrets.token_hex(32))
        token_file.chmod(0o600)
        env = dict({key: value for key, value in os.environ.items() if not key.startswith("CAJUI_")}, CAJUI_API_TOKEN_FILE=str(token_file), CAJUI_ADDR=f"127.0.0.1:{port}",
                   CAJUI_DB=str(Path(directory) / "test.db"), CAJUI_MQTT_URL="")
        with (Path(directory) / "server.log").open("w+") as log:
            process = subprocess.Popen([str(root / "bin/cajui")], cwd=root, env=env, stdout=log, stderr=log)
            try:
                for _ in range(60):
                    if process.poll() is not None:
                        raise RuntimeError("UI test server exited during startup")
                    try:
                        with urllib.request.urlopen(base + "/healthz", timeout=1):
                            break
                    except (urllib.error.URLError, TimeoutError):
                        time.sleep(0.5)
                else:
                    raise RuntimeError("UI test server did not become healthy")
                subprocess.run(["npm", "--prefix", "tests/ui", "test"], cwd=root,
                               env=dict(os.environ, CAJUI_UI_TEST_URL=base, CAJUI_UI_API_TOKEN_FILE=str(token_file)), check=True)
            finally:
                process.terminate()
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()


if __name__ == "__main__":
    main()
