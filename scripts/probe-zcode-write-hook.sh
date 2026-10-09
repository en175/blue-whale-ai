#!/usr/bin/env bash

set -u

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ZCODE_HOOKS_JSON="$REPO_ROOT/.zcode/config.json"
TMP_ROOT=""

cleanup() {
  if [ -n "$TMP_ROOT" ] && [ -d "$TMP_ROOT" ]; then
    rm -rf "$TMP_ROOT"
  fi
}
trap cleanup EXIT

fail() {
  echo "probe failed: $*" >&2
  exit 1
}

if ! ZCODE_COMMAND="$(python3 - "$ZCODE_HOOKS_JSON" <<'PY'
import json
import shlex
import sys
from pathlib import Path

path = Path(sys.argv[1])
try:
    config = json.loads(path.read_text())
    events = config["hooks"]["events"]
except (OSError, json.JSONDecodeError, KeyError, TypeError) as error:
    raise SystemExit(f"unable to parse real ZCode hook config {path}: {error}")

# ZCode loads hooks.events under a strict schema: one event outside the
# seven-event allowlist (e.g. SubagentStart, supported by Claude Code/Codex)
# makes ZCode reject the whole file, so every hook it declares — blocking
# gates included — is silently disabled (IKJGD5). Contract-equivalence checks
# cannot catch this; the probe validates the allowlist first.
supported = {
    "SessionStart",
    "UserPromptSubmit",
    "PreToolUse",
    "PermissionRequest",
    "PostToolUse",
    "PostToolUseFailure",
    "Stop",
}
unsupported = sorted(set(events) - supported)
if unsupported:
    raise SystemExit(
        "ZCode hooks.events contains unsupported events "
        f"{unsupported}; ZCode refuses to load the whole config file and "
        "every hook in it is silently disabled"
    )

try:
    pre_hooks = events["PreToolUse"]
except KeyError:
    raise SystemExit("ZCode hook config has no PreToolUse event")

matches = [item for item in pre_hooks if item.get("matcher") == "Edit|Write"]
if len(matches) != 1:
    raise SystemExit(
        "expected exactly one ZCode PreToolUse matcher=Edit|Write, "
        f"found {len(matches)}"
    )

commands = [
    hook.get("command", "")
    for hook in matches[0].get("hooks", [])
    if hook.get("type") == "command"
]
if len(commands) != 1:
    raise SystemExit(
        "expected matcher=Edit|Write to contain exactly one command hook, "
        f"found {len(commands)}"
    )

command = commands[0]
try:
    parts = shlex.split(command)
except ValueError as error:
    raise SystemExit(f"invalid ZCode Edit|Write command: {error}")

# ZCode mounts the shared gate directly (no Codex-style wrapper): the payload
# already carries tool_name=Edit|Write with tool_input.file_path.
expected = "${CLAUDE_PROJECT_DIR}/.claude/hooks/block-master-edit.sh"
if len(parts) != 1 or parts[0] != expected:
    raise SystemExit(
        "matcher=Edit|Write must directly mount the shared gate "
        f"block-master-edit.sh via ${{CLAUDE_PROJECT_DIR}}; "
        f"actual command={command!r}"
    )

print(parts[0])
PY
)"; then
  exit 1
fi

make_input() {
  local target="$1"
  local tool="$2"
  python3 - "$target" "$tool" <<'PY'
import json
import sys

target, tool = sys.argv[1:]
if tool == "Edit":
    tool_input = {
        "file_path": target,
        "old_string": "before",
        "new_string": "after",
    }
else:
    tool_input = {"file_path": target, "content": "created"}
print(json.dumps({"tool_name": tool, "tool_input": tool_input}))
PY
}

