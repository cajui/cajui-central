# Security

Bootstrap for local development. The executable binds loopback only, except with
`CAJUI_ALLOW_NON_LOOPBACK=1`, which exists for containers: there the restriction moves
to port publication, which `compose.yaml` does on the host's `127.0.0.1` only. Never
publish on `0.0.0.0` and never use that variable outside a container.
The dashboard and the health check are open to anyone on the machine; the API requires
a Bearer token. Do not expose it through a proxy or tunnel: there is no login, TLS,
roles or session policy yet.

Tokens must be generated randomly and passed through environment variables.
Never share the token in issues, logs or screenshots. A private reporting channel and a
supported-versions policy are not defined on GitHub yet. For now, report directly to
the project maintainer without disclosing sensitive details.

Dependency updates are proposed by Dependabot on GitHub. CI does not replace security
review or dependency auditing.
