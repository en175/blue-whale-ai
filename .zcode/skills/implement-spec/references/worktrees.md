# Worktrees and agent handoffs

Read the section for the role you are about to dispatch. The [Git workflow](../../../../docs/agents/git-workflow.md) owns authorization and branch rules; the [worktree workflow](../../../../docs/agents/worktree-workflow.md) owns task metadata. Run commands from the directory specified below. Replace placeholders with verified values; summaries must contain 6 to 15 Chinese characters.

## Integration worktree

From the active local release worktree, run the standard entrypoint:

```bash
scripts/start-task-worktree.sh --type <type> --issue <spec-ident> --summary <chinese-summary>
```

Enter the returned worktree and read its metadata:

```bash
python3 scripts/lib/task_metadata.py read --json
```

Use that recorded release target throughout the run. Confirm the directory's CBM project before code exploration. Perform the issue's start transition through Gitee as required by the [issue tracker](../../../../docs/agents/issue-tracker.md); creating a worktree does not perform that API call.

Keep the task graph with ticket status, dependency evidence, assigned agent, worktree, and accepted HEAD in shared coordinator notes. These notes need not be committed merely to create a PR.

## Implementers

Give each implementer the ticket and spec pointers, acceptance criteria, owned files, integration worktree path, and required dependency commits. Include the code discovery evidence and capability checks required by the repository protocol. Tell it that other agents are working concurrently, to preserve their edits, and to report required changes outside its assignment.

Verify the numeric Gitee parent-child relationship, then create the child from the active release worktree:

```bash
scripts/start-task-worktree.sh --type <type> --issue <ticket-ident> --summary <chinese-summary> --integration-worktree <absolute-integration-worktree>
```

The entrypoint records a fixed inheritance commit from the integration branch. Enter the returned child worktree, confirm its metadata and CBM project, and perform the ticket's start transition. Prepare dependencies required by that ticket's tooling in this worktree.

Implement and test the ticket against its acceptance criteria. Commit with:

```bash
scripts/commit-task-for-review.sh -m "<commit-message>"
```

Return the worktree, branch, HEAD, changed files, and verification evidence for the ticket's own diff. Inherited commits are dependency context, not the ticket's changes. Keep child branches local; synchronization with the release and PR publication belong to the integration branch.

## Merger

Accept one committed child at a time. Preserve other agents' work and run this command in the integration worktree:

```bash
python3 scripts/merge-implement-spec-child.py --child-worktree <absolute-child-worktree> --json
```

The entrypoint rebases the unshared child's own commits onto the integration HEAD, checks that the resulting tree matches a conflict-free merge, and fast-forwards the integration branch. Record the returned HEAD, since the child's commit IDs may change.

If the parent lacks the child's recorded release starting commit, synchronize the parent through the standard task entrypoint before retrying. On conflicts, a shared child branch, tree mismatch, or a retained recovery reference, stop that integration and report the evidence. Preserve both worktrees; do not replace a failed guarded merge with an ordinary merge or an ad hoc history rewrite. Independent tickets can continue.

After success, check interactions affected by the merge and update the graph. Local integration satisfies internal implementation dependencies; it does not close the Gitee ticket or satisfy a prerequisite that requires a release merge. Final verification covers the combined branch under the [testing strategy](../../../../docs/agents/testing-strategy.md).
