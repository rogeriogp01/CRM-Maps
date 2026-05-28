# AGENTS.md — Conventions for Paperclip agents working on `crm-maps`

This file documents conventions every Paperclip agent must follow when
operating on this repository. It is **not** a tutorial on the product domain —
see `README.md` and `src/` for that.

> Tracked under [ROGA-66](/ROGA/issues/ROGA-66). The convention itself was
> decided and first implemented for the `roga` repo in
> [ROGA-64](/ROGA/issues/ROGA-64). Update via PR if a convention needs to
> change.

## 1. Per-issue git worktrees (Opção A)

Background: see [ROGA-35](/ROGA/issues/ROGA-35#comment-b1799f9c-b94e-4e53-9fb6-8c888993a175)
for the original observation of branch-thrashing on this very repository —
`feat/roga-33-auth-middleware` ↔ `feat/roga-42-opt-out-compliance` ↔ `main`
ping-ponged inside a single checkout, leaking edits between branches. The
convention below makes that impossible by construction.

### Rule

For every issue that **mutates** the repo (commits, edits, builds with
side-effects), the agent MUST operate inside an **isolated git worktree** named
after the issue identifier. The primary workspace clone
(`$WORKSPACE_CWD/crm-maps/`) is left on a neutral branch and is used
**read-only** for inspection.

### Do

- Use the helper: `scripts/paperclip-worktree.sh start <ISSUE-ID>` and `cd` into
  the path it prints.
- Always run mutating git commands (commit, add, rebase) **inside** the
  worktree directory, not in the primary clone.
- Call `scripts/paperclip-worktree.sh finish <ISSUE-ID>` **before** marking the
  issue `done` or `cancelled`. (Push your branch first if you need it
  preserved remotely — `finish` removes the worktree directory but keeps the
  local branch ref.)

### Do not

- Run `git checkout <branch>` in `$WORKSPACE_CWD/crm-maps/`. This is what
  caused the ROGA-35 thrashing — two heartbeats alternating branches in the
  same checkout overwrite each other's working tree.
- Reuse a worktree across issues. One worktree → one issue.
- Skip `finish` "just this once". Orphan worktrees accumulate and confuse
  future heartbeats. `start` runs `git worktree prune` opportunistically as a
  safety net, but explicit cleanup is the contract.

### Quick reference

```bash
# 1. Start work on ROGA-XX (defaults base branch to `main`)
WT=$(scripts/paperclip-worktree.sh start ROGA-XX main)
cd "$WT"

# 2. Do the work — edits, commits, pushes — all here.
git add -A
git commit -m "feat(scope): summary (ROGA-XX)

Co-Authored-By: Paperclip <noreply@paperclip.ing>"

# 3. (Optional) push the branch for PR
git push -u origin "$(git symbolic-ref --short HEAD)"

# 4. Before closing the issue
cd "$WORKSPACE_CWD/crm-maps"
scripts/paperclip-worktree.sh finish ROGA-XX
```

### Inspection / audit

```bash
scripts/paperclip-worktree.sh list
```

Shows every active worktree with its branch. Useful to verify cleanup before
ending a heartbeat or to diagnose unexpected disk usage.

## 2. Commit conventions

- Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:`,
  `ci:`, `build:`, `perf:`).
- Include the issue identifier in the commit subject when applicable, e.g.
  `feat(auth): middleware (ROGA-33)`.
- Every commit authored by a Paperclip agent **MUST** end with the trailer
  `Co-Authored-By: Paperclip <noreply@paperclip.ing>`.

## 3. Where this convention applies

- `crm-maps` (this repo) — primary.
- `roga` — same convention, tracked under [ROGA-64](/ROGA/issues/ROGA-64).
  Any change to the helper script or convention should be mirrored across
  both repos.

## 4. Why not orchestrator-side serialization (Opção B)?

Considered and rejected for this iteration (see ROGA-64 for the full record):

- Paperclip already provisions one workspace directory per agent
  (`workspaces/<agentId>/`). Per-agent isolation exists.
- Per-repo serialization would make two different agents (e.g. BackendEngineer
  and QA) wait on each other even for read-only access. That kills pipeline
  parallelism for no gain.
- Per-issue worktrees solve the intra-agent multi-issue case too — a single
  agent that switches between ROGA-XX and ROGA-YY can keep both worktrees open
  without `git checkout` thrashing.
- Worktree isolation is a native git feature; no orchestrator change required.

If a future case justifies serialization (e.g. heavyweight builds that should
not race), revisit by opening a follow-up issue and coordinating with the CTO.
