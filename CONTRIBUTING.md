# Contributing

See [README.md](README.md) to run the project. Use the Go version in go.mod, or
`make docker-check` to run the checks in a container. Run `make check` and
`make build` before opening a pull request.

Keep pull requests focused: the problem, the expected behaviour and how you verified
it. Behaviour changes need tests. Persistence tests use a real SQLite database in a
temporary directory; HTTP tests use httptest. CI enforces gofmt, go vet, the race
detector, 80% minimum total coverage and a successful image build. The threshold is
a floor, not a goal: review scenarios and side effects.

Never submit personal databases, credentials or logs from real devices. Mark example
data as simulated. Changes to public interfaces or the schema need documentation and
a compatibility plan.

Contributions are accepted under [Apache-2.0](LICENSE).
