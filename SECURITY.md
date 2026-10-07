# Security

Early-stage software for local use. There is no login, TLS, roles or session policy
yet, so do not expose it through a proxy or tunnel. The web page and `/healthz` are
open to anyone on the machine; the API requires a Bearer token.

The binary binds loopback addresses only. `CAJUI_ALLOW_NON_LOOPBACK=1` lifts that
restriction for containers, where `compose.yaml` publishes the port on the host's
`127.0.0.1` only. Never set the variable outside a container and never publish the
dashboard port on `0.0.0.0`.

The Compose broker listens on every interface so devices on the network can publish.
It requires authentication and per-user ACLs, but traffic is plain MQTT: passwords and
samples are readable on the network. Use it on a trusted network, or set
`CAJUI_MQTT_BIND=127.0.0.1`, until TLS is configured.

Compose generates random credentials on first start and stores them unencrypted in the
`secrets` volume. Anyone who controls Docker on the host can read them. Never share a
token or password in issues, logs or screenshots.

Reporting: private vulnerability reporting is not enabled yet. Contact the maintainer
directly; do not open a public issue for a vulnerability. Dependabot proposes
dependency updates; CI does not replace security review.

The interface runs same-origin JavaScript modules and local styles/fonts. The CSP
blocks inline executable scripts, evaluation, external resources and framing. The
HTML snapshot contains telemetry and a separate local editing capability, never
an API token. Scripts refresh
that same loopback-only document; authenticated API access remains separate.
Component text is escaped, and spreadsheet exports protect text fields from formula
interpretation. Browser storage contains only the selected color theme.

The optional brand reference server binds only to loopback and exposes a fixed map
of reference and shared UI files. It has no Central APIs, credentials, configuration
files or repository directory listing. Reference pages and simulated data are not
embedded in the Central executable or served by the product.


Local workspace edits are intentionally available to trusted users of the same
machine. Page routes reject non-loopback Host values. Editing endpoints under
`/ui-api/` additionally require an exact same-origin Origin, JSON content type,
a process-scoped capability in `X-Cajui-Workspace`, and non-cross-site fetch metadata
when present. There is no CORS opt-in. The capability is distinct from the ingestion
API token, is not stored in browser storage, and expires on restart. These checks
address cross-site requests and DNS rebinding; they do not authenticate local users
or provide isolation from malicious software already running on the machine.

Registration names and layout titles are bounded and rendered as text. Request
bodies are capped at 64 KiB and unknown fields are rejected. Revision checks prevent
lost updates from stale browser windows. Removing a dashboard item does not delete
stored telemetry. Schema migrations and telemetry/inventory updates are transactional;
keep a pre-upgrade backup because schema downgrades are unsupported.
