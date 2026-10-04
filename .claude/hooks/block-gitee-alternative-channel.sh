#!/usr/bin/env bash
# Shared MCP-only channel gate; the Python implementation parses structured input.
set -u
HOOK_DIR="$(cd "$(dirname "$0")" && pwd)"
# lib/hook_audit.py is called by the implementation with --operation gitee-channel.
exec python3 "$HOOK_DIR/lib/gitee_channel.py"
