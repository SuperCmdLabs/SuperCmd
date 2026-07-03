# Codex Performance PR Playbook

Use this when filing SuperCmd performance optimization PRs from Codex worker branches.

## Repository Target

Always file PRs against the upstream project:

- Upstream repo: `SuperCmdLabs/SuperCmd`
- Base branch: `main`
- Head repo: `JustYannicc/SuperCmd`
- Head branch: the worker branch in the fork

Do not create PRs whose URL is under `https://github.com/JustYannicc/SuperCmd/pull/...`.
The PR URL must be under `https://github.com/SuperCmdLabs/SuperCmd/pull/...`.

Use explicit `gh` repo targeting every time:

```sh
gh pr create \
  --repo SuperCmdLabs/SuperCmd \
  --base main \
  --head "JustYannicc:<branch-name>" \
  --title "<conventional-title>" \
  --body-file /tmp/supercmd-pr-body.md
```

Verify the target after creation:

```sh
gh pr view <number> \
  --repo SuperCmdLabs/SuperCmd \
  --json url,baseRefName,headRefName,headRepository,headRepositoryOwner,isCrossRepository,title
```

Expected:

- `url` starts with `https://github.com/SuperCmdLabs/SuperCmd/pull/`
- `baseRefName` is `main`
- `headRepository.nameWithOwner` is `JustYannicc/SuperCmd`
- `isCrossRepository` is `true`
- `title` follows the repo title convention below

## Title Convention

Use Conventional Commit style, lowercase after the colon:

```text
perf(scope): short imperative summary
fix(scope): short imperative summary
ci(scope): short imperative summary
test(scope): short imperative summary
```

Good examples:

```text
perf(browser-search): index hot query path
fix(types): make renderer typecheck clean
ci(claude): fix review action on fork PRs
fix(i18n): restore Italian parity checks
```

Avoid:

- `[codex] ...`
- title case summaries
- vague titles such as `Improve performance`
- filing any PR before the title is final

## PR Body Template

Use this section structure unless the repo adds an official template:

```md
## What changed

- <Concrete implementation change.>
- <Concrete test or harness change.>

## Why

<Explain the measured problem or regression risk. Include the hot path and why the old implementation caused lag, memory churn, timer retention, IPC fanout, or typecheck/CI breakage.>

## Compatibility impact

<State how behavior is preserved. For Raycast runtime changes, say which API behavior remains compatible. Mention i18n impact if user-facing strings changed.>

## How tested

- Baseline before editing: <command and result, including timing/memory/diagnostic count when relevant>.
- After fix: <command and result, including timing/memory/diagnostic count when relevant>.
- <Focused test command>: pass
- <Typecheck/build/LSP command>: pass

## Stack validation

This issue was found and validated from `codex/perf-integration-stack`, which contains the current performance fix stack. The PR branch is intentionally kept scoped against `origin/main` unless this PR is explicitly stacked on another PR.
```

## Required Evidence

Every performance PR should include real before/after evidence when practical:

- Baseline command and result before changing code.
- Final command and result after changing code.
- Focused tests for the touched code.
- Typecheck/build/LSP diagnostics for touched TypeScript files when relevant.
- `node scripts/check-i18n.mjs` when user-facing strings or locale files changed.

If a full repo command cannot run, explain the exact blocker and run the strongest focused checks available.

## Stack And Scope Rules

Discovery and iterative review should happen on:

```text
codex/perf-integration-stack
```

That branch contains the current active performance fix stack.

PR branches should not accidentally include the whole stack. Use one of these shapes:

- Scoped PR: cherry-pick the worker commit onto `origin/main`, then open a normal upstream PR.
- Stacked PR: base the PR on the explicit stack branch only when the stack branch is intentionally pushed and reviewable.

Before filing, check the diff size:

```sh
git diff --stat origin/main...HEAD
```

If the diff includes unrelated stack files, stop and create a scoped PR branch from `origin/main`.

## Post-Creation Audit

After creating or updating a PR:

```sh
gh pr view <number> --repo SuperCmdLabs/SuperCmd --json title,url,baseRefName,headRefName,body,isDraft,mergeStateStatus
```

Confirm:

- URL is upstream.
- Title conforms.
- Body has all required sections.
- No stale notes claim renderer typecheck has existing errors once the stack or dedicated typecheck PR has made it clean.
- Draft status matches intent.

