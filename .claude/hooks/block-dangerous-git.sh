#!/bin/bash
# CounterX PreToolUse guardrail — blocks dangerous git commands before they run.
#
# Adapted from the bundled `git-guardrails-claude-code` skill
# (.claude/skills/git-guardrails-claude-code/scripts/block-dangerous-git.sh):
# the original parses the hook's stdin JSON with `jq`, which is not installed
# in this environment. This version uses the project's own Node runtime
# (guaranteed present) via the sibling read-hook-json.mjs helper instead, so
# the guardrail never silently no-ops on a machine without jq.
#
# Wired in .claude/settings.json against matcher "Bash|PowerShell" — both
# shell tools available in this environment, not just Bash, since a command
# routed through the other tool would otherwise bypass this entirely.
#
# 2026-08-31: the founder authorized Claude to push its own feature-branch
# work overnight without a human running git push (see CLAUDE.md's
# "Autonomous engineering expectations" for the full grant and its limits).
# `git push` is therefore no longer in the unconditional DANGEROUS_PATTERNS
# list below — but pushing main/master, directly or implicitly (a bare
# `git push` while checked out on main/master), stays hard-blocked by this
# hook regardless of authorization level. Merges to main go through
# `gh pr merge`, never a direct push.

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! command -v node >/dev/null 2>&1; then
  echo "BLOCKED: git-guardrails hook could not find 'node' to parse its input; failing closed rather than risk an unchecked git command." >&2
  exit 2
fi

INPUT=$(cat)
COMMAND=$(printf '%s' "$INPUT" | node "$HOOK_DIR/read-hook-json.mjs" "tool_input.command" 2>/dev/null || true)

DANGEROUS_PATTERNS=(
  "git reset --hard"
  "git clean -fd"
  "git clean -f"
  "git branch -D"
  "git checkout \."
  "git restore \."
  "push --force"
  "push.*-f([[:space:]]|$)"
  "reset --hard"
)

for pattern in "${DANGEROUS_PATTERNS[@]}"; do
  if printf '%s' "$COMMAND" | grep -qE "$pattern"; then
    echo "BLOCKED: '$COMMAND' matches dangerous pattern '$pattern'. The user has prevented you from doing this." >&2
    exit 2
  fi
done

# git push is allowed to feature branches only. Block it outright if the
# command names main/master explicitly, or if it's a bare/implicit push
# while the repo is currently checked out on main/master.
if printf '%s' "$COMMAND" | grep -qE "git push"; then
  if printf '%s' "$COMMAND" | grep -qE "(^|[[:space:]/:])(main|master)([[:space:]]|$)"; then
    echo "BLOCKED: '$COMMAND' pushes to main/master, which this hook never allows regardless of authorization level." >&2
    exit 2
  fi
  REPO_DIR="${CLAUDE_PROJECT_DIR:-$HOOK_DIR/../..}"
  CURRENT_BRANCH=$(git -C "$REPO_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || true)
  if [ "$CURRENT_BRANCH" = "main" ] || [ "$CURRENT_BRANCH" = "master" ]; then
    echo "BLOCKED: '$COMMAND' would push the current branch '$CURRENT_BRANCH', which this hook never allows." >&2
    exit 2
  fi
fi

exit 0
