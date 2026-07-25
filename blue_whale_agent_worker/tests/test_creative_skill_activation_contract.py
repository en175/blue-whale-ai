import json
import unittest
from pathlib import Path

import jsonschema

REPO_ROOT = Path(__file__).resolve().parents[2]
FIXTURES_DIR = REPO_ROOT / "docs" / "specs" / "fixtures" / "creative-skill-activation"


def _load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


class CreativeSkillActivationContractTest(unittest.TestCase):
    """锁定 Creative Skill 激活契约：同一 fixtures 在 Java / Python / TypeScript
    三端必须以相同 snake_case wire shape 通过或被拒。对齐
    docs/specs/2026-07-24-creative-skill-activation-contract.md（IK3NHU）。"""

    @classmethod
    def setUpClass(cls) -> None:
        cls.manifest = _load_json(FIXTURES_DIR / "manifest.json")
        schema_path = (FIXTURES_DIR / cls.manifest["schema"]).resolve()
        cls.schema = _load_json(schema_path)

    def _validator_for(self, def_name: str) -> jsonschema.Draft202012Validator:
        wrapper = {
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "$defs": self.schema["$defs"],
            "$ref": f"#/$defs/{def_name}",
        }
        return jsonschema.Draft202012Validator(wrapper)

    def test_valid_fixtures_conform(self) -> None:
        for entry in self.manifest["valid"]:
            with self.subTest(fixture=entry["file"]):
                fixture = _load_json(FIXTURES_DIR / entry["file"])
                errors = list(self._validator_for(entry["def"]).iter_errors(fixture))
                self.assertEqual([str(e) for e in errors], [])

    def test_invalid_fixtures_are_rejected(self) -> None:
        for entry in self.manifest["invalid"]:
            with self.subTest(fixture=entry["file"]):
                fixture = _load_json(FIXTURES_DIR / entry["file"])
                errors = list(self._validator_for(entry["def"]).iter_errors(fixture))
                self.assertNotEqual(errors, [])


if __name__ == "__main__":
    unittest.main()
