// The on-disk shape of one eval/fixtures/scenes.jsonl record. This is the
// contract between bootstrap.ts (writer) and run-eval.ts (reader): defining
// it once stops the two scripts' notions of the record from drifting.
import type { BeatInput } from "../src/rag/scenes.js";

export interface SerializedScene {
  id: string;
  timestamp: string;
  text: string;
  kind: string;
  beats: BeatInput[];
}
