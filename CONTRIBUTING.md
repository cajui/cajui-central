# Contributing

See README.md to run the project. Use the Go version declared in go.mod, or
`make docker-check` to run the same checks in a container without a local Go.
Run `make check` and `make build` before proposing changes.

Keep pull requests focused: problem, expected behaviour and validation evidence.
Behaviour changes must include relevant tests. Persistence tests use a real SQLite
database in a temporary directory; HTTP tests use httptest.
CI requires formatting, go vet, the race detector, a minimum total coverage of 80%
and a successful Docker image build.
That threshold is a starting point: reviewing scenarios and side effects remains mandatory.

Do not submit personal databases, credentials or logs from real devices. Examples
must be identified as simulated data. Public interfaces and schema changes require
documentation and a compatibility plan.

Code is under Apache-2.0. Contributions must be compatible with that license.
Repository: https://github.com/romulostorel/cajui-central. Issues and pull requests on GitHub.
