import pathlib
import shutil
import subprocess
import sys
import tempfile
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts" / "check-schema-charset.py"


def run_script(repo_root: pathlib.Path) -> subprocess.CompletedProcess:
    script_copy = repo_root / "scripts" / "check-schema-charset.py"
    script_copy.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy(SCRIPT, script_copy)
    return subprocess.run(
        [sys.executable, str(script_copy)],
        capture_output=True,
        text=True,
        encoding="utf-8",
    )


class CheckSchemaCharsetTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.repo = pathlib.Path(self._tmp.name)
        self.schema_dir = self.repo / "backend" / "prisma" / "schema"
        self.schema_dir.mkdir(parents=True)

    def test_all_files_declare_charset_passes(self):
        (self.schema_dir / "001_baseline.sql").write_text(
            "SET NAMES utf8mb4;\nCREATE TABLE t (id INT);\n", encoding="utf-8"
        )
        (self.schema_dir / "002_seed.sql").write_text(
            "SET NAMES utf8mb4;\nINSERT INTO t VALUES (1);\n", encoding="utf-8"
        )
        result = run_script(self.repo)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_missing_charset_fails_and_lists_file(self):
        (self.schema_dir / "001_baseline.sql").write_text(
            "SET NAMES utf8mb4;\nCREATE TABLE t (id INT);\n", encoding="utf-8"
        )
        (self.schema_dir / "002_seed.sql").write_text(
            "INSERT INTO t VALUES (1);\n", encoding="utf-8"
        )
        result = run_script(self.repo)
        self.assertEqual(result.returncode, 1)
        self.assertIn("002_seed.sql", result.stderr)

    def test_real_repo_schema_passes(self):
        result = subprocess.run(
            [sys.executable, str(SCRIPT)], capture_output=True, text=True, encoding="utf-8"
        )
        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main()
