"""Windows test-host helper: resolve the real Git Bash, never the WSL stub.

Native Windows Python (Anaconda, no MSYS runtime) spawns a bare ``bash``
through the Windows ``CreateProcess`` PATH search, which prefers
``C:\\Windows\\System32\\bash.exe`` (the WSL launcher) over the Git Bash in
PATH. The WSL launcher emits UTF-16LE "install a WSL distribution" errors, so
any ``subprocess.run(["bash", ...])`` in the tests fails (WSL Bash isn't even
Git Bash). On non-Windows hosts this returns plain ``"bash"`` and the tests
stay cross-platform.
"""

from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path


def resolve_git_bash() -> str:
    """Absolute path to a real Git Bash, or plain ``bash`` off-Windows."""
    if os.name != "nt":
        return "bash"

    # Locate the Git install root (Git for Windows ships its own bash).
    git_exe = shutil.which("git")
    if git_exe:
        # Preferred: git --exec-path -> <root>/mingw64/libexec/git-core, so
        # the root is parents[2]; bash lives at <root>/usr/bin/bash.exe.
        probe = subprocess.run(
            ["git", "--exec-path"],
            capture_output=True,
            text=True,
            encoding="utf-8",
        )
        for root in (
            Path(probe.stdout.strip()).parents[2] if probe.returncode == 0 and probe.stdout.strip() else None,
            # Fallback: git.exe lives at <root>/mingw64/bin/git.EXE, so the root
            # is parents[2] (not parents[1], which is the mingw64 dir with no
            # bash). 实测：E:\Git\mingw64\bin\git.EXE -> 根 E:\Git，bash 在
            # E:\Git\usr\bin\bash.exe；parents[1]=mingw64 探测必然落空。
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
