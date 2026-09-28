"""Check complete, checkout-local skill synchronization without running agents."""

import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "sync-implement-spec-skill.py"


class SyncImplementSpecSkillTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        subprocess.run(["git", "init", "-q", self.root], check=True)
        self.source = self.root / ".claude/skills/implement-spec"
        self.contents = {
            "SKILL.md": "---\nname: implement-spec\ndescription: Implement a spec.\n---\n",
            "references/worktrees.md": "Worktree instructions\n",
            "references/delivery.md": "Delivery instructions\n",
            "agents/openai.yaml": "policy:\n  allow_implicit_invocation: false\n",
        }
        for rel, content in self.contents.items():
            self.write(self.source / rel, content)

    def write(self, path, content):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")

    def invoke(self, *args):
        return subprocess.run([sys.executable, SCRIPT, *args], cwd=self.root,
                              capture_output=True, text=True)

    def test_check_and_dry_run_do_not_write_missing_targets(self):
        self.assertEqual(self.invoke("--check").returncode, 1)
        self.assertEqual(self.invoke("--dry-run").returncode, 0)
        self.assertFalse((self.root / ".agents").exists())
        self.assertFalse((self.root / ".qoder").exists())

    def test_sync_includes_references_and_policy_and_detects_stale_copy(self):
        unrelated = self.root / ".agents/skills/another/SKILL.md"
        self.write(unrelated, "Unrelated\n")
        optional = self.root / ".kimi-code/skills/implement-spec/SKILL.md"
        self.write(optional, "Old Kimi copy\n")
        result = self.invoke()
        self.assertEqual(result.returncode, 0, result.stderr)
        for directory in (".zcode", ".agents", ".qoder", ".kimi-code"):
            for rel, content in self.contents.items():
                self.assertEqual((self.root / directory / "skills/implement-spec" / rel).read_text(), content)
        self.assertEqual(unrelated.read_text(), "Unrelated\n")
        self.assertEqual(self.invoke("--check").returncode, 0)
        stale = self.root / ".qoder/skills/implement-spec/references/delivery.md"
        stale.write_text("Stale\n")
        self.assertEqual(self.invoke("--check").returncode, 1)
        self.assertEqual(stale.read_text(), "Stale\n")
        self.assertEqual(self.invoke().returncode, 0)
        self.assertEqual(self.invoke("--check").returncode, 0)

    def test_extra_target_files_stop_before_any_copy(self):
        extra = self.root / ".qoder/skills/implement-spec/local-notes.md"
        self.write(extra, "Keep me\n")
        result = self.invoke()
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((self.root / ".zcode").exists())
        self.assertFalse((self.root / ".agents").exists())
        self.assertEqual(extra.read_text(), "Keep me\n")

    def test_symlinked_target_is_not_followed(self):
        outside = self.root / "outside"
        outside.mkdir()
        (self.root / ".agents").symlink_to(outside, target_is_directory=True)
        result = self.invoke()
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((self.root / ".zcode").exists())
        self.assertEqual(list(outside.iterdir()), [])

    def test_path_type_conflicts_stop_before_any_copy(self):
        target = self.root / ".qoder/skills/implement-spec"
        for rel in ("", "references", "SKILL.md"):
            with self.subTest(path=rel):
                conflict = target / rel
                if rel == "SKILL.md":
                    conflict.mkdir(parents=True)
                else:
                    self.write(conflict, "Keep me\n")
                result = self.invoke()
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse((self.root / ".zcode").exists())
                self.assertFalse((self.root / ".agents").exists())
                if conflict.is_dir():
                    self.assertEqual(list(conflict.iterdir()), [])
                    conflict.rmdir()
                else:
                    self.assertEqual(conflict.read_text(), "Keep me\n")
                    conflict.unlink()


if __name__ == "__main__":
    unittest.main()
