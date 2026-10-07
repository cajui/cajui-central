# Contributing

See [README.md](README.md) to run the project. Use the Go version in go.mod, or
`make docker-check` to run Go checks in a container.

Install Node.js 22, Python 3.12+, the Go version in go.mod and Docker with Compose.
Prepare the test dependencies in a Python virtual environment:

```sh
python3 -m venv .venv
. .venv/bin/activate
pip install -r tests/requirements.txt
npm ci --prefix tests/ui --ignore-scripts
(cd tests/ui && npx playwright install --with-deps chromium)
```

Run `make check-fast` for Go, Python, generated locales, JavaScript formatting and
model tests. Run `make check-full` before opening a pull request: it also verifies
Go dependencies, builds the binary, scans Go vulnerabilities, exercises broker ACLs,
smoke-tests the Compose installation and runs browser tests. Every check must pass.
The full suite requires network access for images and dependencies. Broker ACL tests
use port 18883 (override with `CAJUI_TEST_MQTT_PORT`); the reference UI uses 8092.
Compose smoke tests and the browser application server use temporary ports and data.
Test cleanup removes only resources created for that run.

Individual targets are `make check`, `make check-python`, `make check-ui`,
`make test-compose` and `make test-ui` (after `make build`). Set `PYTHON` to select
a virtual-environment interpreter without activating it.

Keep pull requests focused: the problem, the expected behaviour and how you verified
it. Behaviour changes need tests. Persistence tests use a real SQLite database in a
temporary directory; HTTP tests use httptest. CI enforces gofmt, go vet, the race
detector, 80% minimum total coverage and a successful image build. The threshold is
a floor, not a goal: review scenarios and side effects.

Never submit personal databases, credentials or logs from real devices. Mark example
data as simulated. Changes to public interfaces or the schema need documentation and
a compatibility plan.

Contributions are accepted under [Apache-2.0](LICENSE).
