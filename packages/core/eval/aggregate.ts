// Pure aggregation over repeated eval runs. The extractor is non-deterministic
// at temperature=0 (irreducible LLM API non-determinism), so a single run is
// not a reliable measure; we run N times and summarize. No DB/LLM/Ollama here —
// this is a pure function over Scorecards so it is unit-testable.
import type { Scorecard } from "./score.js";

export interface MetricStats {
  median: number;
  min: number;
  max: number;
}

export interface AggregateScorecard {
  runs: number;
  entity: { precision: MetricStats; recall: MetricStats; f1: MetricStats; typeAccuracy: MetricStats };
  relation: { precision: MetricStats; recall: MetricStats; f1: MetricStats; labelAccuracy: MetricStats };
  dedup: { score: MetricStats };
  // temporal is effectively binary per run (0/total or total/total); report the
  // fraction of runs that fully passed (passRate) and the mean correct count.
  temporal: { total: number; meanCorrect: number; passRate: number };
}

export function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1]! + s[mid]!) / 2 : s[mid]!;
}

function stats(nums: number[]): MetricStats {
  return { median: median(nums), min: Math.min(...nums), max: Math.max(...nums) };
}

export function aggregateScorecards(cards: Scorecard[]): AggregateScorecard {
  if (cards.length === 0) {
    throw new Error("aggregateScorecards: need at least one scorecard");
  }
  const pick = (f: (c: Scorecard) => number): MetricStats => stats(cards.map(f));
  const total = cards[0]!.temporal.total;
  const passes = cards.filter((c) => c.temporal.correct === c.temporal.total).length;
  const meanCorrect = cards.reduce((acc, c) => acc + c.temporal.correct, 0) / cards.length;
  return {
    runs: cards.length,
    entity: {
      precision: pick((c) => c.entity.precision),
      recall: pick((c) => c.entity.recall),
      f1: pick((c) => c.entity.f1),
      typeAccuracy: pick((c) => c.entity.typeAccuracy),
    },
    relation: {
      precision: pick((c) => c.relation.precision),
      recall: pick((c) => c.relation.recall),
      f1: pick((c) => c.relation.f1),
      labelAccuracy: pick((c) => c.relation.labelAccuracy),
    },
    dedup: { score: pick((c) => c.dedup.score) },
    temporal: { total, meanCorrect, passRate: passes / cards.length },
  };
}
