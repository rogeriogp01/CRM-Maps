#!/usr/bin/env bash
# paperclip-worktree.sh — per-issue git worktree helper for Paperclip agents.
#
# Convention (see AGENTS.md): every issue that mutates this repo MUST work in
# its own git worktree under $WORKSPACE_CWD. Agents never run `git checkout`
# in the primary clone. This script enforces that workflow with three verbs:
#
#   start  <issue-id> [base-branch]   create worktree + branch, print the path
#   finish <issue-id>                  remove worktree + prune (branch stays)
#   list                               show active worktrees with branch
#
# Idempotent: re-running `start` for an existing issue re-prints its path
# instead of failing; `finish` is a no-op when the worktree is already gone.
#
# Exit codes:
#   0   success (or idempotent no-op)
#   1   usage error
#   2   git error (e.g. base branch missing)

set -euo pipefail

usage() {
  cat <<USAGE
Usage:
  $(basename "$0") start  <issue-id> [base-branch]   # default base: main
  $(basename "$0") finish <issue-id>
  $(basename "$0") list

Environment:
  WORKSPACE_CWD   parent directory holding the primary clone and worktrees.
                  Defaults to the parent of the current repo root.

Convention: name the worktree directory <repo>-<issue-id> alongside the primary
clone. Branch is feat/<issue-id-lower>-<slug-from-issue-id>.
USAGE
}

# Resolve the primary clone (the directory holding .git as a real dir, or the
# linked worktree's main repo). We always cd to the script's repo root first.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PRIMARY_DIR="$(git -C "$SCRIPT_DIR" rev-parse --path-format=absolute --git-common-dir 2>/dev/null | sed 's|/\.git$||' || true)"
if [[ -z "${PRIMARY_DIR:-}" || ! -d "$PRIMARY_DIR" ]]; then
  # Fallback: assume script lives in <repo>/scripts and the repo is its parent.
  PRIMARY_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
fi

REPO_NAME="$(basename "$PRIMARY_DIR")"
PARENT_DIR="${WORKSPACE_CWD:-$(dirname "$PRIMARY_DIR")}"

prune_worktrees() {
  git -C "$PRIMARY_DIR" worktree prune >/dev/null 2>&1 || true
}

worktree_path_for() {
  local issue_id="$1"
  echo "$PARENT_DIR/${REPO_NAME}-${issue_id}"
}

branch_name_for() {
  local issue_id="$1"
  # lowercase + dash-only
  echo "feat/$(echo "$issue_id" | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9' '-' | sed 's/--*/-/g; s/^-//; s/-$//')-work"
}

cmd_start() {
  local issue_id="${1:-}"
  local base="${2:-main}"
  if [[ -z "$issue_id" ]]; then
    usage >&2
    exit 1
  fi

  prune_worktrees

  local target
  target="$(worktree_path_for "$issue_id")"
  local branch
  branch="$(branch_name_for "$issue_id")"

  # Idempotent: if worktree dir already registered, just print its path.
  if git -C "$PRIMARY_DIR" worktree list --porcelain | grep -Fq "worktree $target"; then
    echo "$target"
    return 0
  fi

  # If branch already exists locally, reuse it; otherwise create from base.
  if git -C "$PRIMARY_DIR" show-ref --verify --quiet "refs/heads/$branch"; then
    git -C "$PRIMARY_DIR" worktree add "$target" "$branch" >&2
  else
    if ! git -C "$PRIMARY_DIR" show-ref --verify --quiet "refs/heads/$base" \
        && ! git -C "$PRIMARY_DIR" show-ref --verify --quiet "refs/remotes/origin/$base"; then
      echo "error: base branch '$base' not found (local or origin/)" >&2
      exit 2
    fi
    git -C "$PRIMARY_DIR" worktree add "$target" -b "$branch" "$base" >&2
  fi

  echo "$target"
}

cmd_finish() {
  local issue_id="${1:-}"
  if [[ -z "$issue_id" ]]; then
    usage >&2
    exit 1
  fi

  local target
  target="$(worktree_path_for "$issue_id")"

  if git -C "$PRIMARY_DIR" worktree list --porcelain | grep -Fq "worktree $target"; then
    # --force tolerates uncommitted leftovers; agent is responsible for committing
    # / pushing BEFORE calling finish. We refuse to silently drop unpushed commits
    # only if the branch's upstream is set and behind — kept simple here.
    git -C "$PRIMARY_DIR" worktree remove --force "$target" >&2 || {
      echo "error: worktree remove failed for $target" >&2
      exit 2
    }
  fi
  prune_worktrees
  echo "removed: $target"
}

cmd_list() {
  prune_worktrees
  git -C "$PRIMARY_DIR" worktree list
}

case "${1:-}" in
  start)  shift; cmd_start "$@" ;;
  finish) shift; cmd_finish "$@" ;;
  list)   shift; cmd_list "$@" ;;
  -h|--help|help|"") usage ;;
  *) echo "unknown verb: $1" >&2; usage >&2; exit 1 ;;
esac
