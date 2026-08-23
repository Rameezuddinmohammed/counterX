import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
const integrationTestFiles = [
  "packages/data/src/migrations.integration.test.ts",
  "packages/data/src/rls.integration.test.ts",
];

if (testDatabaseUrl === undefined || testDatabaseUrl.length === 0) {
  console.error(
    [
      "TEST_DATABASE_URL is required for db:test:lifecycle.",
      "Refusing to report skipped integration evidence as success.",
      "Start the isolated test database with `pnpm infra:test:up`.",
      "Then provide TEST_DATABASE_URL in .env or the process environment.",
    ].join("\n"),
  );
  process.exit(1);
}

const vitestCli = resolve(repoRoot, "node_modules", "vitest", "vitest.mjs");
const result = spawnSync(
  process.execPath,
  [vitestCli, "run", "--no-file-parallelism", "--reporter=json", ...integrationTestFiles],
  {
    cwd: repoRoot,
    encoding: "utf8",
    env: process.env,
    stdio: ["inherit", "pipe", "pipe"],
  },
);

if (result.error !== undefined) {
  console.error("Failed to start the database lifecycle test runner.");
  console.error(result.error);
  process.exit(1);
}

const stdout = result.stdout ?? "";
const stderr = result.stderr ?? "";
if (result.status !== 0) {
  process.stdout.write(stdout);
  process.stderr.write(stderr);
  process.exit(result.status ?? 1);
}

let report;
try {
  report = JSON.parse(stdout);
} catch (error) {
  process.stdout.write(stdout);
  process.stderr.write(stderr);
  console.error(
    "Could not parse lifecycle evidence; refusing to assume the integration tests ran.",
  );
  console.error(error);
  process.exit(1);
}

const problems = [];
const testResults = Array.isArray(report.testResults) ? report.testResults : [];
for (const testFile of integrationTestFiles) {
  const normalizedSuffix = `/${testFile.replaceAll("\\", "/")}`;
  const fileResult = testResults.find(
    (candidate) =>
      typeof candidate?.name === "string" &&
      candidate.name.replaceAll("\\", "/").endsWith(normalizedSuffix),
  );
  if (fileResult === undefined) {
    problems.push(`${testFile} did not produce a test-file result`);
    continue;
  }
  const assertions = Array.isArray(fileResult.assertionResults) ? fileResult.assertionResults : [];
  if (assertions.length === 0) {
    problems.push(`${testFile} produced no assertions (the suite may have been skipped)`);
    continue;
  }
  const nonPassing = assertions.filter((assertion) => assertion?.status !== "passed");
  if (nonPassing.length > 0) {
    problems.push(`${testFile} contains ${nonPassing.length} skipped or non-passing tests`);
  }
}

if ((report.numPendingTests ?? 0) > 0 || (report.numTodoTests ?? 0) > 0) {
  problems.push(
    `Vitest reported pending/todo tests: ${report.numPendingTests ?? 0}/${report.numTodoTests ?? 0}`,
  );
}
if (report.success !== true || (report.numFailedTests ?? 0) > 0) {
  problems.push("Vitest did not report a fully successful lifecycle run");
}

if (problems.length > 0) {
  process.stderr.write(stderr);
  console.error("Database lifecycle evidence was incomplete:");
  for (const problem of problems) {
    console.error(`- ${problem}`);
  }
  process.exit(1);
}

process.stderr.write(stderr);
console.log(
  `Database lifecycle evidence passed: ${report.numPassedTests}/${report.numTotalTests} tests`,
  `across ${integrationTestFiles.length} explicit files.`,
);
