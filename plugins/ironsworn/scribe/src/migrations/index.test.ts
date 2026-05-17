import { describe, it, expect } from "bun:test";
import { DuckDBInstance } from "@duckdb/node-api";
import { runDbMigrations, runCharacterMigrations } from "./index.js";

// ---------------------------------------------------------------------------
// runDbMigrations
// ---------------------------------------------------------------------------

describe("runDbMigrations", () => {
  it("creates _schema_migrations on a fresh in-memory DB", async () => {
    const inst = await DuckDBInstance.create(":memory:");
    const conn = await inst.connect();
    try {
      await runDbMigrations(conn, []);
      const res = await conn.runAndReadAll("SELECT COUNT(*) AS n FROM _schema_migrations");
      const rows = res.getRowObjectsJS() as Record<string, unknown>[];
      const n = rows[0]!["n"];
      expect(typeof n === "bigint" ? Number(n) : n).toBe(0);
    } finally {
      conn.closeSync();
    }
  });

  it("applies pending migrations in ascending version order", async () => {
    const inst = await DuckDBInstance.create(":memory:");
    const conn = await inst.connect();
    const order: number[] = [];
    try {
      await runDbMigrations(conn, [
        { version: 3, description: "v3", async up() { order.push(3); } },
        { version: 1, description: "v1", async up() { order.push(1); } },
        { version: 2, description: "v2", async up() { order.push(2); } },
      ]);
      expect(order).toEqual([1, 2, 3]);
    } finally {
      conn.closeSync();
    }
  });

  it("records applied versions in _schema_migrations", async () => {
    const inst = await DuckDBInstance.create(":memory:");
    const conn = await inst.connect();
    try {
      await runDbMigrations(conn, [
        { version: 1, description: "v1", async up() {} },
        { version: 2, description: "v2", async up() {} },
      ]);
      const res = await conn.runAndReadAll(
        "SELECT version FROM _schema_migrations ORDER BY version",
      );
      const rows = res.getRowObjectsJS() as Record<string, unknown>[];
      const versions = rows.map((r) => {
        const v = r["version"];
        return typeof v === "bigint" ? Number(v) : (v as number);
      });
      expect(versions).toEqual([1, 2]);
    } finally {
      conn.closeSync();
    }
  });

  it("skips migrations already applied (version <= current)", async () => {
    const inst = await DuckDBInstance.create(":memory:");
    const conn = await inst.connect();
    const ran: number[] = [];
    try {
      // Simulate version 1 already applied via direct insert.
      await conn.run(`
        CREATE TABLE IF NOT EXISTS _schema_migrations (
          version    INTEGER PRIMARY KEY,
          applied_at TEXT NOT NULL
        )
      `);
      await conn.run("INSERT INTO _schema_migrations VALUES (1, '2024-01-01T00:00:00.000Z')");

      await runDbMigrations(conn, [
        { version: 1, description: "v1", async up() { ran.push(1); } },
        { version: 2, description: "v2", async up() { ran.push(2); } },
      ]);
      expect(ran).toEqual([2]); // v1 is already applied, only v2 runs
    } finally {
      conn.closeSync();
    }
  });

  it("is idempotent — running the same migrations twice applies each only once", async () => {
    const inst = await DuckDBInstance.create(":memory:");
    const conn = await inst.connect();
    const ran: number[] = [];
    const migrations = [
      { version: 1, description: "v1", async up() { ran.push(1); } },
    ];
    try {
      await runDbMigrations(conn, migrations);
      await runDbMigrations(conn, migrations);
      expect(ran).toEqual([1]);
    } finally {
      conn.closeSync();
    }
  });

  it("migration up() can execute real DDL against the connection", async () => {
    const inst = await DuckDBInstance.create(":memory:");
    const conn = await inst.connect();
    try {
      await runDbMigrations(conn, [
        {
          version: 1,
          description: "create test_table",
          async up(c) {
            await c.run("CREATE TABLE test_table (x INTEGER)");
          },
        },
      ]);
      // Table should exist — will throw if absent
      await expect(conn.runAndReadAll("SELECT * FROM test_table")).resolves.toBeDefined();
    } finally {
      conn.closeSync();
    }
  });
});

