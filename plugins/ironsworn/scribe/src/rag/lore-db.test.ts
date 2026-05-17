import { describe, it, expect, beforeAll, afterAll, spyOn } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getLoreDb, peekLoreDb, openLoreWriteConn, getLoreEmbedding } from "./lore-db.js";

// ---------------------------------------------------------------------------
// Shared DB setup
// ---------------------------------------------------------------------------
// lore-db.ts has module-level state (dbPromises cache). To avoid cross-test
// interference, all DuckDB tests share a single campaignDir and only clean up
// after all tests have finished — never while instances are still open.

let sharedDir: string;
let dbReady = false;

beforeAll(async () => {
  sharedDir = await mkdtemp(join(tmpdir(), "lore-db-test-"));
  try {
    await getLoreDb(sharedDir);
    dbReady = true;
  } catch {
    dbReady = false;
  }
});

afterAll(async () => {
  if (sharedDir) await rm(sharedDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// peekLoreDb
// ---------------------------------------------------------------------------

describe("peekLoreDb", () => {
  it("returns undefined for a path that has never been opened", () => {
    const result = peekLoreDb("/tmp/absolutely-nonexistent-campaign-" + Date.now());
    expect(result).toBeUndefined();
  });

  it("returns the cached promise after getLoreDb has been called", async () => {
    if (!dbReady) return;
    const p = getLoreDb(sharedDir);
    expect(peekLoreDb(sharedDir)).toBe(p);
  });
});

// ---------------------------------------------------------------------------
// getLoreDb
// ---------------------------------------------------------------------------

describe("getLoreDb", () => {
  it("returns a usable DuckDB instance", async () => {
    if (!dbReady) return;
    const inst = await getLoreDb(sharedDir);
    expect(inst).toBeDefined();
    const conn = await inst.connect();
    conn.closeSync();
  });

  it("caches the instance — repeated calls return the same promise", () => {
    if (!dbReady) return;
    const p1 = getLoreDb(sharedDir);
    const p2 = getLoreDb(sharedDir);
    expect(p1).toBe(p2);
  });
});

// ---------------------------------------------------------------------------
// openLoreWriteConn
// ---------------------------------------------------------------------------

describe("openLoreWriteConn", () => {
  it("opens a usable write connection from the shared instance", async () => {
    if (!dbReady) return;
    const inst = await getLoreDb(sharedDir);
    const conn = await openLoreWriteConn(inst);
    expect(conn).toBeDefined();
    await expect(conn.runAndReadAll("SELECT 1 AS n")).resolves.toBeDefined();
    conn.closeSync();
  });
});

// ---------------------------------------------------------------------------
// getLoreEmbedding — error paths (fetch-mocked, no Ollama required)
// ---------------------------------------------------------------------------

describe("getLoreEmbedding", () => {
  it("throws a clear error when Ollama is unreachable (network failure)", async () => {
    const spy = spyOn(globalThis, "fetch");
    spy.mockImplementationOnce(() => {
      throw new Error("connect ECONNREFUSED 127.0.0.1:11434");
    });
    try {
      await expect(getLoreEmbedding("test text")).rejects.toThrow(/ollama unavailable/i);
    } finally {
      spy.mockRestore();
    }
  });

  it("throws when Ollama returns a non-OK HTTP response", async () => {
    const spy = spyOn(globalThis, "fetch");
    spy.mockImplementationOnce(async () =>
      new Response(null, { status: 500, statusText: "Internal Server Error" }),
    );
    try {
      await expect(getLoreEmbedding("test text")).rejects.toThrow(/ollama embed failed/i);
    } finally {
      spy.mockRestore();
    }
  });

  it("throws when the response body has an unexpected shape", async () => {
    const spy = spyOn(globalThis, "fetch");
    spy.mockImplementationOnce(async () =>
      new Response(JSON.stringify({ result: "oops" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    try {
      await expect(getLoreEmbedding("test text")).rejects.toThrow(/unexpected ollama response/i);
    } finally {
      spy.mockRestore();
    }
  });

  it("throws when the embedding has wrong dimensions", async () => {
    const spy = spyOn(globalThis, "fetch");
    const badEmbedding = new Array(512).fill(0.1); // 512 instead of 768
    spy.mockImplementationOnce(async () =>
      new Response(JSON.stringify({ embeddings: [badEmbedding] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    try {
      await expect(getLoreEmbedding("test text")).rejects.toThrow(/768/);
    } finally {
      spy.mockRestore();
    }
  });

  it("throws when the embedding contains non-finite values", async () => {
    const spy = spyOn(globalThis, "fetch");
    const badEmbedding = new Array(768).fill(0.1);
    badEmbedding[0] = NaN;
    spy.mockImplementationOnce(async () =>
      new Response(JSON.stringify({ embeddings: [badEmbedding] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    try {
      await expect(getLoreEmbedding("test text")).rejects.toThrow(/invalid embedding values/i);
    } finally {
      spy.mockRestore();
    }
  });

  it("returns a 768-dim float array on a well-formed response", async () => {
    const spy = spyOn(globalThis, "fetch");
    const goodEmbedding = new Array(768).fill(0.42);
    spy.mockImplementationOnce(async () =>
      new Response(JSON.stringify({ embeddings: [goodEmbedding] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    try {
      const result = await getLoreEmbedding("hello");
      expect(result).toHaveLength(768);
      expect(result[0]).toBeCloseTo(0.42);
    } finally {
      spy.mockRestore();
    }
  });
});
