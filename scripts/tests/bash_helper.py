
from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path


def resolve_git_bash() -> str:
    if os.name != "nt":
        return "bash"

    git_exe = shutil.which("git")
    if git_exe:
        probe = subprocess.run(
            ["git", "--exec-path"],
            capture_output=True,
            text=True,
            encoding="utf-8",
        )
        for root in (
            Path(probe.stdout.strip()).parents[2] if probe.returncode == 0 and probe.stdout.strip() else None,
            Path(git_exe).resolve().parents[2],
        ):
            if root is None:
                continue
            for candidate in ("usr/bin/bash.exe", "bin/bash.exe"):
                full = (root / candidate).resolve()
                if full.exists():
                    return str(full)

    return shutil.which("bash") or "bash"


BASH = resolve_git_bash()
