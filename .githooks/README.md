# Local git hooks

This directory contains repo-managed git hooks. They are **not** wired up
automatically when you clone — git looks for hooks under `.git/hooks/` by
default. Enable them once per clone:

```bash
git config core.hooksPath .githooks
```

## Hooks

- **`commit-msg`** — rejects commits whose message does not contain a
  Paperclip identifier (`ROGA-XX`) when the current branch is not
  `master`, `main`, or `hotfix/*`. Keeps the tracker↔repo linkage
  bidirectional for the weekly audit.

See `docs/issue-closure-dod.md` for the broader closure DoD this enforces.

## CI mirror

The PR-title equivalent runs in CI:
[`.github/workflows/pr-title-check.yml`](../.github/workflows/pr-title-check.yml).
That check is mandatory; the local hook is best-effort (it catches the
issue earlier, but the CI check is the gate).
