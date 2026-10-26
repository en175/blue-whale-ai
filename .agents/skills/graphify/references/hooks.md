# graphify reference: commit hook and project agent instructions

Load this when the user asks to install the post-commit hook or add graphify to a project's agent instructions.

## For git commit hook

Install a post-commit hook that auto-rebuilds the graph after every commit. No background process needed - triggers once per commit, works with any editor.

```bash
graphify hook install    # install
graphify hook uninstall  # remove
graphify hook status     # check
```

After every `git commit`, the hook detects which code files changed (via `git diff HEAD~1`), re-runs AST extraction on those files, and rebuilds `graph.json` and `GRAPH_REPORT.md`. Doc/image changes are ignored by the hook - run `/graphify --update` manually for those.

If a post-commit hook already exists, graphify appends to it rather than replacing it.

---

## For project agent instructions

This repository already stores graphify at `.agents/skills/graphify`; `.claude/skills` points to the same directory. Its code exploration rule lives in `agent-rules/code-discovery.md`, reached from the root `CLAUDE.md`. Keep those roles separate when changing this repository.

For another project, check its agent rule placement before changing `AGENTS.md` or `CLAUDE.md`. The graphify CLI's `install --platform agents` and `install --platform claude` commands copy a skill into a client directory; they do not install an always-on rule. Do not run either command over this repository's shared skill directory.
