# Codex Performance Worker Prompt Template

Use this prompt when creating a focused worker thread for one performance issue.
Adjust the issue title, branch name, files, commands, and expected measurements.

```text
You are working in the SuperCmd repository.

Goal:
Fix exactly one performance issue:
<short issue summary>

Branch and base:
- Start from `codex/perf-integration-stack` so this work sees all current performance fixes.
- Create or use branch `<branch-name>`.
- Keep the implementation scoped to this issue.
- Do not revert unrelated user or worker changes.
- Preserve all existing functionality and Raycast compatibility.

Important PR rules:
- The final PR must be filed against upstream `SuperCmdLabs/SuperCmd`, not only the fork.
- Use:
  `gh pr create --repo SuperCmdLabs/SuperCmd --base main --head "JustYannicc:<branch-name>" ...`
- The PR URL must be `https://github.com/SuperCmdLabs/SuperCmd/pull/...`.
- The title must be conventional:
  `<type>(<scope>): <lowercase summary>`
- Use the PR body sections from `docs/dev-notes/CODEX_PERFORMANCE_PR_PLAYBOOK.md`:
  `What changed`, `Why`, `Compatibility impact`, `How tested`, `Stack validation`.

Implementation constraints:
- Functionality, behavior, and UI semantics must remain the same.
- Optimize implementation details only.
- Add focused regression or performance tests for touched behavior.
- Use existing repo patterns and helper APIs.
- Use Codex LSP diagnostics for touched TypeScript files when relevant.
- If touching user-facing strings, update every locale file and run `node scripts/check-i18n.mjs`.

Required workflow:
1. Record a baseline before editing.
   - Command:
     `<baseline command>`
   - Capture timing, memory, diagnostic count, IPC count, render count, or another concrete metric.
2. Implement the smallest safe fix.
3. Run focused tests.
4. Run typecheck/build/LSP diagnostics relevant to touched files.
5. Re-run the baseline/performance measurement and report the improvement.
6. Validate the patch on `codex/perf-integration-stack`.
7. If the upstream PR would include unrelated stack changes, create a scoped PR branch from `origin/main` and cherry-pick only this fix.
8. File the upstream PR using the playbook.

Expected final report:
- Branch name.
- Commit hash.
- PR URL.
- Files changed.
- Baseline result.
- After result.
- Test commands and results.
- LSP/typecheck/build results.
- Any residual risks.
- Confirmation that the PR is against `SuperCmdLabs/SuperCmd` and has a conventional title/body.
- Archive this thread when complete.
```

## Scoped PR Branch Pattern

Use this when the implementation branch is stack-based but the PR must be scoped to `main`:

```sh
git worktree add -B <branch-name>-pr /tmp/<branch-name>-pr origin/main
cd /tmp/<branch-name>-pr
git cherry-pick <worker-commit>
git diff --stat origin/main...HEAD
```

Then push and file the PR explicitly:

```sh
git push -u fork <branch-name>-pr
gh pr create \
  --repo SuperCmdLabs/SuperCmd \
  --base main \
  --head "JustYannicc:<branch-name>-pr" \
  --title "<conventional-title>" \
  --body-file /tmp/supercmd-pr-body.md
```

