// Explicitly simulated fixtures. Never posted to an API or persisted as telemetry.
export function demoData(now = Date.now()) {
  const devices = [
    {
      source_id: "demo-hub",
      device_id: "climate-01",
      name: "Climate sensor",
      location: "Greenhouse",
      battery: 86,
      signal: -72,
      last_received_at: new Date(now - 60000).toISOString(),
      expected_interval_seconds: 1800,
      stale: false,
      sensor_error: false,
    },
    {
      source_id: "demo-hub",
      device_id: "air-02",
      name: "Air quality sensor",
      location: "Workspace",
      battery: 92,
      signal: -65,
      last_received_at: new Date(now - 60000).toISOString(),
      expected_interval_seconds: 1800,
      stale: false,
      sensor_error: false,
    },
    {
      source_id: "demo-hub",
      device_id: "soil-03",
      name: "Soil sensor",
      location: "Greenhouse",
      battery: 18,
      signal: -87,
      last_received_at: new Date(now - 60000).toISOString(),
      expected_interval_seconds: 1800,
      stale: false,
      sensor_error: true,
    },
    {
      source_id: "demo-hub",
      device_id: "entry-04",
      name: "Entry sensor",
      location: "Entryway",
      battery: null,
      signal: null,
      last_received_at: new Date(now - 5400000).toISOString(),
      expected_interval_seconds: 1800,
      stale: true,
      sensor_error: false,
    },
  ];
  const samples = [];
  for (let i = 0; i < 49; i++) {
    const at = new Date(now - 60000 - (48 - i) * 1800000).toISOString();
    const temperature =
      24.6 +
      Math.sin((i - 48) / 7) * 2.1 +
      (Math.cos((i - 48) / 2.5) - 1) * 0.4;
    const humidity = 62 + Math.sin((i - 48) / 9) * 7;
    samples.push({
      version: 1,
      source_id: "demo-hub",
      device_id: "climate-01",
      sample_id: `demo.${i}`,
      received_at: at,
      expected_interval_seconds: 1800,
      readings: [
        {
          sensor_id: "ambient",
          metric: "temperature",
          value: i === 48 ? 24.6 : temperature,
          unit: "degC",
          status: "ok",
        },
        {
          sensor_id: "ambient",
          metric: "humidity",
          value: i === 48 ? 62 : humidity,
          unit: "%",
          status: "ok",
        },
      ],
    });
    samples.push({
      version: 1,
      source_id: "demo-hub",
      device_id: "air-02",
      sample_id: `demo.${i}`,
      received_at: at,
      expected_interval_seconds: 1800,
      readings: [
        {
          sensor_id: "air",
          metric: "co2",
          value: i === 48 ? 684 : 684 + Math.sin((i - 48) / 4) * 85,
          unit: "ppm",
          status: "ok",
        },
      ],
    });
    samples.push({
      version: 1,
      source_id: "demo-hub",
      device_id: "soil-03",
      sample_id: `demo.${i}`,
      received_at: at,
      expected_interval_seconds: 1800,
      readings: [
        {
          sensor_id: "soil",
          metric: "soil_moisture",
          value: i > 45 ? null : 40 + Math.sin(i / 8) * 5,
          unit: "%",
          status: i > 45 ? "error" : "ok",
        },
      ],
    });
  }
  return {
    samples,
    readings: [],
    devices,
    generated_at: new Date(now).toISOString(),
  };
}
