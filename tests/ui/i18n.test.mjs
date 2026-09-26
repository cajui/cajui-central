import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import {
  t,
  setLocale,
  locale,
  supportedLocales,
} from "../../internal/httpapi/ui/i18n.mjs";
import catalogs from "../../internal/httpapi/ui/catalogs.mjs";
import {
  age,
  states,
  formatValue,
  measurementLabel,
  buildChannels,
  csvRows,
  escapeHTML,
} from "../../internal/httpapi/ui/model.mjs";
import {
  automaticSections,
  workspaceGroups,
} from "../../internal/httpapi/ui/workspace-model.mjs";
import {
  saveWorkspace,
  localizeValidation,
} from "../../internal/httpapi/ui/workspace-api.mjs";

afterEach(() => setLocale("en-US"));

test("catalogs have identical keys and placeholders and match embedded Go assets", () => {
  const embedded = JSON.parse(
    readFileSync(
      new URL("../../internal/httpapi/locales/catalogs.json", import.meta.url),
    ),
  );
  assert.deepEqual(catalogs, embedded);
  const keys = Object.keys(catalogs["en-US"]).sort();
  for (const lang of supportedLocales) {
    assert.deepEqual(Object.keys(catalogs[lang]).sort(), keys);
    for (const key of keys) {
      const variables = (message) =>
        [...message.matchAll(/%\{([a-z_]+)\}/g)].map((m) => m[1]).sort();
      assert.deepEqual(
        variables(catalogs[lang][key]),
        variables(catalogs["en-US"][key]),
        key,
      );
    }
  }
});

