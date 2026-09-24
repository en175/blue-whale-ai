#!/usr/bin/env bash
set -euo pipefail

SOURCE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TEST_ROOT="$(mktemp -d)"
trap 'rm -rf "$TEST_ROOT"' EXIT

git -C "$TEST_ROOT" init -q -b master
git -C "$TEST_ROOT" config user.name "Legacy Entry Test"
git -C "$TEST_ROOT" config user.email "legacy-entry@example.com"
printf 'base\n' > "$TEST_ROOT/base.txt"
git -C "$TEST_ROOT" add base.txt
git -C "$TEST_ROOT" commit -q -m "test: base"
head_before="$(git -C "$TEST_ROOT" rev-parse HEAD)"

for mode in default authorized continue abort; do
  case "$mode" in
    default) args=("feature/x") ;;
    authorized) args=("--user-authorized" "feature/x") ;;
    continue) args=("--user-authorized" "--continue" "feature/x") ;;
    abort) args=("--user-authorized" "--abort" "feature/x") ;;
  esac
  if output="$(cd "$TEST_ROOT" && bash "$SOURCE_ROOT/scripts/merge-task-to-local-master.sh" "${args[@]}" 2>&1)"; then
    echo "FAIL: legacy entry unexpectedly accepted $mode" >&2
    exit 1
  fi
  case "$output" in
    *已废止*) ;;
    *) echo "FAIL: legacy entry lacks deprecation guidance: $output" >&2; exit 1 ;;
  esac
  [ "$(git -C "$TEST_ROOT" rev-parse HEAD)" = "$head_before" ] || exit 1
  [ -z "$(git -C "$TEST_ROOT" status --porcelain)" ] || exit 1
done

echo "PASS: merge-task-to-local-master 废止入口不改写 master"
