"""Catalog authoring rules and reproducible embedded assets."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import yaml

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("compile_locales", ROOT / "scripts/compile_locales.py")
compiler = importlib.util.module_from_spec(spec)
spec.loader.exec_module(compiler)


class LocaleCatalogs(unittest.TestCase):
    def test_generated_assets_are_current(self):
        for path, content in compiler.compile_catalogs().items():
            self.assertEqual(path.read_text(), content, path.name)

    def test_duplicate_or_invalid_yaml_keys_are_rejected(self):
        for source in ["name: A\nname: B", "1: numeric"]:
            with self.subTest(source=source), self.assertRaises(ValueError):
                yaml.load(source, Loader=compiler.CatalogLoader)

    def test_nested_keys_and_plain_text(self):
        self.assertEqual(compiler.flatten({"devices": {"title": "Transmissores", "count": {"one": "%{count} transmissor", "other": "%{count} transmissores"}}}), {"devices.title": "Transmissores", "devices.count.one": "%{count} transmissor", "devices.count.other": "%{count} transmissores"})
        for value in [{}, {"empty": ""}, {"number": 1}, {"value": None}, {"html": "<b>Title</b>"}, {"quote": 'Say "hi"'}, {"entity": "A &amp; B"}, {"script": "${value}"}, {"bad.key": "Title"}]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                compiler.flatten(value)

    def test_missing_keys_placeholders_and_plurals_fail_compilation(self):
        for base, translated in [
            ({"title": "Devices"}, {"other": "Transmissores"}),
            ({"title": "%{name}"}, {"title": "%{device}"}),
            ({"count": {"one": "%{count} device"}}, {"count": {"one": "%{count} transmissor"}}),
        ]:
            with self.subTest(base=base), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                (root / "locales").mkdir()
                for language, messages in zip(compiler.LOCALES, [base, translated]):
                    (root / "locales" / f"{language}.yml").write_text(yaml.safe_dump({language: messages}))
                with patch.object(compiler, "ROOT", root), self.assertRaises(ValueError):
                    compiler.compile_catalogs()

    def test_generated_output_is_json_and_javascript_not_executable_templates(self):
        outputs = compiler.compile_catalogs()
        data = json.loads(outputs[ROOT / "internal/httpapi/locales/catalogs.json"])
        self.assertEqual(set(data), {"en-US", "pt-BR"})
        self.assertEqual(data["pt-BR"]["registry.edit_name"], "Editar %{name}")
        self.assertNotIn("eval(", outputs[ROOT / "internal/httpapi/ui/catalogs.mjs"])


if __name__ == "__main__":
    unittest.main()
