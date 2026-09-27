"""Check project skill delivery in a fresh Git worktree."""

import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


CHECKER = Path(__file__).resolve().parents[1] / "check-project-skills.py"


def run(*args, cwd, home=None, check=True):
    result = subprocess.run(
        [str(arg) for arg in args], cwd=cwd, text=True, capture_output=True,
        env={**os.environ, **({"HOME": str(home)} if home else {}), "PYTHONDONTWRITEBYTECODE": "1"},
    )
    if check and result.returncode:
        raise AssertionError(f"{args}: {result.stdout}\n{result.stderr}")
    return result


class ProjectSkillsTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.main = self.root / "main"
        self.worktree = self.root / "new-worktree"
        self.home = self.root / "home"
        self.main.mkdir()
        self.home.mkdir()
        run("git", "init", "-b", "main", cwd=self.main)
        run("git", "config", "user.name", "Skill Test", cwd=self.main)
        run("git", "config", "user.email", "skill-test@example.com", cwd=self.main)
        run("git", "config", "core.hooksPath", "/dev/null", cwd=self.main)
        skill = self.main / ".agents/skills/example"
        (skill / "references").mkdir(parents=True)
        (skill / "SKILL.md").write_text("# Example\n", encoding="utf-8")
        (skill / "references/details.md").write_text("details\n", encoding="utf-8")
        (self.main / ".claude").mkdir()
        (self.main / ".claude/skills").symlink_to("../.agents/skills", target_is_directory=True)
        run("git", "add", ".", cwd=self.main)
        run("git", "commit", "-m", "test: skill baseline", cwd=self.main)
        run("git", "worktree", "add", "--detach", self.worktree, cwd=self.main)

    def check_skills(self, expected=0):
        before = run("git", "status", "--porcelain", "--untracked-files=all", cwd=self.worktree).stdout
        result = run(sys.executable, CHECKER, cwd=self.worktree, home=self.home, check=False)
        after = run("git", "status", "--porcelain", "--untracked-files=all", cwd=self.worktree).stdout
        self.assertEqual(after, before, "校验入口不得写入项目文件")
        self.assertEqual(result.returncode, expected, result.stdout + result.stderr)
        return result.stdout + result.stderr

    def test_agent_and_claude_changes_are_immediately_shared_in_new_worktree(self):
        self.assertIn("校验通过", self.check_skills())
        agent = self.worktree / ".agents/skills"
        claude = self.worktree / ".claude/skills"

        (agent / "new/references").mkdir(parents=True)
        (agent / "new/SKILL.md").write_text("# New\n", encoding="utf-8")
        (agent / "new/references/full.md").write_text("full package\n", encoding="utf-8")
        self.assertEqual((claude / "new/references/full.md").read_text(), "full package\n")
        run("git", "add", ".agents/skills", cwd=self.worktree)
        self.check_skills()

        (claude / "from-claude/references").mkdir(parents=True)
        (claude / "from-claude/SKILL.md").write_text("# From Claude\n", encoding="utf-8")
        (claude / "from-claude/references/full.md").write_text("Claude package\n", encoding="utf-8")
        self.assertEqual((agent / "from-claude/references/full.md").read_text(), "Claude package\n")
        run("git", "add", ".agents/skills", cwd=self.worktree)
        self.check_skills()

        (claude / "example/SKILL.md").write_text("# Changed by Claude\n", encoding="utf-8")
        self.assertEqual((agent / "example/SKILL.md").read_text(), "# Changed by Claude\n")
        self.check_skills()
        (agent / "new/references/full.md").write_text("changed by Agent\n", encoding="utf-8")
        self.assertEqual((claude / "new/references/full.md").read_text(), "changed by Agent\n")
        self.check_skills()

        (claude / "new/references/full.md").unlink()
        (claude / "new/SKILL.md").unlink()
        (claude / "new/references").rmdir()
        (claude / "new").rmdir()
        run("git", "add", "-A", ".agents/skills", cwd=self.worktree)
        self.assertFalse((agent / "new").exists())
        self.check_skills()
        (agent / "from-claude/references/full.md").unlink()
        (agent / "from-claude/SKILL.md").unlink()
        (agent / "from-claude/references").rmdir()
        (agent / "from-claude").rmdir()
        run("git", "add", "-A", ".agents/skills", cwd=self.worktree)
        self.assertFalse((claude / "from-claude").exists())
        self.check_skills()
        (agent / "example/references/details.md").unlink()
        run("git", "add", "-A", ".agents/skills", cwd=self.worktree)
        self.assertFalse((claude / "example/references/details.md").exists())
        self.check_skills()

    def test_broken_link_and_plain_directory_fail_without_repair(self):
        entry = self.worktree / ".claude/skills"
        entry.unlink()
        self.assertIn("丢失或平台未保留符号链接", self.check_skills(1))
        entry.mkdir()
        self.assertIn("普通目录", self.check_skills(1))
        entry.rmdir()
        entry.symlink_to(self.main / ".agents/skills", target_is_directory=True)
        self.assertIn("指向错误位置", self.check_skills(1))

    def test_missing_extra_stale_and_duplicate_content_fail(self):
        skill = self.worktree / ".agents/skills/example"
        (skill / "references/details.md").unlink()
        self.assertIn("Git 跟踪的文件缺失", self.check_skills(1))
        (skill / "references/details.md").write_text("details\n", encoding="utf-8")
        (skill / "extra.txt").write_text("unknown\n", encoding="utf-8")
        self.assertIn("未纳入 Git", self.check_skills(1))
        (skill / "extra.txt").unlink()

        duplicate = self.worktree / ".qoder/skills/example"
        duplicate.mkdir(parents=True)
        (duplicate / "SKILL.md").write_text("old copy\n", encoding="utf-8")
        self.assertIn("过期生成副本", self.check_skills(1))
        (duplicate / "SKILL.md").write_text("# Example\n", encoding="utf-8")
        (duplicate / "references").mkdir()
        (duplicate / "references/details.md").write_text("details\n", encoding="utf-8")
        self.assertIn("重复注册项目技能", self.check_skills(1))
        (duplicate / "SKILL.md").unlink()
        (duplicate / "references/details.md").unlink()
        (duplicate / "references").rmdir()
        duplicate.rmdir()
        extra = self.worktree / ".zcode/skills/unknown"
        extra.mkdir(parents=True)
        (extra / "SKILL.md").write_text("unknown\n", encoding="utf-8")
        self.assertIn("额外项目技能", self.check_skills(1))

    def test_agents_root_content_must_be_tracked_in_new_worktree(self):
        agents = self.worktree / ".agents"
        local = agents / "local.txt"
        local.write_text("local\n", encoding="utf-8")
        self.assertIn(".agents/local.txt: 未纳入 Git", self.check_skills(1))
        local.unlink()

        empty = agents / "empty"
        empty.mkdir()
        self.assertIn(".agents/empty: 未纳入 Git", self.check_skills(1))
        empty.rmdir()

        link = agents / "linked"
        link.symlink_to("skills")
        self.assertIn(".agents/linked: .agents 包含符号链接", self.check_skills(1))
        link.unlink()

        tracked = agents / "tracked.txt"
        tracked.write_text("tracked\n", encoding="utf-8")
        run("git", "add", ".agents/tracked.txt", cwd=self.worktree)
        self.check_skills()
        tracked.unlink()
        self.assertIn(".agents/tracked.txt: Git 跟踪的文件缺失", self.check_skills(1))

    def test_known_build_output_is_preserved_but_adjacent_unknown_file_fails(self):
        skill = self.worktree / ".agents/skills/deploy-blue-whale-api"
        skill.mkdir()
        (skill / "SKILL.md").write_text("# Deploy\n", encoding="utf-8")
        (skill / ".gitignore").write_text(".build/\n", encoding="utf-8")
        run("git", "add", ".agents/skills/deploy-blue-whale-api", cwd=self.worktree)

        build = skill / ".build"
        build.mkdir()
        for name in ("source-commit", "image-tag", "new-api"):
            (build / name).write_text(f"{name}\n", encoding="utf-8")
        self.assertIn("校验通过", self.check_skills())
        self.assertEqual((build / "new-api").read_text(encoding="utf-8"), "new-api\n")

        unknown = skill / "unknown.txt"
        unknown.write_text("unknown\n", encoding="utf-8")
        self.assertIn(".agents/skills/deploy-blue-whale-api/unknown.txt: 未纳入 Git", self.check_skills(1))

    def test_personal_same_name_reports_sources_and_preserves_files(self):
        personal = self.home / ".codex/skills/example"
        personal.mkdir(parents=True)
        file = personal / "SKILL.md"
        file.write_text("personal version\n", encoding="utf-8")
        output = self.check_skills()
        self.assertIn("个人同名技能: example", output)
        self.assertIn(".agents/skills/example", output)
        self.assertEqual(file.read_text(encoding="utf-8"), "personal version\n")


if __name__ == "__main__":
    unittest.main()
