import { spawn } from "node:child_process";
import { mkdir, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

const loopbackHostnames = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export interface PostgresCommand {
  readonly executable: string;
  readonly arguments: readonly string[];
  readonly environment: NodeJS.ProcessEnv;
}

export interface BackupOptions {
  readonly databaseUrl: string;
  readonly outputPath?: string;
  readonly clientBinaryDirectory?: string;
  readonly workingDirectory?: string;
}

export interface RestoreOptions {
  readonly backupPath: string;
  readonly sourceDatabaseUrl: string;
  readonly targetDatabaseUrl: string;
  readonly clientBinaryDirectory?: string;
}

export function createBackupCommand(
  options: Required<Pick<BackupOptions, "databaseUrl">> & BackupOptions,
): PostgresCommand {
  const databaseUrl = validateLocalDatabaseUrl(options.databaseUrl, "source");
  const outputPath =
    options.outputPath ??
    join(
      options.workingDirectory ?? process.cwd(),
      ".local",
      "backups",
      `counter-${timestampForFilename(new Date())}.dump`,
    );

  return {
    executable: resolvePostgresBinary("pg_dump", options.clientBinaryDirectory),
    arguments: ["--format=custom", "--no-owner", "--no-privileges", "--file", outputPath],
    environment: postgresEnvironment(databaseUrl),
  };
}

export function createRestoreCommand(options: RestoreOptions): PostgresCommand {
  const source = validateLocalDatabaseUrl(options.sourceDatabaseUrl, "source");
  const target = validateLocalDatabaseUrl(options.targetDatabaseUrl, "restore-target");
  if (sameDatabase(source, target)) {
    throw new Error("Restore target must be separate from the backup source database");
  }

  return {
    executable: resolvePostgresBinary("pg_restore", options.clientBinaryDirectory),
    arguments: [
      "--clean",
      "--if-exists",
      "--no-owner",
      "--no-privileges",
      "--exit-on-error",
      "--dbname",
      target.pathname.replace(/^\//u, ""),
      options.backupPath,
    ],
    environment: postgresEnvironment(target),
  };
}

export async function createBackup(options: BackupOptions): Promise<string> {
  const command = createBackupCommand({ ...options, databaseUrl: options.databaseUrl });
  const fileIndex = command.arguments.indexOf("--file") + 1;
  const outputPath = command.arguments[fileIndex];
  if (outputPath === undefined) {
    throw new Error("Backup command did not contain an output path");
  }
  await mkdir(dirname(outputPath), { recursive: true });
  await runPostgresCommand(command);
  return outputPath;
}

export async function restoreBackup(options: RestoreOptions): Promise<void> {
  const backupStatus = await stat(options.backupPath);
  if (!backupStatus.isFile()) {
    throw new Error(`Backup path is not a file: ${basename(options.backupPath)}`);
  }
  await runPostgresCommand(createRestoreCommand(options));
}

function validateLocalDatabaseUrl(rawUrl: string, purpose: "source" | "restore-target"): URL {
  let databaseUrl: URL;
  try {
    databaseUrl = new URL(rawUrl);
  } catch {
    throw new Error("Database connection must be a valid URL");
  }
  if (databaseUrl.protocol !== "postgresql:" && databaseUrl.protocol !== "postgres:") {
    throw new Error("Database connection must use PostgreSQL");
  }
  if (!loopbackHostnames.has(databaseUrl.hostname)) {
    throw new Error("Backup and restore are restricted to loopback databases");
  }

  const databaseName = decodeURIComponent(databaseUrl.pathname.replace(/^\//u, ""));
  const allowedSource = databaseName === "counter_local" || databaseName === "counter_test";
  const allowedRestoreTarget = databaseName === "counter_test" || databaseName.endsWith("_restore");
  if (purpose === "source" ? !allowedSource : !allowedRestoreTarget) {
    throw new Error(
      purpose === "source"
        ? "Backups are restricted to counter_local or counter_test"
        : "Restore database names must be counter_test or end in _restore",
    );
  }

  return databaseUrl;
}

function postgresEnvironment(databaseUrl: URL): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { ...process.env };
  delete environment["DATABASE_URL"];
  delete environment["TEST_DATABASE_URL"];
  delete environment["RESTORE_DATABASE_URL"];

  environment["PGHOST"] = databaseUrl.hostname;
  environment["PGPORT"] = databaseUrl.port || "5432";
  environment["PGDATABASE"] = decodeURIComponent(databaseUrl.pathname.replace(/^\//u, ""));
  if (databaseUrl.username.length > 0) {
    environment["PGUSER"] = decodeURIComponent(databaseUrl.username);
  }
  if (databaseUrl.password.length > 0) {
    environment["PGPASSWORD"] = decodeURIComponent(databaseUrl.password);
  }
  return environment;
}

function resolvePostgresBinary(name: "pg_dump" | "pg_restore", directory?: string): string {
  if (directory === undefined || directory.length === 0) {
    return name;
  }
  return join(directory, process.platform === "win32" ? `${name}.exe` : name);
}

function sameDatabase(left: URL, right: URL): boolean {
  return (
    left.hostname === right.hostname &&
    (left.port || "5432") === (right.port || "5432") &&
    left.pathname === right.pathname
  );
}

function timestampForFilename(value: Date): string {
  return value.toISOString().replace(/[:.]/gu, "-");
}

async function runPostgresCommand(command: PostgresCommand): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command.executable, command.arguments, {
      env: command.environment,
      shell: false,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${basename(command.executable)} exited with status ${String(code)}`));
      }
    });
  });
}
