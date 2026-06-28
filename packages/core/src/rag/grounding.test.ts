import { describe, it, expect } from "bun:test";
import { groundingHint } from "./grounding.js";

// The grounding hint is the v1 #6 "retrieval discipline" enforcement: an
// entity-returning read tool appends this so the agent is told what to re-read
// (recall) before narrating. Stateless — it always names recall and the subject.

describe("groundingHint", () => {
  it("names recall and the subject when given one", () => {
    const hint = groundingHint("Caldren");
    expect(hint).toContain("recall");
    expect(hint).toContain("Caldren");
    expect(hint).toContain('recall("Caldren")');
  });

  it("tells the agent to ground before narrating", () => {
    expect(groundingHint("Lona").toLowerCase()).toContain("before narrating");
  });

  it("falls back to generic wording with no subject", () => {
    const hint = groundingHint();
    expect(hint).toContain("recall");
    expect(hint.toLowerCase()).toContain("before narrating");
    // No subject means no quoted name to interpolate.
    expect(hint).not.toContain('recall("undefined")');
  });
});