// ---------------------------------------------------------------------------
// runCharacterMigrations
// ---------------------------------------------------------------------------

describe("runCharacterMigrations", () => {
  it("returns migrated=false when schemaVersion already equals currentVersion", () => {
    const data = { schemaVersion: 3 };
    const { data: out, migrated } = runCharacterMigrations(data, [], 3);
    expect(migrated).toBe(false);
    expect(out).toBe(data); // same reference — no copy made
  });

  it("returns migrated=false when schemaVersion exceeds currentVersion", () => {
    // e.g. opening an older binary against a campaign from a newer version
    const data = { schemaVersion: 5 };
    const { migrated } = runCharacterMigrations(data, [], 3);
    expect(migrated).toBe(false);
  });

  it("treats missing schemaVersion as version 0", () => {
    const data: Record<string, unknown> = {}; // no schemaVersion key
    const ran: number[] = [];
    runCharacterMigrations(
      data,
      [{ toVersion: 1, description: "v1", up(d) { ran.push(1); return d; } }],
      1,
    );
    expect(ran).toEqual([1]);
  });

  it("applies pending migrations in ascending toVersion order", () => {
    const data: Record<string, unknown> = {};
    const order: number[] = [];
    runCharacterMigrations(
      data,
      [
        { toVersion: 3, description: "v3", up(d) { order.push(3); return d; } },
        { toVersion: 1, description: "v1", up(d) { order.push(1); return d; } },
        { toVersion: 2, description: "v2", up(d) { order.push(2); return d; } },
      ],
      3,
    );
    expect(order).toEqual([1, 2, 3]);
  });

  it("skips migrations at or below saved version", () => {
    const data: Record<string, unknown> = { schemaVersion: 2 };
    const ran: number[] = [];
    runCharacterMigrations(
      data,
      [
        { toVersion: 1, description: "v1", up(d) { ran.push(1); return d; } },
        { toVersion: 2, description: "v2", up(d) { ran.push(2); return d; } },
        { toVersion: 3, description: "v3", up(d) { ran.push(3); return d; } },
      ],
      3,
    );
    expect(ran).toEqual([3]);
  });

  it("stamps currentVersion on the returned data", () => {
    const data: Record<string, unknown> = {};
    const { data: out } = runCharacterMigrations(
      data,
      [{ toVersion: 1, description: "v1", up(d) { return d; } }],
      1,
    );
    expect(out["schemaVersion"]).toBe(1);
  });

  it("returns migrated=true when at least one migration ran", () => {
    const data: Record<string, unknown> = { schemaVersion: 0 };
    const { migrated } = runCharacterMigrations(
      data,
      [{ toVersion: 1, description: "v1", up(d) { return d; } }],
      1,
    );
    expect(migrated).toBe(true);
  });

  it("chains transformations through multiple migrations", () => {
    const data: Record<string, unknown> = { name: "Kara" };
    const { data: out } = runCharacterMigrations(
      data,
      [
        { toVersion: 1, description: "add a", up(d) { return { ...d, a: 1 }; } },
        { toVersion: 2, description: "double a into b", up(d) { return { ...d, b: (d["a"] as number) * 2 }; } },
      ],
      2,
    );
    expect(out["name"]).toBe("Kara");
    expect(out["a"]).toBe(1);
    expect(out["b"]).toBe(2);
  });

  it("does not mutate the original data object", () => {
    const data: Record<string, unknown> = { x: 1 };
    const original = { ...data };
    runCharacterMigrations(
      data,
      [{ toVersion: 1, description: "spread copy", up(d) { return { ...d, y: 2 }; } }],
      1,
    );
    // The spread in up() creates a new object, so original should be unchanged
    expect(data).toEqual(original);
  });
});
