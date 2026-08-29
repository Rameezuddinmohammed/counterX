#!/usr/bin/env node
// Shared helper for CounterX's project hooks.
//
// Reads the Claude Code hook input JSON from stdin and prints the first
// non-empty string value found by walking each dotted-path argument in
// order — e.g. `read-hook-json.mjs tool_response.filePath tool_input.file_path`
// mirrors jq's `.tool_response.filePath // .tool_input.file_path` fallback
// idiom. Exists only because jq is not installed in this environment; Node
// is guaranteed present since it's this project's own runtime, so hooks stay
// dependency-free rather than silently no-op on a machine without jq.
//
// Prints nothing (and exits 0) on malformed input or no match — callers treat
// an empty result as "no match" rather than treating this as an error, so a
// hook never blocks normal work just because a field was absent.

let raw = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) raw += chunk;

let parsed;
try {
  parsed = JSON.parse(raw);
} catch {
  process.exit(0);
}

function get(obj, path) {
  return path.split(".").reduce((value, key) => {
    return value && typeof value === "object" ? value[key] : undefined;
  }, obj);
}

for (const path of process.argv.slice(2)) {
  const value = get(parsed, path);
  if (typeof value === "string" && value.length > 0) {
    process.stdout.write(value);
    process.exit(0);
  }
}
