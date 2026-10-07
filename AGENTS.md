# Development of Cajuí Central

Local monitoring server: receives readings over an HTTP API, stores them in SQLite
and shows them in an embedded web interface. Read README.md before changing anything.

- Public name: Cajuí Central. Internal identifiers (module, packages, database,
  CAJUI_* variables) stay `cajui`; only the interface and documentation use the public name.
- Keep domain rules, transport and persistence separate. No unused abstractions.
- Document contract and schema changes in README.md. Preserve existing readings and migrations.
- Never log tokens, never commit credentials, never expose the interface without authentication.
- Test behaviour, failures and persistence; coverage does not replace review.
- Run `make check` and `make build` (or `make docker-check`) before submitting changes.
- Keep example data distinct from real readings.
- Documentation and commit messages describe this repository only.
- Code, comments, documentation and commit messages are written in English.
- Product UI copy lives in `locales/en-US.yml` and `locales/pt-BR.yml`; translated
  catalog values and localization assertions use their target language.
- Preserve API identifiers and user-provided names across locale changes.
- After editing catalogs, run `scripts/compile_locales.py`, commit its generated
  assets, and check catalog parity. See `docs/localization.md`.
