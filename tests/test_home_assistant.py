"""Validate example templates against the wire contract, without a running HA server."""
import copy
import json
from pathlib import Path
import unittest

from jinja2 import Environment, StrictUndefined
import yaml

ROOT = Path(__file__).resolve().parents[1]


class HomeAssistantTemplates(unittest.TestCase):
    def setUp(self):
        self.config = yaml.safe_load((ROOT / 'examples/mqtt/home-assistant.yaml').read_text())
        self.sample = json.loads((ROOT / 'examples/mqtt/sample.json').read_text())
        self.env = Environment(undefined=StrictUndefined)

    def render(self, sensor, key, sample):
        return self.env.from_string(sensor[key]).render(value_json=sample).strip()

    def test_values_and_order(self):
        for sensor in self.config['mqtt']['sensor']:
            metric = sensor['device_class']
            reading = next(r for r in self.sample['readings'] if r['metric'] == metric)
            self.assertEqual(float(self.render(sensor, 'value_template', self.sample)), reading['value'])
            self.assertEqual(self.render(sensor, 'availability_template', self.sample), 'online')
            self.assertEqual(sensor['expire_after'], self.sample['expected_interval_seconds'] * 3)
            self.assertEqual(sensor['state_topic'], 'telemetry/v1/demo-source/demo-device/samples')
            self.sample['readings'].reverse()
            self.assertEqual(float(self.render(sensor, 'value_template', self.sample)), reading['value'])

    def test_error_skipped_missing_and_zero(self):
        for sensor in self.config['mqtt']['sensor']:
            for status in ('error', 'skipped', 'missing', 'zero'):
                with self.subTest(metric=sensor['device_class'], status=status):
                    sample = copy.deepcopy(self.sample)
                    reading = next(r for r in sample['readings'] if r['metric'] == sensor['device_class'])
                    if status == 'missing':
                        sample['readings'].remove(reading)
                    elif status == 'zero':
                        reading['value'] = 0
                    else:
                        reading['status'] = status
                        del reading['value']
                    self.assertEqual(self.render(sensor, 'availability_template', sample), 'online' if status == 'zero' else 'offline')
                    self.assertEqual(self.render(sensor, 'value_template', sample), '0' if status == 'zero' else 'None')


if __name__ == '__main__':
    unittest.main()
