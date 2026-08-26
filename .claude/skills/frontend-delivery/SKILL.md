---
name: frontend-delivery
description: Handle a frontend Bugfix, Feature, or Refactor workflow only when the user explicitly invokes this skill.
---

# Frontend delivery

Only use this Skill when the user explicitly asks to use `frontend-delivery`. Follow the repository-root `CLAUDE.md` first.

- For a Gitee Issue-driven frontend defect repair, read and follow [references/bugfix.md](references/bugfix.md).
- For Feature or Refactor work, load a matching reference only after one exists. Until then, follow the root repository rules and do not apply the Bugfix Issue gate.
- Frontend product files belong in `web/**`. If work needs a backend, shared contract, root tool, root rule, or PR-template change, stop and ask for a separately scoped Issue.
