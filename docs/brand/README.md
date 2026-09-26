# Cajuí visual identity

This is development documentation, separate from the Central product. It contains
brand foundations, a component reference, explicitly simulated examples and the
research behind the visual choices. It is not included in the Central executable
or exposed through its routes or navigation.

From the repository root, run:

```sh
python3 scripts/serve_brand.py
```

Open http://127.0.0.1:8092/design/brand. Python uses only its standard library;
there is no compilation step. This optional documentation tool is not required
to install or run Central. The server binds to loopback and serves only reference
files and shared UI assets, not configuration files or the repository directory.

| Reference | Path |
| --- | --- |
| Brand, tokens, typography and contrast | `/design/brand` |
| Component examples and data states | `/design/components` |
| Simulated measurement gallery | `/design/dashboard` |
| Research and product boundaries | `/design/research` |

The gallery is a component composition study, not Central's information architecture.
The product groups **devices → sensors → measurements** and keeps radio diagnostics
in device details. Friendly names and locations in examples are simulated.

Product components, tokens, icons and the licensed font are loaded directly from
`internal/httpapi/ui/`. Their source is shared; this reference does not maintain a
second implementation. Reference-only styles, example data and page code live here.
Keep examples clearly labeled and never publish them into a real telemetry stream.
