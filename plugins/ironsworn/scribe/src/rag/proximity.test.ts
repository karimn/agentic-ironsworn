import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  validateLinkInput,
  invertDirection,
  PROXIMITY_DIMENSIONS,
  COMPASS_POINTS,
  type LinkProximityInput,
  linkProximity,
} from "./proximity.js";
import { upsertLore } from "./lore.js";

describe("constants", () => {
  it("exposes the two dimensions", () => {
    expect(PROXIMITY_DIMENSIONS).toEqual(["space", "time"]);
  });

  it("exposes 8 compass points", () => {
    expect(COMPASS_POINTS).toEqual(["N", "NE", "E", "SE", "S", "SW", "W", "NW"]);
  });
});

describe("invertDirection", () => {
  it("inverts cardinal points", () => {
    expect(invertDirection("N")).toBe("S");
    expect(invertDirection("S")).toBe("N");
    expect(invertDirection("E")).toBe("W");
    expect(invertDirection("W")).toBe("E");
  });

  it("inverts ordinal points", () => {
    expect(invertDirection("NE")).toBe("SW");
    expect(invertDirection("SW")).toBe("NE");
    expect(invertDirection("NW")).toBe("SE");
    expect(invertDirection("SE")).toBe("NW");
  });
});

describe("validateLinkInput", () => {
  const base: LinkProximityInput = {
    from: "a",
    to: "b",
    dimension: "space",
    magnitude: 1,
    direction: "E",
  };

  it("rejects magnitude <= 0", () => {
    expect(() => validateLinkInput({ ...base, magnitude: 0 })).toThrow(/magnitude/);
    expect(() => validateLinkInput({ ...base, magnitude: -1 })).toThrow(/magnitude/);
  });

  it("rejects spatial input without direction", () => {
    const bad = { ...base } as LinkProximityInput;
    delete bad.direction;
    expect(() => validateLinkInput(bad)).toThrow(/direction/);
  });

  it("rejects spatial input with order_kind", () => {
    expect(() =>
      validateLinkInput({ ...base, order_kind: "before" } as LinkProximityInput),
    ).toThrow(/order_kind/);
  });

  it("rejects temporal input without order_kind", () => {
    expect(() =>
      validateLinkInput({
        from: "a",
        to: "b",
        dimension: "time",
        magnitude: 1,
      } as LinkProximityInput),
    ).toThrow(/order_kind/);
  });

  it("rejects temporal input with direction", () => {
    expect(() =>
      validateLinkInput({
        from: "a",
        to: "b",
        dimension: "time",
        magnitude: 1,
        order_kind: "before",
        direction: "N",
      } as LinkProximityInput),
    ).toThrow(/direction/);
  });

  it("accepts valid spatial input", () => {
    expect(() => validateLinkInput(base)).not.toThrow();
  });

  it("accepts valid temporal input", () => {
    expect(() =>
      validateLinkInput({
        from: "a",
        to: "b",
        dimension: "time",
        magnitude: 2,
        order_kind: "before",
      }),
    ).not.toThrow();
  });
});

