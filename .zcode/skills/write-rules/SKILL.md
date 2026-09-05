---
name: write-rules
description: Write a project's CLAUDE.md and AGENTS.md rule documents that comply with official Anthropic + OpenAI/Codex guidance. Use when the user wants to create/scaffold project rules, write or generate a CLAUDE.md or AGENTS.md, set up agent instructions for a project, or initialize project conventions for coding agents.
---

# write-rules

Produce spec-compliant project rule documents for the **current working directory** by orchestrating: fresh official guidance (research) → project understanding (read key files) → draft → placement → self-check.

Goal: a project where Claude Code, Codex, and other agents read the same concise, non-obvious rules — with a single source of truth and zero drift.

## When to use
- Triggers: "write/scaffold/create CLAUDE.md or AGENTS.md", "set up project rules / agent instructions", "initialize project conventions".
- Also invokable directly as `/write-rules`.

## Pipeline

### 0. Guard — never silently overwrite
Before anything, check the target project for existing rule files: `CLAUDE.md`, `AGENTS.md`, `.claude/CLAUDE.md`, `CLAUDE.local.md`. If any exist, **STOP and ask the user**: backup-then-overwrite / merge / skip. Hand-crafted rules are high-value; do not destroy them.

### 1. Fetch fresh official guidance (dynamic, at runtime)
Invoke the **research** skill (if unavailable, fall back to WebFetch) to fetch and distill the LATEST content of these 4 authoritative sources:
- `https://agents.md/` — the AGENTS.md spec (discovery, nearest-wins hierarchy, format, sections).
- `https://learn.chatgpt.com/docs/agent-configuration/agents-md` — OpenAI Codex guide (override semantics, one-file-per-dir, 32 KiB cap). Note: the old `developers.openai.com/codex/guides/agents-md` 308-redirects here.
- `https://code.claude.com/docs/en/best-practices` — Anthropic CLAUDE.md principles (include/exclude, concision test).
- `https://code.claude.com/docs/en/memory` — Claude memory system (load order, `@` imports, `.claude/rules/`, <200-line budget).

Have research write to a **temp path outside the project** (e.g. `/tmp/write-rules-spec.md`); read it, then delete it. Do not leave artifacts in the target project. Merge the fresh distillation with the **baked heuristics** below — on conflict, prefer the fresher official guidance.

### 2. Understand the project (read key files yourself)
Read: `README*`, the package manifest (`package.json` / `pyproject.toml` / `Cargo.toml` / `go.mod` / `pom.xml` / etc.), any existing rule files, `.cursor/rules`, `.cursorrules`, `.github/copilot-instructions.md`, and the top-level directory tree. `grep` as needed. Extract only what is **non-obvious**: build/test/lint commands, conventions that differ from defaults, architecture decisions, gotchas, required env vars.

### 3. Draft — single source of truth = AGENTS.md
Author **`AGENTS.md`** at the project root as the canonical content, applying the heuristics and placement below. Then create **`CLAUDE.md`** that imports it (Claude Code reads CLAUDE.md, not AGENTS.md — the import bridges both tools with one source):

```markdown
@AGENTS.md

## Claude Code
<!-- Only Claude-specific additions, e.g. "Use plan mode for changes under src/billing/". Omit this section entirely if there are none. -->
```

If there is no Claude-specific content, symlink instead: `ln -s AGENTS.md CLAUDE.md`.

### 4. Placement — progressive disclosure
Classify every candidate rule:
- **Always-visible** (important + high-frequency) → goes in `AGENTS.md` (and thus `CLAUDE.md` via import).
- **Progressive-disclosure** (long, specialized, path-specific, low-frequency) → split out and leave only a one-line routing pointer in the main doc:
  - Claude path-scoped, auto-loaded on demand → `.claude/rules/<topic>.md` with `paths:` YAML frontmatter (e.g. `src/api/**/*.ts`).
  - Codex/AGENTS nested, nearest-wins → `<subdir>/AGENTS.md` (use `AGENTS.override.md` only to REPLACE inherited guidance in that dir).

Only create split files when warranted — a small project may need only the main `AGENTS.md`.

### 5. Self-check, then revise until clean
**Hard gates:**
- Each `CLAUDE.md` / `AGENTS.md` ≤ **200 lines**; the combined AGENTS chain < **32 KiB** (Codex cap).
- **No linter/formatter duties** — code style enforcement belongs to CI/tools, not the rule doc.
- No empty files (Codex ignores them).

**Judgment gates (revise until every line passes):**
- Concision test, per line: *"Would removing this cause the agent to make a mistake?"* If not, cut it.
- Nothing the agent can infer from the code (directory layouts, dependency lists, file-by-file descriptions).
- Commands are concrete and runnable; rules are specific and verifiable ("Use 2-space indentation", not "format code nicely").
- No contradictions across files; no frequently-changing info; link API docs instead of inlining.

## Baked heuristics (stable backbone)

**Include** — build/test/lint commands the agent can't guess · code style that DIFFERS from defaults · testing instructions & preferred runner · repo etiquette (branch/commit/PR conventions) · architectural decisions specific to this project · dev-env quirks (required env vars, sandbox) · common gotchas / non-obvious behavior.

**Exclude** — anything inferable by reading code · standard language conventions · detailed API docs (link instead) · frequently-changing information · long explanations/tutorials · file-by-file codebase descriptions · self-evident practices ("write clean code").

**AGENTS.md suggested sections** — Project overview · Build & test commands · Code style · Testing · Security/gotchas · (PR/commit conventions). Rule of thumb: *"anything you'd tell a new teammate."*

**Specificity & emphasis** — concrete and verifiable; reserve `IMPORTANT` / `YOU MUST` for the few rules that truly need it; check files into git so the team shares them.

## Output & handoff
- `AGENTS.md` (root) — canonical content.
- `CLAUDE.md` (root) — `@AGENTS.md` import + optional Claude-specific tail (or symlink).
- `.claude/rules/*.md` and/or `<subdir>/AGENTS.md` — only when progressive disclosure is warranted.

Report exactly what was created and the self-check result (line counts, gates passed). Remind the user to run `/context` to verify the files loaded, and that the doc should be pruned regularly — treat it like code.
