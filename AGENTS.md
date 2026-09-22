# Development of Cajuí Central

Local monitoring server: receives readings over an HTTP API, stores them in SQLite
and shows them in an embedded web interface. Read README.md and docs/ before changing anything.

- Public name: Cajuí Central. Internal identifiers (module, packages, database,
  CAJUI_* variables) stay `cajui`; only the interface and documentation use the public name.
- Keep domain rules, transport and persistence separate. No unused abstractions.
- Document contracts and schema changes. Preserve existing readings and migrations.
- Never log tokens, never commit credentials, never expose the interface without authentication.
- Test behaviour, failures and persistence; coverage does not replace review.
- Run make check and make build (or make docker-check) before delivering code changes.
- Update docs/status.md with evidence and limitations; keep example data distinct from real readings.
- Documentation and commit messages describe this repository only.
- Everything in this repository is written in English.
