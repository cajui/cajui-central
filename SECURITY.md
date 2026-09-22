# Security

Early-stage software for local use. There is no login, TLS, roles or session policy
yet, so do not expose it through a proxy or tunnel. The web page and `/healthz` are
open to anyone on the machine; the API requires a Bearer token.

The binary binds loopback addresses only. `CAJUI_ALLOW_NON_LOOPBACK=1` lifts that
restriction for containers, where `compose.yaml` publishes the port on the host's
`127.0.0.1` only. Never set the variable outside a container and never publish the
port on `0.0.0.0`.

Generate tokens randomly and pass them through environment variables. Never share a
token in issues, logs or screenshots.

Reporting: private vulnerability reporting is not enabled yet. Contact the maintainer
directly; do not open a public issue for a vulnerability. Dependabot proposes
dependency updates; CI does not replace security review.
