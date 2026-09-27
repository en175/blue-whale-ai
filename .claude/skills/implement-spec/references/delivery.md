# Verification, publication, and cleanup

Use this reference after all tickets are integrated, or when resuming an existing PR. The [Git workflow](../../../../docs/agents/git-workflow.md) owns publication authorization and PR update transactions. The [testing strategy](../../../../docs/agents/testing-strategy.md) owns validation scope and receipt reuse.

## Prepare the branch

In the integration worktree, synchronize to the target recorded in task metadata:

```bash
scripts/sync-task-from-origin.sh sync --target-branch <recorded-release> --json
```

Record the resulting HEAD and fixed diff baseline for step 7. After review fixes, commit through `scripts/commit-task-for-review.sh`. Run the testing strategy's completion verification and check its receipt against the current HEAD.

If review fixes add commits to a pending synchronization transaction, an existing-PR update requires its recorded `synced_head` to match the new HEAD. Re-run the sync entrypoint and check that binding; `UP_TO_DATE` alone does not prove it refreshed the record. Ordinary rebase transactions can retain the old HEAD or reject another sync after the release advances. On mismatch or rejection, preserve recovery references and report the blocker; do not rewrite transaction metadata to proceed.

Before publication, run and check PR-stage verification:

```bash
node scripts/verify-change-scope.mjs run --stage pr
node scripts/verify-change-scope.mjs check --stage pr --json
```

A changed HEAD or target invalidates prior evidence. Repeat the affected review and validation before proceeding. If the task's starting commit is not yet in the remote release, report the unshared baseline and retain the local result. This task does not authorize pushing the release branch.

## Publish

Prepare the body using the repository's [pr skill](../../pr/SKILL.md). Link the spec and every delivered ticket with their acceptance and verification evidence. Use the [issue tracker rules](../../../../docs/agents/issue-tracker.md) for states and labels; parent requirements remain for the human to close. Local integration and PR creation do not mean the tickets have merged into the release.

Once the current conversation authorizes publication, run:

```bash
scripts/publish-review-package.sh --user-authorized --create-pr --target-branch <recorded-release> --json
```

This pushes the branch and produces the creation marker. Then create the Gitee PR with the same source and target and explicit `draft=false`. Read it back to confirm its non-draft state, description, ticket links, source, target, HEAD, conflict status, and diff. Save a fresh snapshot following the Git workflow and verify it:

```bash
scripts/verify-pr-update.sh --update-pr <pr-number> --pr-snapshot <snapshot-json> --json
```

This verifier also accepts a newly created PR. If preparation left a pending synchronization transaction, run `scripts/sync-task-from-origin.sh finalize --json` after verification succeeds. This records the ancestry evidence needed to clean up children after a pre-publication rebase. Apply the required issue labels and report the PR for developer review. PR merge requires separate authorization.

If a PR already exists, update that PR using the Git workflow's existing-PR procedure, including a fresh Gitee snapshot, explicit lease, post-push readback, `verify-pr-update.sh`, and transaction finalization. Do not create a second PR. If its source contains legacy child merge commits, read the Git workflow's implement-spec linearization procedure and [ADR-0116](../../../../docs/adr/0116-implement-spec-integration-workflow.md) before proceeding. A rewritten HEAD requires a fresh review. After the update is verified, mark an existing draft ready through a supported Gitee operation and read back its non-draft state. If the available tools cannot change draft status, report the remaining human action and keep the handoff pending; do not claim the PR is ready.

## Clean up child worktrees

After the remote PR content is verified, obtain a fresh Gitee PR snapshot as specified by the existing-PR workflow. From each child worktree, run:

```bash
python3 scripts/cleanup-implement-spec-child.py --pr-snapshot <snapshot-json> --json
```

The cleanup entrypoint checks that the remote PR source contains the child's work. If integration synchronization or legacy linearization changed commit ancestry, follow the Git workflow's lineage verification and finalize the associated transaction first. A failed proof or changed remote source leaves the worktree in place.

Report which children were removed and which were retained with their reason. Keep the integration worktree until an authorized PR merge into its recorded release is verified; its eventual cleanup uses `scripts/cleanup-task-worktree.sh`.
