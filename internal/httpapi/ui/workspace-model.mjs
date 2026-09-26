import { t, metricLabel } from "./i18n.mjs";
import {
  buildChannels,
  buildDeviceGroups,
  isLinkDiagnostic,
  label,
  channelState,
} from "./model.mjs";

export function workspaceGroups(state, now = Date.parse(state.generated_at)) {
  const channels = buildChannels(state, now);
  const catalog = state.workspace;
  if (!catalog) return buildDeviceGroups(channels, state.devices ?? []);
  const byDevice = new Map(catalog.devices.map((d) => [d.id, d]));
  const byKey = new Map(channels.map((c) => [c.key, c]));
  for (const sensor of catalog.sensors) {
    const device = byDevice.get(sensor.device_id);
    if (!device) continue;
    for (const m of sensor.measurements) {
      const key = JSON.stringify([
        device.transport,
        device.source,
        device.device,
        sensor.sensor,
        m.metric,
        m.unit,
      ]);
      const old = byKey.get(key);
      if (old && Date.parse(old.at) >= Date.parse(m.received_at)) continue;
      const c = {
        key,
        transport: device.transport,
        source: device.source,
        device: device.device,
        sensor: sensor.sensor,
        metric: m.metric,
        unit: m.unit,
        title: metricLabel(m.metric, label(m.metric)),
        value: m.value,
        state: channelState(m, m.received_at, m.interval, now),
        at: m.received_at,
        interval: m.interval,
        latestTime: Date.parse(m.received_at),
        points: [
          ...(old?.points ?? []),
          {
            time: Date.parse(m.received_at),
            value: m.status === "ok" ? m.value : null,
          },
        ],
      };
      byKey.set(key, c);
    }
  }
  const groups = buildDeviceGroups([...byKey.values()]);
  for (const g of groups) {
    const d = catalog.devices.find(
      (d) =>
        d.transport === g.transport &&
        d.source === g.source &&
        d.device === g.device,
    );
    if (!d) continue;
    Object.assign(g, {
      registryID: d.id,
      registered: !!d.name,
      name: d.name || d.device,
      location: d.location,
      at: d.received_at,
      interval: d.interval,
      stale:
        d.interval > 0 && now - Date.parse(d.received_at) >= d.interval * 3000,
    });
    for (const s of g.sensors) {
      const record = catalog.sensors.find(
        (s2) => s2.device_id === d.id && s2.sensor === s.id,
      );
      Object.assign(s, {
        registryID: record?.id,
        registered: !!record?.name,
        name: record?.name || label(s.id),
        location: record?.location || "",
      });
      for (const c of s.channels) {
        c.deviceName = g.name;
        c.sensorName = s.name;
      }
    }
    g.attention =
      g.stale ||
      g.error ||
      g.sensors.some((s) =>
        s.channels.some((c) =>
          ["stale", "error", "skipped", "empty"].includes(c.state),
        ),
      );
  }
  return groups.sort(
    (a, b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key),
  );
}
export function registeredGroups(groups) {
  return groups
    .filter((g) => g.registered)
    .map((g) => ({ ...g, sensors: g.sensors.filter((s) => s.registered) }));
}
export function environmentalSensors(catalog) {
  return catalog.sensors.filter((s) =>
    s.measurements.some((m) => !isLinkDiagnostic({ sensor: s.sensor, ...m })),
  );
}
export function automaticSections(catalog) {
  const sensors = environmentalSensors(catalog)
    .filter((s) => s.name)
    .map((s) => ({ kind: "sensor", sensor_id: s.id }));
  const devices = catalog.devices
    .filter((d) => d.name)
    .map((d) => ({ kind: "device", device_id: d.id }));
  return [
    ...(sensors.length ? [{ title: t("common.sensors"), items: sensors }] : []),
    ...(devices.length ? [{ title: t("common.devices"), items: devices }] : []),
  ];
}
export function itemChoices(catalog) {
  const devices = new Map(catalog.devices.map((d) => [d.id, d]));
  return [
    ...catalog.devices
      .filter((d) => d.name)
      .map((d) => ({
        label: t("layout.device_choice", { name: d.name }),
        item: { kind: "device", device_id: d.id },
      })),
    ...environmentalSensors(catalog)
      .filter((s) => s.name)
      .flatMap((s) => [
        {
          label: t("layout.sensor_choice", {
            name: s.name,
            device: devices.get(s.device_id)?.name,
          }),
          item: { kind: "sensor", sensor_id: s.id },
        },
        ...s.measurements
          .filter((m) => !isLinkDiagnostic({ sensor: s.sensor, ...m }))
          .map((m) => ({
            label: `${metricLabel(m.metric, label(m.metric))} (${m.unit}) · ${s.name} · ${devices.get(s.device_id)?.name}`,
            item: {
              kind: "measurement",
              sensor_id: s.id,
              metric: m.metric,
              unit: m.unit,
            },
          })),
      ]),
  ];
}
export function resolveItem(item, groups) {
  if (item.kind === "device") {
    const group = groups.find(
      (g) => g.registryID === item.device_id && g.registered,
    );
    return group ? { group } : null;
  }
  for (const group of groups) {
    const sensor = group.sensors.find(
      (s) => s.registryID === item.sensor_id && s.registered,
    );
    if (sensor) {
      const channels =
        item.kind === "measurement"
          ? sensor.channels.filter(
              (c) => c.metric === item.metric && c.unit === item.unit,
            )
          : sensor.channels;
      return channels.length ? { group, sensor, channels } : null;
    }
  }
  return null;
}
