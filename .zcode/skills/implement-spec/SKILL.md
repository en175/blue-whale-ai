---
name: implement-spec
description: "Implement a specification in code."
disable-model-invocation: true
---

Implement the supplied spec and its tickets on one integration branch, delivered as one reviewed PR.

The tickets form a **task graph**. The **frontier** contains tickets whose prerequisites are satisfied and which have not been assigned. Run independent frontier tickets concurrently in background implementer subagents. Each ticket keeps its own worktree and branch; a merger subagent integrates completed work serially.

Communicate through **context pointers** to the spec, tickets, research notes, and commits. Include the assignment, ownership, and missing context in each handoff, without copying material the recipient can read.

This repository creates the PR after implementation and review. [ADR-0116](../../../docs/adr/0116-implement-spec-integration-workflow.md) records this adaptation of the [upstream workflow](https://github.com/mattpocock/skills/blob/c55ee46073ed923f86ce59a5eb3b6d895095d1b7/skills/in-progress/implement-spec/SKILL.md). Invoking this skill authorizes implementation, not publication or PR merge.

## Steps

1. Read the spec and discover its existing child tickets using the [issue tracker rules](../../../docs/agents/issue-tracker.md). Follow all result pages and compare numeric parent IDs; a title search is not a hierarchy query. Build the task graph from each ticket's scope, acceptance criteria, and `Blocked by` references. Resolve missing dependencies and cycles before dispatch. Apply the contract-first and serial-family rules in the [Git workflow](../../../docs/agents/git-workflow.md); a dependency requiring a release merge stays blocked until that merge. This step ends with every ticket accounted for and an explicit frontier.

2. If tickets need shared research, use an exploration subagent. Before code exploration or delegation, follow the [code discovery protocol](../../../agent-rules/code-discovery.md), including parent graph evidence and the recipient's actual tool access. Have the explorer save notes outside the repository at paths later subagents can read. Finish when the notes answer the implementation questions, or record which questions still block tickets.

3. Create the integration worktree for the spec issue using [worktree setup](references/worktrees.md#integration-worktree). Record its branch, target release, and starting commit. This is the future PR branch; keep it local through step 7.

4. Dispatch an implementer for each available frontier ticket, following the [implementer handoff](references/worktrees.md#implementers). Each implementer owns one ticket, its declared files, and an isolated worktree. A completed handoff includes the committed HEAD, acceptance evidence, test results, and any unresolved limitation.

5. Send completed tickets to a merger subagent using the [integration procedure](references/worktrees.md#merger). Give only one merger write access to the integration worktree at a time. Mark a ticket integrated only after the guarded merge succeeds and its result is recorded.

6. Recompute the frontier after each integration and dispatch newly unblocked tickets immediately. Internal dependencies become available when their required work is integrated, not merely when an implementer reports completion. Repeat steps 4 through 6 until every ticket is integrated. If unfinished tickets remain but none can run, report their blockers instead of declaring completion.

7. Synchronize the integration branch to its recorded release target using the [delivery preparation](references/delivery.md#prepare-the-branch). Run `/code-review` on the complete spec diff, passing the fixed baseline and spec explicitly. Use one implementer subagent to resolve the review findings in the integration worktree with exclusive write access. Verify the resulting HEAD and re-review changes after fixes or synchronization; finish when the spec's acceptance criteria pass and no unresolved review finding remains.

8. Publish one non-draft PR through the [publication procedure](references/delivery.md#publish). If publication is not yet authorized, present the verified branch, review results, and proposed PR for approval. Existing authorization covering this publication needs no second confirmation. Finish only after Gitee readback confirms the intended PR and exact HEAD; then hand it to the developer for review.

9. After publication is verified, clean up implementer worktrees using the [child cleanup procedure](references/delivery.md#clean-up-child-worktrees). Retain any worktree whose content cannot be proven present in the PR. Keep the integration worktree for review revisions until the PR has merged into its target release.
