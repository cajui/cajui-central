import json
import os
import re
from pathlib import Path
import socket
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
import uuid


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def main():
    root = Path(__file__).resolve().parents[1]
    project = "cajui-smoke-" + uuid.uuid4().hex[:12]
    env = {key: value for key, value in os.environ.items() if not key.startswith("CAJUI_")}
    with socket.socket() as http_port, socket.socket() as mqtt_port:
        http_port.bind(("127.0.0.1", 0))
        mqtt_port.bind(("127.0.0.1", 0))
        env.update(CAJUI_PORT=str(http_port.getsockname()[1]),
                   CAJUI_MQTT_PORT=str(mqtt_port.getsockname()[1]), CAJUI_MQTT_BIND="127.0.0.1")
    with tempfile.TemporaryDirectory(prefix="cajui-smoke-") as directory:
        override = Path(directory) / "compose.json"
        override.write_text(json.dumps({"services": {
            "cajui": {"image": project + "-central"},
            **{name: {"image": project + "-broker"} for name in ("broker", "credentials", "demo")},
        }}))
        command = ["docker", "compose", "-p", project, "-f", str(root / "compose.yaml"),
                   "-f", str(root / "compose.dev.yaml"), "-f", str(override)]

        def compose(*args, capture=False):
            return subprocess.run(command + list(args), cwd=root, env=env, check=True,
                                  text=True, stdout=subprocess.PIPE if capture else None)

        def wait_for(probe):
            deadline = time.monotonic() + 45
            while time.monotonic() < deadline:
                try:
                    if probe():
                        return
                except (urllib.error.URLError, TimeoutError, ConnectionError):
                    pass
                time.sleep(0.5)
            raise RuntimeError("Compose smoke condition timed out")

        try:
            compose("up", "-d", "--build", "--wait", "broker", "cajui")
            address = compose("port", "cajui", "8080", capture=True).stdout.strip()
            base = "http://" + address
            token = subprocess.run([
                "docker", "run", "--rm", "-v", project + "_secrets:/secrets:ro",
                "--entrypoint", "cat", project + "-broker", "/secrets/api-token",
            ], check=True, text=True, stdout=subprocess.PIPE).stdout.strip()

            capability = None

            def request(path, data=None, authenticated=True):
                headers = {"Content-Type": "application/json"}
                if capability:
                    headers["X-Cajui-Workspace"] = capability
                if authenticated:
                    headers["Authorization"] = "Bearer " + token
                req = urllib.request.Request(base + path, data=data, headers=headers)
                with urllib.request.urlopen(req, timeout=3) as response:
                    body = response.read()
                    return response.status, json.loads(body) if body else None

            wait_for(lambda: request("/healthz")[0] == 200)
            try:
                request("/api/v1/readings", authenticated=False)
                raise AssertionError("Unauthenticated API request succeeded")
            except urllib.error.HTTPError as error:
                require(error.code == 401, "Unexpected authentication response")
            reading = json.dumps({"node_id": "smoke", "sensor_id": "temperature", "session_id": "boot",
                                  "sequence": 0, "metric": "temperature", "value": 23, "unit": "degC"}).encode()
            require(request("/api/v1/readings", reading)[0] == 201, "HTTP reading was not created")
            def wait_for_broker():
                nonlocal capability
                with urllib.request.urlopen(base + "/broker", timeout=3) as response:
                    snapshot = re.search(r'<script type="application/json" id="initial-state">(.*?)</script>',
                                         response.read().decode(), re.DOTALL)
                    if snapshot is None:
                        raise RuntimeError("Missing workspace snapshot")
                    capability = json.loads(snapshot.group(1))["ui_token"]
                wait_for(lambda: request("/ui-api/broker")[1]["connected"])

            wait_for_broker()
            compose("run", "--rm", "demo")
            wait_for(lambda: len(request("/api/v1/samples")[1]) == 1)
            before_readings = request("/api/v1/readings")[1]
            before_samples = request("/api/v1/samples")[1]
            require(any(row["node_id"] == "smoke" for row in before_readings), "HTTP reading is missing")
            compose("restart", "cajui")
            wait_for(lambda: request("/healthz")[0] == 200)
            require(request("/api/v1/readings")[1] == before_readings, "Readings changed after restart")
            require(request("/api/v1/samples")[1] == before_samples, "Samples changed after restart or redelivery")
            require(request("/api/v1/readings", reading)[0] == 200, "HTTP redelivery was not deduplicated")
            wait_for_broker()
            compose("run", "--rm", "demo")
            wait_for(lambda: any(message["topic"] == "telemetry/v1/demo-source/demo-device/samples"
                                for message in request("/ui-api/broker")[1]["messages"]))
            require(request("/api/v1/samples")[1] == before_samples, "Samples changed after restart or redelivery")
            print("Compose startup, authentication, HTTP/MQTT ingestion and persistence passed.")
        finally:
            subprocess.run(command + ["down", "--volumes", "--rmi", "local"], cwd=root, env=env, check=True)


if __name__ == "__main__":
    main()
