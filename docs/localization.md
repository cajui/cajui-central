# Localization

Central supports Brazilian Portuguese (`pt-BR`) and US English (`en-US`). The
language selector is in the application header. Menus, registration, dashboard
composition, reading states, chart controls, validation messages and accessible
labels use the selected language. The server-rendered fallback is translated too.

Language selection applies to the browser, not the shared workspace:

1. An allowlisted `?lang=pt-BR` or `?lang=en-US` selection wins and stores a
   `cajui-locale` cookie for one year. Values are case-insensitive and canonicalized.
2. An existing valid preference cookie wins over the browser language.
3. Supported English/Portuguese entries in `Accept-Language` are considered by
   quality weight, preserving order on ties. Regional variants use the supported
   language variant. Unsupported or invalid entries are ignored.
4. The fallback is `en-US`.

The preference cookie is `HttpOnly`, `SameSite=Lax`, scoped to `/` and `Secure` on
HTTPS. It contains only a locale, not credentials. Without cookies, an explicit
language URL still works for that page; the preference will not persist across
ordinary navigation. Responses declare `Content-Language`, `Vary` and `html lang`.
The local Host boundary, CSP and workspace write permissions are unchanged.

## Catalogs

Edit [`locales/en-US.yml`](../locales/en-US.yml) and
[`locales/pt-BR.yml`](../locales/pt-BR.yml). They use a Rails-like structure:
locale root, nested semantic keys, `%{name}` interpolation and plural messages.
This is a small application-specific contract, not a full Rails I18n implementation.

```yaml
en-US:
  counts:
    sensors:
      zero: "%{count} sensors"
      one: "%{count} sensor"
      other: "%{count} sensors"
```

JavaScript calls `t("counts.sensors", { count: 2 })`. An explicit `zero` message
wins for zero, then `Intl.PluralRules` chooses the CLDR category, with `other` as
fallback. Missing translations fall back to English, then the key. Avoid sentence
fragments and English-specific concatenated plurals. Catalogs contain **plain
text**, never markup; escape the entire interpolated result when inserting HTML.
User-supplied names must be interpolation values, never translation keys.

Browser numbers, dates and times use `Intl` with the selected locale. Charts use
the browser's local time zone, with compact 24-hour axis labels. The no-JavaScript
table keeps explicitly labelled
UTC, using locale-specific decimal separators and date order. Metric IDs and
status codes are translated only for display. Unknown quantities retain their
existing labels. Names, locations and custom section titles are user content and
stay unchanged; automatic section headings follow the language. Saving a customized
layout makes its section titles user content, including headings copied from the
automatic layout.

API responses, logs, telemetry identifiers, units and CSV data remain stable and
language-neutral. CSV headers remain English for compatibility. There is no database
migration. Repository documentation and the standalone brand reference remain in
English; the reference shares the same components with English as their default.

## Updating translations

YAML is the sole authored source. A development script validates both catalogs and
produces committed JSON for Go and an ES module for the browser. The Go executable
embeds the JSON; the browser imports the module as a local asset. Both artifacts
are generated together and checked in CI. They are not hand-maintained copies.
Neither installation nor `go build` needs Python, Node, a YAML parser or a frontend
build. Only contributors changing catalogs need the optional Python dependency:

```sh
python3 -m venv .venv
.venv/bin/pip install -r scripts/requirements-locales.txt
.venv/bin/python scripts/compile_locales.py
.venv/bin/python scripts/compile_locales.py --check
.venv/bin/python -m unittest discover -s tests -p test_locales.py -v
npm --prefix tests/ui run test:model
```

Commit both YAML sources and generated artifacts. The generator rejects duplicate
keys, invalid values, markup, mismatched keys/placeholders and missing plural
fallbacks. The Node suite checks catalog parity with Go, display formatting, fallback,
interpolation, stable identities/CSV and localized save failures. Go tests cover
request negotiation, cookies, fallback HTML and access boundaries. Playwright
covers switching languages, navigation, Portuguese registration, chart labels,
layout editing and responsive accessibility in both languages; run it against an
isolated Central instance as described in the main README.

To add a language, add the catalog and explicit locale allowlist/selector entries,
then add negotiation and end-to-end tests. A new plural category can be represented
as another message key; all catalogs must keep matching keys. No third-party
translation services or runtime network dependencies are used.