test("all literal UI translation keys exist, including server fallback labels", () => {
  const directory = new URL("../../internal/httpapi/ui/", import.meta.url);
  const sources = readdirSync(directory)
    .filter((name) => name.endsWith(".mjs") && name !== "catalogs.mjs")
    .map((name) => readFileSync(new URL(name, directory), "utf8"));
  sources.push(
    readFileSync(
      new URL("../../internal/httpapi/index.html", import.meta.url),
      "utf8",
    ),
  );
  for (const source of sources) {
    for (const match of source.matchAll(/(?:\bt\(|\$\.Text )"([a-z_.]+)"/g)) {
      assert.ok(
        Object.hasOwn(catalogs["en-US"], match[1]) ||
          Object.hasOwn(catalogs["en-US"], match[1] + ".other"),
        match[1],
      );
    }
  }
});

test("supported locales, fallback, CLDR plurals and literal interpolation", () => {
  setLocale("pt-BR");
  assert.equal(locale(), "pt-BR");
  assert.equal(t("common.devices"), "Transmissores");
  assert.equal(t("counts.devices", { count: 1 }), "1 transmissor");
  assert.equal(t("counts.devices", { count: 2 }), "2 transmissores");
  // An explicit zero message overrides CLDR when the wording needs a plural.
  assert.equal(t("counts.devices", { count: 0 }), "0 transmissores");
  const name = '<img src=x onerror="alert(1)"> %{device} $&';
  assert.equal(t("registry.edit_name", { name }), `Editar ${name}`);
  assert.ok(!escapeHTML(t("registry.edit_name", { name })).includes("<img"));
  assert.equal(t("missing.key"), "missing.key");
  assert.equal(t("constructor"), "constructor");
  assert.equal(t("__proto__"), "__proto__");
  setLocale("../../secrets");
  assert.equal(locale(), "en-US");
  assert.equal(t("counts.devices", { count: 0 }), "0 devices");
  assert.equal(t("counts.devices", { count: 1 }), "1 device");
});

test("values, age, states and known metrics follow the chosen language", () => {
  const now = Date.parse("2026-01-02T12:00:00Z");
  for (const [lang, value, minute, state, metric] of [
    ["en-US", "1,234.5", "1 min ago", "Reading error", "Temperature"],
    ["pt-BR", "1.234,5", "Há 1 min", "Erro de leitura", "Temperatura"],
  ]) {
    setLocale(lang);
    assert.equal(formatValue(1234.5), value);
    assert.equal(formatValue(null), "—");
    assert.equal(age(new Date(now - 60000).toISOString(), now), minute);
    assert.equal(age("invalid", now), t("age.unknown"));
    assert.equal(states.error, state);
    assert.equal(measurementLabel("temperature"), metric);
    assert.equal(measurementLabel("custom_quantity"), "Custom quantity");
    assert.equal(measurementLabel("constructor"), "Constructor");
    assert.equal(measurementLabel("rssi"), "RSSI");
  }
});

test("language changes preserve identities, user names, custom sections and CSV", () => {
  const state = {
    generated_at: "2026-01-02T12:00:00Z",
    readings: [
      {
        node_id: "temperature",
        sensor_id: "humidity",
        metric: "temperature",
        unit: "degC",
        value: 24.5,
        received_at: "2026-01-02T11:59:00Z",
      },
    ],
    workspace: {
      devices: [
        {
          id: 1,
          transport: "http",
          source: "HTTP",
          device: "temperature",
          name: "Devices <custom>",
          location: "Sensors",
          received_at: "2026-01-02T11:59:00Z",
          interval: 0,
        },
      ],
      sensors: [
        {
          id: 2,
          device_id: 1,
          sensor: "humidity",
          name: "Temperature",
          location: "North",
          measurements: [
            {
              metric: "temperature",
              unit: "degC",
              value: 24.5,
              status: "ok",
              received_at: "2026-01-02T11:59:00Z",
              interval: 0,
            },
          ],
        },
      ],
      layout: {
        revision: 1,
        sections: [
          { title: "Sensors", items: [{ kind: "sensor", sensor_id: 2 }] },
        ],
      },
    },
  };
  const original = structuredClone(state);
  const english = buildChannels(state);
  const csv = csvRows(english);
  setLocale("pt-BR");
  const portuguese = buildChannels(state);
  assert.equal(portuguese[0].title, "Temperatura");
  assert.equal(portuguese[0].key, english[0].key);
  assert.equal(csvRows(portuguese), csv);
  const groups = workspaceGroups(state);
  assert.equal(groups[0].name, "Devices <custom>");
  assert.equal(groups[0].location, "Sensors");
  assert.equal(groups[0].sensors[0].name, "Temperature");
  assert.equal(automaticSections(state.workspace)[0].title, "Sensores");
  assert.deepEqual(state, original);
});

test("workspace save errors are localized without changing the request contract", async (context) => {
  const calls = [];
  for (const status of [400, 403, 409, 500]) {
    context.mock.method(globalThis, "fetch", async (url, options) => {
      calls.push({ url, options });
      return { ok: false, status };
    });
    setLocale("pt-BR");
    const key = {
      400: "invalid",
      403: "session",
      409: "conflict",
      500: "save",
    }[status];
    await assert.rejects(
      saveWorkspace({ ui_token: "test-only" }, "devices/1", {
        name: "My device",
        revision: 2,
      }),
      { message: t(`errors.${key}`) },
    );
    const request = calls.at(-1);
    assert.equal(request.url, "/ui-api/devices/1");
    assert.equal(request.options.method, "PUT");
    assert.deepEqual(JSON.parse(request.options.body), {
      name: "My device",
      revision: 2,
    });
    context.mock.restoreAll();
  }
  context.mock.method(globalThis, "fetch", async () => {
    throw new TypeError("Failed to fetch");
  });
  await assert.rejects(saveWorkspace({}, "devices/1", {}), {
    message: t("errors.save"),
  });
});

test("native validation messages follow the application locale and clear after editing", () => {
  setLocale("pt-BR");
  const handlers = new Map();
  const form = {
    addEventListener: (name, handler) => handlers.set(name, handler),
  };
  localizeValidation(form);
  const input = {
    validity: { valueMissing: true },
    setCustomValidity: (message) => {
      input.message = message;
    },
  };
  handlers.get("invalid")({ target: input });
  assert.equal(input.message, "Preencha este campo.");
  handlers.get("input")({ target: input });
  assert.equal(input.message, "");
  input.validity = { tooLong: true };
  input.maxLength = 80;
  handlers.get("invalid")({ target: input });
  assert.equal(input.message, "Use no máximo 80 caracteres.");
});
