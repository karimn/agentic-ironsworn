import type { DuckDBInstance } from "@duckdb/node-api";

type DuckDBConn = Awaited<ReturnType<DuckDBInstance["connect"]>>;

// ---------------------------------------------------------------------------
// DuckDB schema migrations
// ---------------------------------------------------------------------------

export interface DbMigration {
  version: number;
  description: string;
  up: (conn: DuckDBConn) => Promise<void>;
}

/**
 * Applies pending migrations in version order. Safe to call on fresh and
 * existing databases — version 0 is the implicit baseline.
 *
 * Core callers pass no namespace (or namespace="") and use the original
 * `_schema_migrations` table. Expansion callers pass a named namespace and
 * use `_schema_migrations_ns (namespace, version)` so their version numbers
 * never collide with core.
 */
export async function runDbMigrations(
  conn: DuckDBConn,
  migrations: DbMigration[],
  namespace = "",
): Promise<void> {
  if (namespace === "") {
    await runCoreMigrations(conn, migrations);
  } else {
    await runNamespacedMigrations(conn, migrations, namespace);
  }
}

async function runCoreMigrations(conn: DuckDBConn, migrations: DbMigration[]): Promise<void> {
  await conn.run(`
    CREATE TABLE IF NOT EXISTS _schema_migrations (
      version    INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);

  const result = await conn.runAndReadAll(
    "SELECT COALESCE(MAX(version), 0) AS v FROM _schema_migrations",
  );
  const rows = result.getRowObjectsJS() as Record<string, unknown>[];
  const raw = rows[0]?.["v"] ?? 0;
  const current = typeof raw === "bigint" ? Number(raw) : (raw as number);

  for (const migration of pending(migrations, current)) {
    await migration.up(conn);
    await conn.run("INSERT INTO _schema_migrations VALUES (?, ?)", [
      migration.version,
      new Date().toISOString(),
    ]);
    console.error(`[scribe] db migration [core] v${migration.version}: ${migration.description}`);
  }
}

async function runNamespacedMigrations(
  conn: DuckDBConn,
  migrations: DbMigration[],
  namespace: string,
): Promise<void> {
  await conn.run(`
    CREATE TABLE IF NOT EXISTS _schema_migrations_ns (
      namespace  TEXT NOT NULL DEFAULT '',
      version    INTEGER NOT NULL,
      applied_at TEXT NOT NULL,
      PRIMARY KEY (namespace, version)
    )
  `);

  const result = await conn.runAndReadAll(
    "SELECT COALESCE(MAX(version), 0) AS v FROM _schema_migrations_ns WHERE namespace = ?",
    [namespace],
  );
  const rows = result.getRowObjectsJS() as Record<string, unknown>[];
  const raw = rows[0]?.["v"] ?? 0;
  const current = typeof raw === "bigint" ? Number(raw) : (raw as number);

  for (const migration of pending(migrations, current)) {
    await migration.up(conn);
    await conn.run("INSERT INTO _schema_migrations_ns VALUES (?, ?, ?)", [
      namespace,
      migration.version,
      new Date().toISOString(),
    ]);
    console.error(`[scribe] db migration [${namespace}] v${migration.version}: ${migration.description}`);
  }
}

function pending(migrations: DbMigration[], current: number): DbMigration[] {
  return migrations
    .filter((m) => m.version > current)
    .sort((a, b) => a.version - b.version);
}

// ---------------------------------------------------------------------------
// Character JSON migrations
// ---------------------------------------------------------------------------

export interface CharacterMigration {
  toVersion: number;
  description: string;
  /** Pure transform: takes raw parsed JSON, returns updated raw JSON. */
  up: (data: Record<string, unknown>) => Record<string, unknown>;
}

/**
 * Applies any pending character migrations and stamps the current version.
 * Returns `{ data, migrated }` — caller saves to disk only when `migrated`
 * is true.
 */
export function runCharacterMigrations(
  data: Record<string, unknown>,
  migrations: CharacterMigration[],
  currentVersion: number,
): { data: Record<string, unknown>; migrated: boolean } {
  const savedVersion = (data["schemaVersion"] as number | undefined) ?? 0;
  if (savedVersion >= currentVersion) return { data, migrated: false };

  const pending = migrations
    .filter((m) => m.toVersion > savedVersion)
    .sort((a, b) => a.toVersion - b.toVersion);

  let result = data;
  for (const migration of pending) {
    result = migration.up(result);
    console.error(
      `[scribe] character migration v${migration.toVersion}: ${migration.description}`,
    );
  }
  result["schemaVersion"] = currentVersion;
  return { data: result, migrated: true };
}
