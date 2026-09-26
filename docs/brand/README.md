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

## Dashboard density

Product dashboard sections use an `auto-fill` grid with 260 px minimum columns and
12 px gutters. A device or individual measurement occupies one column; a sensor
with multiple measurements spans two columns when the section is at least 532 px
wide. This accommodates four measurements across at 1076 px of available section
width, without stretching a single two-measurement sensor across the entire page.
Smaller screens reflow the groups and measurements. Group headers share one compact
row when names fit; sensor cards have no extra padding around their inner cards.
Reading values, quantity colors, status labels, keyboard access and touch targets
retain their existing treatment.

The reference is Home Assistant's [Sections grid](https://www.home-assistant.io/dashboards/sections/)
and its [grid design explanation](https://www.home-assistant.io/blog/2024/03/04/dashboard-chapter-1/).
Central preserves configured reading order instead of applying dense auto-placement,
which can move later cards into earlier gaps. Unoccupied columns are available for
additional registered items; the dashboard never invents readings to fill them.
