import {
  upsertLore,
  getLore,
  linkLore,
  invalidateRelations,
  LORE_TYPES,
  type LoreType,
} from "./lore.js";
import { getScene } from "./scenes.js";

export interface BeatEntity {
  canonical: string;
  type: LoreType;
  summary: string;
  aliases?: string[];
}

export interface BeatRelation {
  from: string;
  to: string;
  label: string;
  notes?: string;
  supersedes?: boolean;
}

export interface BeatCanonResult {
  entities_created: number;
  entities_reused: number;
  relations_linked: number;
  skipped: string[];
}

// Resolve + write the structured canon a beat establishes. Entities first
// (exact-match reuse via getLore, else create campaign-scoped), then relations
// (both endpoints must resolve against the graph, which now includes the
// just-created entities). Unresolved relation endpoints are skipped with a
// notice — never auto-stubbed — to preserve the exact-match cleanliness that
// makes point-of-entry recording fragmentation-free.
export async function recordBeatCanon(
  campaignPath: string,
  sceneId: string,
  entities: BeatEntity[] = [],
  relations: BeatRelation[] = [],
): Promise<BeatCanonResult> {
  const result: BeatCanonResult = {
    entities_created: 0,
    entities_reused: 0,
    relations_linked: 0,
    skipped: [],
  };

  const scene = await getScene(campaignPath, sceneId);
  const validAt = scene?.timestamp;

  for (const e of entities) {
    if (!LORE_TYPES.includes(e.type)) {
      result.skipped.push(`entity "${e.canonical}": invalid type "${e.type}"`);
      continue;
    }
    const existing = await getLore(campaignPath, e.canonical);
    if (existing !== null) {
      result.entities_reused++;
      continue;
    }
    await upsertLore(campaignPath, {
      canonical: e.canonical,
      type: e.type,
      summary: e.summary,
      aliases: e.aliases,
      provenance: { source_kind: "beat", source_id: sceneId },
    });
    result.entities_created++;
  }

  for (const r of relations) {
    const fromEntity = await getLore(campaignPath, r.from);
    const toEntity = await getLore(campaignPath, r.to);
    if (fromEntity === null || toEntity === null) {
      const missing = [
        fromEntity === null ? r.from : null,
        toEntity === null ? r.to : null,
      ]
        .filter(Boolean)
        .map((name) => `"${name}"`)
        .join(" and ");
      result.skipped.push(
        `relation ${r.from} -[${r.label}]-> ${r.to}: ${missing} not found — ground it or add it to entities`,
      );
      continue;
    }
    if (r.supersedes && validAt) {
      await invalidateRelations(campaignPath, fromEntity.id, toEntity.id, validAt);
    }
    await linkLore(campaignPath, {
      from: fromEntity.id,
      to: toEntity.id,
      relation: r.label,
      notes: r.notes,
      valid_at: validAt,
      provenance: { source_kind: "beat", source_id: sceneId },
    });
    result.relations_linked++;
  }

  return result;
}
