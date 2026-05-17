import { describe, it, expect } from "bun:test";
import {
  validateLinkInput,
  invertDirection,
  PROXIMITY_DIMENSIONS,
  COMPASS_POINTS,
  type LinkProximityInput,
} from "./proximity.js";

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
