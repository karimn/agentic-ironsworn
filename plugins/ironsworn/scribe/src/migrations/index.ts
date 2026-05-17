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
 * Creates a `_schema_migrations` table (if absent), determines the current
 * schema version, and applies any pending migrations in order. Safe to call
 * on both fresh and existing databases — version 0 is the implicit baseline
 * established by the `CREATE TABLE IF NOT EXISTS` calls in each initDb.
 */
export async function runDbMigrations(
  conn: DuckDBConn,
  migrations: DbMigration[],
): Promise<void> {
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

  const pending = migrations
    .filter((m) => m.version > current)
    .sort((a, b) => a.version - b.version);

  for (const migration of pending) {
    await migration.up(conn);
    await conn.run("INSERT INTO _schema_migrations VALUES (?, ?)", [
      migration.version,
      new Date().toISOString(),
    ]);
    console.error(
      `[scribe] db migration v${migration.version}: ${migration.description}`,
    );
  }
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
