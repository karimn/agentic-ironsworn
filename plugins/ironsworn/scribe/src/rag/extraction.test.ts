import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  extractLoreFromScene,
  extractUnprocessedScenes,
  _makeDefaultExtractor,
  type Extractor,
  type ExtractionResult,
  type ExtractionReport,
  type BatchReport,
} from "./extraction.js";
import { upsertLore, getLore } from "./lore.js";
import { LORE_TYPES } from "./lore.js";

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
  campaignDir = await mkdtemp(join(tmpdir(), "scribe-extraction-test-"));
});

afterEach(async () => {
  await rm(campaignDir, { recursive: true, force: true });
});

// Stub extractor — returns a fixed result, no LLM needed
function makeStubExtractor(result: ExtractionResult): Extractor {
  return async (_sceneText, _existingEntities) => result;
}

describe("_makeDefaultExtractor", () => {
  it("is a function", () => {
    expect(typeof _makeDefaultExtractor).toBe("function");
  });
});
