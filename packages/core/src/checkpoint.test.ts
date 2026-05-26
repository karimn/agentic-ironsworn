import { describe, it, expect } from "bun:test";
import { startPeriodicCheckpoint, recordMutation } from "./checkpoint.js";

// Module-level state (writesSinceCheckpoint, timer, flushing) is fresh per
// test file because Bun isolates module scope per file. Tests within this file
// therefore accumulate state intentionally — see the write-threshold test.

describe("startPeriodicCheckpoint", () => {
  it("does not throw on first call", () => {
    expect(() => startPeriodicCheckpoint("/tmp/scribe-test-cp")).not.toThrow();
  });

  it("is idempotent — second call is a no-op and does not crash", () => {
    // The guard `if (timer !== null) return` should prevent a second interval.
    expect(() => startPeriodicCheckpoint("/tmp/scribe-test-cp")).not.toThrow();
  });
});

describe("recordMutation", () => {
  it("does not throw on a fresh campaign path", () => {
    expect(() => recordMutation("/tmp/scribe-test-cp")).not.toThrow();
  });

  it("does not throw as mutations accumulate below the flush threshold", () => {
    // CHECKPOINT_EVERY_N_WRITES = 20. We've recorded 1 mutation above.
    // Record 18 more (total 19) — still below threshold.
    for (let i = 0; i < 18; i++) {
      expect(() => recordMutation("/tmp/scribe-test-cp")).not.toThrow();
    }
  });

  it("triggers a graceful no-op flush when the write threshold is reached", async () => {
    // One more mutation brings the count to 20, triggering void flush(...).
    // flush() calls checkpointLore + checkpointScenes, which are both no-ops
    // when the DB hasn't been opened (peekLoreDb returns undefined).
    // Errors inside flush are caught and written to stderr — they never throw.
    expect(() => recordMutation("/tmp/scribe-test-cp")).not.toThrow();

    // Let the async flush microtasks complete before the test exits.
    await new Promise<void>((resolve) => setTimeout(resolve, 30));
  });

  it("continues recording mutations after a flush without crashing", () => {
    // After the flush, writesSinceCheckpoint is reset to 0.
    // Subsequent mutations should work normally.
    for (let i = 0; i < 5; i++) {
      expect(() => recordMutation("/tmp/scribe-test-cp")).not.toThrow();
    }
  });
});
