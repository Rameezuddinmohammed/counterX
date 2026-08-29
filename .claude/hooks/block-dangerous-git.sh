#!/bin/bash
# CounterX PreToolUse guardrail — blocks dangerous git commands before they run.
#
# Adapted from the bundled `git-guardrails-claude-code` skill
# (.claude/skills/git-guardrails-claude-code/scripts/block-dangerous-git.sh):
# the original parses the hook's stdin JSON with `jq`, which is not installed
# in this environment. This version uses the project's own Node runtime
# (guaranteed present) via the sibling read-hook-json.mjs helper instead, so
# the guardrail never silently no-ops on a machine without jq. The blocked
# pattern list is unchanged from the original skill.
#
# Wired in .claude/settings.json against matcher "Bash|PowerShell" — both
# shell tools available in this environment, not just Bash, since a command
# routed through the other tool would otherwise bypass this entirely.

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! command -v node >/dev/null 2>&1; then
  echo "BLOCKED: git-guardrails hook could not find 'node' to parse its input; failing closed rather than risk an unchecked git command." >&2
  exit 2
fi

INPUT=$(cat)
COMMAND=$(printf '%s' "$INPUT" | node "$HOOK_DIR/read-hook-json.mjs" "tool_input.command" 2>/dev/null || true)

DANGEROUS_PATTERNS=(
  "git push"
  "git reset --hard"
  "git clean -fd"
  "git clean -f"
  "git branch -D"
  "git checkout \."
  "git restore \."
  "push --force"
  "reset --hard"
)

for pattern in "${DANGEROUS_PATTERNS[@]}"; do
  if printf '%s' "$COMMAND" | grep -qE "$pattern"; then
    echo "BLOCKED: '$COMMAND' matches dangerous pattern '$pattern'. The user has prevented you from doing this." >&2
    exit 2
  fi
done

exit 0