run_case() {
  local area="$1"
  local tool="$2"
  local expected_exit="$3"
  local target="$4"
  local input tmp_out tmp_err actual_exit actual_stdout actual_stderr

  input="$(make_input "$target" "$tool")" || fail "$area $tool: unable to build ZCode hook input"
  tmp_out="$(mktemp "${TMPDIR:-/tmp}/zcode-write-probe-out.XXXXXX")" || fail "$area $tool: unable to create stdout capture"
  tmp_err="$(mktemp "${TMPDIR:-/tmp}/zcode-write-probe-err.XXXXXX")" || {
    rm -f "$tmp_out"
    fail "$area $tool: unable to create stderr capture"
  }

  (
    cd "$REPO_ROOT" || exit 1
    printf '%s' "$input" | bash "$GATE"
  ) >"$tmp_out" 2>"$tmp_err"
  actual_exit=$?
  actual_stdout="$(cat "$tmp_out")"
  actual_stderr="$(cat "$tmp_err")"
  rm -f "$tmp_out" "$tmp_err"

  if [ "$actual_exit" -ne "$expected_exit" ]; then
    fail "$area $tool: expected exit=$expected_exit, actual exit=$actual_exit; stdout=${actual_stdout:-<empty>}; stderr=${actual_stderr:-<empty>}"
  fi
  if [ -n "$actual_stdout" ]; then
    fail "$area $tool: expected empty stdout, actual=${actual_stdout}"
  fi
  if [ "$expected_exit" -eq 2 ]; then
    case "$actual_stderr" in
      *"BLOCKED:"*) ;;
      *) fail "$area $tool: expected blocking reason on stderr, actual=${actual_stderr:-<empty>}" ;;
    esac
  elif [ -n "$actual_stderr" ]; then
    fail "$area $tool: expected empty stderr, actual=${actual_stderr}"
  fi
}

GATE="${ZCODE_COMMAND//\$\{CLAUDE_PROJECT_DIR\}/$REPO_ROOT}"

TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/zcode-write-hook-probe.XXXXXX")" || fail "unable to create temporary probe root"
MASTER_REPO="$TMP_ROOT/master"
RELEASE_REPO="$TMP_ROOT/release"
TASK_REPO="$TMP_ROOT/task"
mkdir -p "$MASTER_REPO" || fail "unable to create temporary Git repository"

git -C "$MASTER_REPO" init -q || fail "unable to initialize temporary master repository"
git -C "$MASTER_REPO" symbolic-ref HEAD refs/heads/master || fail "unable to set temporary master branch"
git -C "$MASTER_REPO" config user.name "Hook Probe"
git -C "$MASTER_REPO" config user.email "hook-probe@example.com"
mkdir -p "$MASTER_REPO/scripts/lib"
cp "$REPO_ROOT/scripts/lib/task_metadata.py" "$MASTER_REPO/scripts/lib/task_metadata.py"
printf 'before\n' >"$MASTER_REPO/existing.txt"
git -C "$MASTER_REPO" add -A
git -C "$MASTER_REPO" -c core.hooksPath=/dev/null commit -q -m 'chore: probe base' || fail "unable to commit probe base"
git -C "$MASTER_REPO" branch release/probe
git -C "$MASTER_REPO" worktree add -q "$RELEASE_REPO" release/probe || fail "unable to create temporary release worktree"
git -C "$MASTER_REPO" worktree add -q -b feature/probe "$TASK_REPO" || fail "unable to create temporary task worktree"
TASK_START="$(git -C "$TASK_REPO" rev-parse HEAD)"
python3 "$TASK_REPO/scripts/lib/task_metadata.py" repair --worktree "$TASK_REPO" \
  --target-branch release/probe --start-sha "$TASK_START" --user-authorized >/dev/null \
  || fail "unable to record temporary task metadata"

run_case master Edit 2 "$MASTER_REPO/existing.txt"
run_case master Write 2 "$MASTER_REPO/created.txt"
run_case release Edit 2 "$RELEASE_REPO/existing.txt"
run_case release Write 2 "$RELEASE_REPO/created.txt"
run_case task Edit 0 "$TASK_REPO/existing.txt"
run_case task Write 0 "$TASK_REPO/created.txt"

[ ! -e "$MASTER_REPO/created.txt" ] || fail "master Write: probe unexpectedly created the file"
[ ! -e "$RELEASE_REPO/created.txt" ] || fail "release Write: probe unexpectedly created the file"
[ ! -e "$TASK_REPO/created.txt" ] || fail "task Write: probe unexpectedly created the file"
[ "$(cat "$MASTER_REPO/existing.txt")" = "before" ] || fail "master Edit: probe unexpectedly modified the file"
[ "$(cat "$RELEASE_REPO/existing.txt")" = "before" ] || fail "release Edit: probe unexpectedly modified the file"
[ "$(cat "$TASK_REPO/existing.txt")" = "before" ] || fail "task Edit: probe unexpectedly modified the file"

echo "events=within ZCode allowlist"
echo "matcher=Edit|Write"
echo "tool_name=Edit/Write"
echo "tool_input=file_path"
echo "master Edit=blocked"
echo "master Write=blocked"
echo "release Edit=blocked"
echo "release Write=blocked"
echo "task Edit=allowed"
echo "task Write=allowed"
