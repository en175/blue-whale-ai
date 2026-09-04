---
name: frontend-delivery
description: Use when implementing, fixing, or refactoring product UI under web/, including pages, components, CSS modules, API clients, TanStack Query, useQuery, useMutation, queryOptions, and Gitee Issue-driven frontend defects.
---

# Frontend delivery

Follow the repository-root `CLAUDE.md` first. Load this skill for any `web/` product work; the user does not need to name it.

- Gitee Issue-driven frontend **defect** repair: read and follow [references/bugfix.md](references/bugfix.md). Do not use Computer Use, Playwright, or automated browser smoke checks; start `npm run dev:test` and give its URL to the human for manual regression. Never start backend.
- Explicit frontend **feat** workflow: only when the user explicitly says “使用 feat 工作流” or names `feat`; read and follow [references/feature.md](references/feature.md). A Gitee Issue is optional when the direct requirement is clear.
- **New** server-state reads/writes (new page, new data source, new polling): follow [references/request.md](references/request.md). Do not convert existing `useEffect` fetch unless that surface is the task.
- Other Feature/Refactor: follow root repository rules. Do not apply the Bugfix Issue gate. Load [references/request.md](references/request.md) if the change adds or replaces a data fetch.
- **Visual styles (load on demand):** When a task changes glass/translucency, `backdrop-filter`, a scroll container, repeated cards/list items, thumbnails, skeletons, or persistent in-item controls, read [frontend-styling](../frontend-styling/SKILL.md). It owns visual/compositing guidance; this skill retains delivery-workflow ownership.
- Frontend product files belong in `web/**`. If work needs a backend, shared contract, root tool, root rule, or PR-template change, stop and ask for a separately scoped Issue.
- Product API envelope is `{ code, data, msg }`. `code === 200` unwraps `data`; otherwise throw, read `msg`. Default toast and `silent` live in `web/src/api/http.ts`; Query usage is in [references/request.md](references/request.md).
