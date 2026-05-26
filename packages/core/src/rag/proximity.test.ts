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

describe("proximityDistance", () => {
  it("returns 0 between an entity and itself", async () => {
    if (!(await ollamaAvailable())) return;
    const aId = await seedPlace("A");
    const { proximityDistance } = await import("./proximity.js");
    const result = await proximityDistance(campaignDir, aId, aId, "space");
    expect(result).toEqual({ distance: 0, unit: "days walk" });
  });

  it("returns null for disconnected entities", async () => {
    if (!(await ollamaAvailable())) return;
    await seedPlace("A");
    await seedPlace("B");
    const { proximityDistance } = await import("./proximity.js");
    const result = await proximityDistance(campaignDir, "A", "B", "space");
    expect(result).toBeNull();
  });

  it("accumulates magnitude across edges (A → B → C)", async () => {
    if (!(await ollamaAvailable())) return;
    await seedPlace("A");
    await seedPlace("B");
    await seedPlace("C");
    await linkProximity(campaignDir, {
      from: "A", to: "B", dimension: "space", magnitude: 1, direction: "E",
    });
    await linkProximity(campaignDir, {
      from: "B", to: "C", dimension: "space", magnitude: 2, direction: "E",
    });

    const { proximityDistance } = await import("./proximity.js");
    const result = await proximityDistance(campaignDir, "A", "C", "space");
    expect(result?.distance).toBe(3);
    expect(result?.unit).toBe("days walk");
  });

  it("is symmetric (C → A == A → C)", async () => {
    if (!(await ollamaAvailable())) return;
    await seedPlace("A");
    await seedPlace("B");
    await seedPlace("C");
    await linkProximity(campaignDir, {
      from: "A", to: "B", dimension: "space", magnitude: 1, direction: "E",
    });
    await linkProximity(campaignDir, {
      from: "B", to: "C", dimension: "space", magnitude: 2, direction: "E",
    });

    const { proximityDistance } = await import("./proximity.js");
    const forward = await proximityDistance(campaignDir, "A", "C", "space");
    const backward = await proximityDistance(campaignDir, "C", "A", "space");
    expect(forward?.distance).toBe(backward?.distance);
  });

  it("isolates dimensions (spatial edges don't bridge temporal queries)", async () => {
    if (!(await ollamaAvailable())) return;
    await seedPlace("A");
    await seedPlace("B");
    await linkProximity(campaignDir, {
      from: "A", to: "B", dimension: "space", magnitude: 1, direction: "E",
    });

    const { proximityDistance } = await import("./proximity.js");
    const result = await proximityDistance(campaignDir, "A", "B", "time");
    expect(result).toBeNull();
  });

  it("returns 'days' unit for temporal queries", async () => {
    if (!(await ollamaAvailable())) return;
    await seedEvent("E1");
    await seedEvent("E2");
    await linkProximity(campaignDir, {
      from: "E1", to: "E2", dimension: "time", magnitude: 5, order_kind: "before",
    });

    const { proximityDistance } = await import("./proximity.js");
    const result = await proximityDistance(campaignDir, "E1", "E2", "time");
    expect(result?.distance).toBe(5);
    expect(result?.unit).toBe("days");
  });
});

describe("proximityWithin", () => {
  it("returns the anchor itself at distance 0", async () => {
    if (!(await ollamaAvailable())) return;
    const aId = await seedPlace("A");
    const { proximityWithin } = await import("./proximity.js");
    const within = await proximityWithin(campaignDir, aId, 1, "space");
    expect(within.length).toBe(1);
    expect(within[0].id).toBe(aId);
    expect(within[0].distance).toBe(0);
  });

  it("includes nodes within the radius and excludes nodes beyond it", async () => {
    if (!(await ollamaAvailable())) return;
    await seedPlace("A");
    await seedPlace("B");
    await seedPlace("C");
    await linkProximity(campaignDir, {
      from: "A", to: "B", dimension: "space", magnitude: 1, direction: "E",
    });
    await linkProximity(campaignDir, {
      from: "B", to: "C", dimension: "space", magnitude: 2, direction: "E",
    });

    const { proximityWithin } = await import("./proximity.js");
    const within = await proximityWithin(campaignDir, "A", 1.5, "space");
    const ids = within.map((n) => n.id);
    expect(ids).toContain("a");
    expect(ids).toContain("b");
    expect(ids).not.toContain("c");
  });

  it("returns results sorted ascending by distance", async () => {
    if (!(await ollamaAvailable())) return;
    await seedPlace("A");
    await seedPlace("B");
    await seedPlace("C");
    await linkProximity(campaignDir, {
      from: "A", to: "B", dimension: "space", magnitude: 1, direction: "E",
    });
    await linkProximity(campaignDir, {
      from: "B", to: "C", dimension: "space", magnitude: 2, direction: "E",
    });

    const { proximityWithin } = await import("./proximity.js");
    const within = await proximityWithin(campaignDir, "A", 10, "space");
    const distances = within.map((n) => n.distance);
    for (let i = 1; i < distances.length; i++) {
      expect(distances[i]).toBeGreaterThanOrEqual(distances[i - 1]);
    }
  });

  it("populates canonical and type for each neighbor", async () => {
    if (!(await ollamaAvailable())) return;
    await seedPlace("Holtfen");
    await seedPlace("Hinge Stone");
    await linkProximity(campaignDir, {
      from: "Holtfen", to: "Hinge Stone",
      dimension: "space", magnitude: 0.5, direction: "E",
    });

    const { proximityWithin } = await import("./proximity.js");
    const within = await proximityWithin(campaignDir, "Holtfen", 1, "space");
    const stone = within.find((n) => n.id === "hinge-stone");
    expect(stone).toBeDefined();
    expect(stone!.canonical).toBe("Hinge Stone");
    expect(stone!.type).toBe("place");
  });
});

import { exportProximity } from "./proximity.js";

describe("exportProximity", () => {
  it("returns all stored edges with all columns", async () => {
    if (!(await ollamaAvailable())) return;
    await seedPlace("A");
    await seedPlace("B");
    await seedEvent("E1");
    await seedEvent("E2");

    await linkProximity(campaignDir, {
      from: "A", to: "B", dimension: "space", magnitude: 1, direction: "E",
    });
    await linkProximity(campaignDir, {
      from: "E1", to: "E2", dimension: "time", magnitude: 3, order_kind: "before",
    });

    const edges = await exportProximity(campaignDir);
    expect(edges.length).toBe(2);

    const space = edges.find((e) => e.dimension === "space");
    expect(space?.direction).toBe("E");
    expect(space?.order_kind).toBeNull();

    const time = edges.find((e) => e.dimension === "time");
    expect(time?.order_kind).toBe("before");
    expect(time?.direction).toBeNull();
  });
});
