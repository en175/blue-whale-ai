---
name: implement
description: "Implement a piece of work based on a spec or set of tickets."
disable-model-invocation: true
---

Implement the work described by the user in the spec or tickets.

Use /tdd where possible, at pre-agreed seams.

Run typechecking and focused tests regularly. At completion, use the repository-selected verification defined by `docs/agents/testing-strategy.md`, reusing valid evidence for the same revision.

Once done, use /code-review to review the work.

Commit through the repository's review entrypoint, run the repository-selected verification on the clean HEAD, and amend if verification finds a defect.


## Repository code discovery

Before code exploration or delegation, read `agent-rules/code-discovery.md`. Apply it before creating a worktree, pass its graph evidence to subagents, and include query-backed conclusions or evidenced fallback in the handoff/review. Index creation alone is not query evidence.
