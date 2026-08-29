#!/bin/bash
# CounterX PostToolUse formatter — runs the project's own pinned Prettier on
# exactly the file that was just written or edited.
#
# Deterministic, no LLM involved, respects .prettierignore automatically
# (dist/build/.next/coverage/node_modules/*.md/etc. are silently skipped by
# Prettier itself, not duplicated here). Exists specifically because this
# repo has direct history of formatting drift accumulating unnoticed — see
# COUNTERX-ARCHITECTURE.md — so newly touched files are kept clean going
# forward without a bulk reformat ever being needed again.
#
# Never blocks or errors the turn: any failure (prettier missing, file
# outside the project, unparseable content) is silently skipped so this can
# never get in the way of normal autonomous development.

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(cd "$HOOK_DIR/../.." && pwd)}"

command -v node >/dev/null 2>&1 || exit 0

INPUT=$(cat)
FILE_PATH=$(printf '%s' "$INPUT" | node "$HOOK_DIR/read-hook-json.mjs" "tool_response.filePath" "tool_input.file_path" 2>/dev/null || true)

[ -n "$FILE_PATH" ] || exit 0
[ -f "$FILE_PATH" ] || exit 0

# Only format files inside this project; never touch anything outside it.
case "$FILE_PATH" in
  "$PROJECT_DIR"/*) ;;
  *) exit 0 ;;
esac

PRETTIER="$PROJECT_DIR/node_modules/.bin/prettier"
[ -x "$PRETTIER" ] || exit 0

( cd "$PROJECT_DIR" && "$PRETTIER" --write --ignore-unknown --log-level silent -- "$FILE_PATH" ) >/dev/null 2>&1 || true
exit 0