let _ollamaReady: boolean | null = null;
async function ollamaAvailable(): Promise<boolean> {
  if (_ollamaReady !== null) return _ollamaReady;
  try {
    const baseUrl = process.env["OLLAMA_BASE_URL"] ?? "http://localhost:11434";
    const res = await fetch(`${baseUrl}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "nomic-embed-text", input: "t" }),
    });
    _ollamaReady = res.ok;
  } catch {
    _ollamaReady = false;
  }
  return _ollamaReady;
}

let campaignDir: string;

beforeEach(async () => {
  campaignDir = await mkdtemp(join(tmpdir(), "scribe-prox-test-"));
});

afterEach(async () => {
  await rm(campaignDir, { recursive: true, force: true });
});

async function seedPlace(name: string): Promise<string> {
  const r = await upsertLore(campaignDir, {
    canonical: name,
    type: "place",
    summary: `${name} is a place.`,
  });
  return r.id;
}

async function seedEvent(name: string): Promise<string> {
  const r = await upsertLore(campaignDir, {
    canonical: name,
    type: "event",
    summary: `${name} is an event.`,
  });
  return r.id;
}

describe("linkProximity — write path", () => {
  it("inserts a spatial edge and returns its id", async () => {
    if (!(await ollamaAvailable())) return;
    await seedPlace("Holtfen");
    await seedPlace("Hinge Stone");

    const result = await linkProximity(campaignDir, {
      from: "Holtfen",
      to: "Hinge Stone",
      dimension: "space",
      magnitude: 0.5,
      direction: "E",
    });

    expect(result.dimension).toBe("space");
    expect(result.updated).toBe(false);
    expect(result.warnings).toEqual([]);
    expect(result.id).toMatch(/^prox-/);
  });

  it("re-linking the same pair updates the row, not duplicates", async () => {
    if (!(await ollamaAvailable())) return;
    await seedPlace("A");
    await seedPlace("B");

    const first = await linkProximity(campaignDir, {
      from: "A", to: "B", dimension: "space", magnitude: 1, direction: "E",
    });
    const second = await linkProximity(campaignDir, {
      from: "A", to: "B", dimension: "space", magnitude: 2, direction: "E",
    });

    expect(second.id).toBe(first.id);
    expect(second.updated).toBe(true);
  });

  it("soft-warns when spatial edge connects non-place/non-faction entities", async () => {
    if (!(await ollamaAvailable())) return;
    await upsertLore(campaignDir, { canonical: "Idea X", type: "concept", summary: "x" });
    await upsertLore(campaignDir, { canonical: "Idea Y", type: "concept", summary: "y" });

    const result = await linkProximity(campaignDir, {
      from: "Idea X", to: "Idea Y", dimension: "space", magnitude: 1, direction: "N",
    });

    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings.join(" ")).toMatch(/concept/);
  });

  it("normalizes temporal 'after' to canonical 'before' storage", async () => {
    if (!(await ollamaAvailable())) return;
    const earlierId = await seedEvent("Founding");
    const laterId = await seedEvent("Calling");

    // Caller says: "Calling is AFTER Founding by 3 days"
    const result = await linkProximity(campaignDir, {
      from: laterId, to: earlierId, dimension: "time", magnitude: 3, order_kind: "after",
    });

    // Storage should be normalized: from = earlier, to = later, order = before
    expect(result.from_id).toBe(earlierId);
    expect(result.to_id).toBe(laterId);
  });

  it("canonicalizes spatial pair order alphabetically and inverts direction if swapped", async () => {
    if (!(await ollamaAvailable())) return;
    // Force an alphabetical inversion: "zeta" > "alpha"
    const alphaId = await seedPlace("Alpha");
    const zetaId = await seedPlace("Zeta");

    // Caller says: "Alpha is east of Zeta" => from=Zeta, to=Alpha, dir=E
    // Canonical storage: from=Alpha (lower), to=Zeta — so direction inverts E -> W
    const fromZeta = await linkProximity(campaignDir, {
      from: zetaId, to: alphaId, dimension: "space", magnitude: 1, direction: "E",
    });

    expect(fromZeta.from_id).toBe(alphaId);
    expect(fromZeta.to_id).toBe(zetaId);

    // Re-link in the canonical direction: should hit the same row.
    const fromAlpha = await linkProximity(campaignDir, {
      from: alphaId, to: zetaId, dimension: "space", magnitude: 1, direction: "W",
    });
    expect(fromAlpha.id).toBe(fromZeta.id);
    expect(fromAlpha.updated).toBe(true);
  });

  it("rejects invalid input (validation surface check)", async () => {
    if (!(await ollamaAvailable())) return;
    await seedPlace("A");
    await seedPlace("B");

    await expect(
      linkProximity(campaignDir, {
        from: "A", to: "B", dimension: "space", magnitude: -1, direction: "E",
      }),
    ).rejects.toThrow(/magnitude/);
  });
});
