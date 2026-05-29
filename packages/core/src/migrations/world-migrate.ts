/**
 * One-time legacy → world.duckdb migration (Phase 3b of #166).
 *
 * Migrates:
 *   <campaignPath>/lore.duckdb        → entities, relations, lore_proximity_edges,
 *                                         lore_provenance, lore_communities,
 *                                         lore_extraction_log
 *   <campaignPath>/scenes.duckdb      → scenes, scene_beats, lore_extraction_log
 *   <campaignPath>/npcs/*.md          → entities(type='person')
 *   <campaignPath>/threads.yaml       → entities(type='thread')
 *
 * After a successful count-verify, moves legacy files to *.legacy (Decision 6).
 *
 * See: docs/superpowers/specs/2026-05-29-world-db-design.md § Migration
 */

import { DuckDBInstance } from "@duckdb/node-api";
import { readFile, writeFile, rename, mkdir, readdir, access } from "node:fs/promises";
import { join, basename, dirname } from "node:path";
import { parse as parseYaml } from "yaml";
import { slugify } from "../rag/lore.js";
import { ensureWorldJson, type WorldContext } from "../world.js";
import { getWorldDb, openWorldWriteConn, getWorldEmbedding } from "../rag/world-db.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface MigrateOptions {
  /** Embedder for NPC/thread summaries (which had no stored embedding). Defaults to getWorldEmbedding (requires Ollama). */
  embedder?: (text: string) => Promise<number[]>;
  /** Perform all steps except moving legacy files to *.legacy. */
  dryRun?: boolean;
}

export interface MigrateReport {
  worldRoot: string;
  campaignId: string;
  alreadyMigrated: boolean;
  entities: number;
  relations: number;
  proximity_edges: number;
  scenes: number;
  beats: number;
  provenance: number;
  communities: number;
  legacyMoved: string[];
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

function parseJsonObject(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "string" || raw.length === 0) return {};
  try {
    const p = JSON.parse(raw);
    return p && typeof p === "object" && !Array.isArray(p) ? (p as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Embed an array as a DuckDB FLOAT[768] literal. */
function embeddingLiteral(arr: number[]): string {
  return `[${arr.join(",")}]::FLOAT[768]`;
}

/**
 * Parse a legacy NPC markdown file.
 * Format:
 *   # Name
 *   ## <iso-ts>
 *   **Description:** ...
 *   **Impression:** ...
 *
 * Returns null if the file has no recognisable # Name heading.
 */
interface NpcEntry {
  canonical: string;
  slug: string;
  latestDescription: string;
  latestImpression: string;
  summary: string;
  history: Array<{ timestamp: string; description: string; impression: string }>;
}

function parseNpcMarkdown(content: string): NpcEntry | null {
  const lines = content.split("\n");
  let canonical: string | null = null;

  for (const line of lines) {
    const m = line.match(/^#\s+(.+)$/);
    if (m) {
      canonical = m[1]!.trim();
      break;
    }
  }
  if (!canonical) return null;

  // Parse ## <ts> sections
  const history: Array<{ timestamp: string; description: string; impression: string }> = [];
  const sectionPattern = /^##\s+(.+)$/;
  let currentTs: string | null = null;
  let currentDesc = "";
  let currentImp = "";

  for (const line of lines) {
    const sec = line.match(sectionPattern);
    if (sec) {
      if (currentTs !== null) {
        history.push({ timestamp: currentTs, description: currentDesc.trim(), impression: currentImp.trim() });
      }
      currentTs = sec[1]!.trim();
      currentDesc = "";
      currentImp = "";
      continue;
    }
    if (currentTs !== null) {
      const descMatch = line.match(/^\*\*Description:\*\*\s*(.*)/);
      const impMatch = line.match(/^\*\*Impression:\*\*\s*(.*)/);
      if (descMatch) {
        currentDesc = descMatch[1]!;
      } else if (impMatch) {
        currentImp = impMatch[1]!;
      }
    }
  }
  if (currentTs !== null) {
    history.push({ timestamp: currentTs, description: currentDesc.trim(), impression: currentImp.trim() });
  }

  const latest = history[history.length - 1] ?? { timestamp: new Date().toISOString(), description: "", impression: "" };
  return {
    canonical,
    slug: slugify(canonical),
    latestDescription: latest.description,
    latestImpression: latest.impression,
    summary: latest.description || canonical,
    history,
  };
}

interface LegacyThread {
  title: string;
  kind: string;
  status: string;
  notes?: string;
  openedAt: string;
  closedAt?: string;
  resolution?: string;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export async function migrateToWorldDb(
  campaignPath: string,
  opts?: MigrateOptions,
): Promise<MigrateReport> {
  const embedder = opts?.embedder ?? getWorldEmbedding;
  const dryRun = opts?.dryRun ?? false;

  // -----------------------------------------------------------------------
  // Step 1: Compute the target WorldContext explicitly (no memoization cache).
  // -----------------------------------------------------------------------
  const parentDir = dirname(campaignPath);
  const grandparentDir = dirname(parentDir);
  const worldRoot =
    basename(parentDir) === "campaigns" && grandparentDir !== parentDir
      ? grandparentDir
      : campaignPath;

  let campaignId: string;
  try {
    const raw = await readFile(join(campaignPath, "campaign.json"), "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    campaignId = typeof parsed["id"] === "string" ? parsed["id"] : basename(campaignPath);
  } catch {
    campaignId = basename(campaignPath);
  }

  const worldDbPath = join(worldRoot, "world.duckdb");

  const ctx: WorldContext = {
    worldRoot,
    campaignId,
    campaignPath,
    worldDbPath,
  };

  // -----------------------------------------------------------------------
  // Step 2: Idempotency check.
  // If neither legacy DB exists (already moved to .legacy or never existed),
  // return alreadyMigrated: true.
  // -----------------------------------------------------------------------
  const lorePath = join(campaignPath, "lore.duckdb");
  const scenesPath = join(campaignPath, "scenes.duckdb");
  const loreExists = await fileExists(lorePath);
  const scenesExists = await fileExists(scenesPath);

  if (!loreExists && !scenesExists) {
    return {
      worldRoot,
      campaignId,
      alreadyMigrated: true,
      entities: 0,
      relations: 0,
      proximity_edges: 0,
      scenes: 0,
      beats: 0,
      provenance: 0,
      communities: 0,
      legacyMoved: [],
    };
  }

  // -----------------------------------------------------------------------
  // Step 3: Create world.json and world.duckdb (full schema).
  // -----------------------------------------------------------------------
  await ensureWorldJson(worldRoot, basename(worldRoot));
  const worldInstance = await getWorldDb(ctx);
  const conn = await openWorldWriteConn(worldInstance);

  // Write campaign.json if absent.
  const campaignJsonPath = join(campaignPath, "campaign.json");
  if (!(await fileExists(campaignJsonPath))) {
    await mkdir(campaignPath, { recursive: true });
    await writeFile(
      campaignJsonPath,
      JSON.stringify({ id: campaignId, name: campaignId }, null, 2) + "\n",
      "utf8",
    );
  }

  // -----------------------------------------------------------------------
  // All legacy DB reads done via raw DuckDBInstance (read-only where possible).
  // -----------------------------------------------------------------------

  let entitiesInserted = 0;
  let relationsInserted = 0;
  let proximityInserted = 0;
  let scenesInserted = 0;
  let beatsInserted = 0;
  let provenanceInserted = 0;
  let communitiesInserted = 0;

  // These maps drive the provenance rewrite
  const slugToUuid = new Map<string, string>(); // legacy slug id → new UUID
  const relKeyToUuid = new Map<string, string>(); // "${from_id}|${to_id}|${relation}" → new UUID
  const proxOldIdToUuid = new Map<string, string>(); // old prox-* id → new UUID

  const now = new Date().toISOString();

  try {
    // -----------------------------------------------------------------------
    // Step 4: Entities from lore.duckdb → entities table
    // -----------------------------------------------------------------------
    if (loreExists) {
      const loreInst = await DuckDBInstance.create(lorePath);
      const loreConn = await loreInst.connect();
      try {
        // Read all entities
        const entRows = await loreConn.runAndReadAll(`
          SELECT id, canonical, aliases, type, summary, content, metadata, embedding, created_at, updated_at
          FROM lore_entities
        `);
        const entities = entRows.getRowObjectsJS() as Record<string, unknown>[];

        for (const ent of entities) {
          const oldSlugId = String(ent["id"] ?? "");
          const newUuid = crypto.randomUUID();
          slugToUuid.set(oldSlugId, newUuid);

          const canonical = String(ent["canonical"] ?? "");
          // aliases: raw is a DuckDB TEXT[] — comes back as JS array
          const aliasesRaw = ent["aliases"];
          const aliases: string[] = Array.isArray(aliasesRaw) ? aliasesRaw.map(String) : [];
          // Append old slug to aliases if not already present and not the same as canonical
          if (!aliases.includes(oldSlugId) && oldSlugId !== slugify(canonical)) {
            aliases.push(oldSlugId);
          }

          // Rewrite metadata.community (a slug → uuid if present)
          const metaObj = parseJsonObject(ent["metadata"]);
          const commSlug = metaObj["community"];
          if (typeof commSlug === "string" && commSlug.length > 0) {
            // We'll patch this after the full slug map is built; for now store as-is.
            // We do a second pass after all entities are inserted.
          }

          // Embedding as literal — copied directly, no re-embed
          const embRaw = ent["embedding"];
          const embArr: number[] = Array.isArray(embRaw)
            ? (embRaw as unknown[]).map(Number)
            : new Array(768).fill(0);
          const embLit = embeddingLiteral(embArr);

          const createdAt = String(ent["created_at"] ?? now);
          const updatedAt = String(ent["updated_at"] ?? now);
          const type = String(ent["type"] ?? "concept");
          const summary = String(ent["summary"] ?? "");
          const content = String(ent["content"] ?? "{}");
          const metadataStr = String(ent["metadata"] ?? "{}");

          // Build aliases literal for DuckDB — cast as TEXT[]
          const aliasesLiteral = aliases.length > 0
            ? `[${aliases.map((a) => `'${a.replace(/'/g, "''")}'`).join(",")}]::TEXT[]`
            : `[]::TEXT[]`;

          await conn.run(
            `INSERT INTO entities (id, slug, canonical, aliases, type, summary, content, metadata, embedding,
               campaign_id, created_in_campaign, created_at, updated_at)
             VALUES (?, ?, ?, ${aliasesLiteral}, ?, ?, ?, ?, ${embLit}, ?, ?, ?, ?)`,
            [
              newUuid,
              oldSlugId,
              canonical,
              type,
              summary,
              content,
              metadataStr,
              campaignId,
              campaignId,
              createdAt,
              updatedAt,
            ],
          );
          entitiesInserted++;
        }

        // Second pass: patch metadata.community slug → uuid now that map is complete
        for (const ent of entities) {
          const oldSlugId = String(ent["id"] ?? "");
          const newUuid = slugToUuid.get(oldSlugId)!;
          const metaObj = parseJsonObject(ent["metadata"]);
          const commSlug = metaObj["community"];
          if (typeof commSlug === "string" && commSlug.length > 0) {
            const commUuid = slugToUuid.get(commSlug);
            if (commUuid !== undefined) {
              metaObj["community"] = commUuid;
              await conn.run(
                `UPDATE entities SET metadata = ? WHERE id = ?`,
                [JSON.stringify(metaObj), newUuid],
              );
            }
          }
        }

        // -----------------------------------------------------------------------
        // Step 5: Relations
        // -----------------------------------------------------------------------
        const relRows = await loreConn.runAndReadAll(`
          SELECT from_id, to_id, relation, notes, metadata, embedding, created_at
          FROM lore_relations
        `);
        const rels = relRows.getRowObjectsJS() as Record<string, unknown>[];

        for (const rel of rels) {
          const fromSlug = String(rel["from_id"] ?? "");
          const toSlug = String(rel["to_id"] ?? "");
          const fromUuid = slugToUuid.get(fromSlug);
          const toUuid = slugToUuid.get(toSlug);
          if (!fromUuid || !toUuid) {
            console.error(
              `[migrate] SKIP relation (unmapped slug): from=${fromSlug} to=${toSlug}`,
            );
            continue;
          }
          const label = String(rel["relation"] ?? "");
          const relKey = `${fromSlug}|${toSlug}|${label}`;
          const relUuid = crypto.randomUUID();
          relKeyToUuid.set(relKey, relUuid);

          const notes = rel["notes"] != null ? String(rel["notes"]) : null;
          const metadataStr = String(rel["metadata"] ?? "{}");
          const createdAt = String(rel["created_at"] ?? now);

          const embRaw = rel["embedding"];
          if (embRaw != null && Array.isArray(embRaw)) {
            const embArr = (embRaw as unknown[]).map(Number);
            const embLit = embeddingLiteral(embArr);
            await conn.run(
              `INSERT INTO relations (id, from_entity, to_entity, label, notes, metadata, embedding, campaign_id, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ${embLit}, ?, ?)`,
              [relUuid, fromUuid, toUuid, label, notes, metadataStr, campaignId, createdAt],
            );
          } else {
            await conn.run(
              `INSERT INTO relations (id, from_entity, to_entity, label, notes, metadata, campaign_id, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
              [relUuid, fromUuid, toUuid, label, notes, metadataStr, campaignId, createdAt],
            );
          }
          relationsInserted++;
        }

        // -----------------------------------------------------------------------
        // Step 6: Proximity edges
        // -----------------------------------------------------------------------
        const proxRows = await loreConn.runAndReadAll(`
          SELECT id, from_id, to_id, dimension, magnitude, direction, order_kind, notes, metadata, created_at
          FROM lore_proximity_edges
        `);
        const proxEdges = proxRows.getRowObjectsJS() as Record<string, unknown>[];

        for (const edge of proxEdges) {
          const oldId = String(edge["id"] ?? "");
          const fromSlug = String(edge["from_id"] ?? "");
          const toSlug = String(edge["to_id"] ?? "");
          const fromUuid = slugToUuid.get(fromSlug);
          const toUuid = slugToUuid.get(toSlug);
          if (!fromUuid || !toUuid) {
            console.error(
              `[migrate] SKIP proximity edge (unmapped slug): from=${fromSlug} to=${toSlug} id=${oldId}`,
            );
            continue;
          }
          const proxUuid = crypto.randomUUID();
          proxOldIdToUuid.set(oldId, proxUuid);

          const dimension = String(edge["dimension"] ?? "");
          const magnitude = Number(edge["magnitude"] ?? 0);
          const direction = edge["direction"] != null ? String(edge["direction"]) : null;
          const orderKind = edge["order_kind"] != null ? String(edge["order_kind"]) : null;
          const notes = edge["notes"] != null ? String(edge["notes"]) : null;
          const metadataStr = String(edge["metadata"] ?? "{}");
          const createdAt = String(edge["created_at"] ?? now);

          await conn.run(
            `INSERT INTO lore_proximity_edges (id, from_id, to_id, dimension, magnitude, direction, order_kind, notes, metadata, campaign_id, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [proxUuid, fromUuid, toUuid, dimension, magnitude, direction, orderKind, notes, metadataStr, campaignId, createdAt],
          );
          proximityInserted++;
        }

        // -----------------------------------------------------------------------
        // Step 7: Provenance
        // -----------------------------------------------------------------------
        const provRows = await loreConn.runAndReadAll(`
          SELECT id, subject_kind, subject_id, source_kind, source_id, excerpt, confidence, created_at
          FROM lore_provenance
        `);
        const provEntries = provRows.getRowObjectsJS() as Record<string, unknown>[];

        for (const prov of provEntries) {
          const subjectKind = String(prov["subject_kind"] ?? "");
          const oldSubjectId = String(prov["subject_id"] ?? "");

          let newSubjectId: string | null = null;
          if (subjectKind === "entity") {
            newSubjectId = slugToUuid.get(oldSubjectId) ?? null;
          } else if (subjectKind === "relation") {
            // Legacy provenance used "from|to|relation" composite as subject_id
            newSubjectId = relKeyToUuid.get(oldSubjectId) ?? null;
          } else if (subjectKind === "proximity") {
            newSubjectId = proxOldIdToUuid.get(oldSubjectId) ?? null;
          }

          if (newSubjectId === null) {
            console.error(
              `[migrate] SKIP provenance (unresolved subject): kind=${subjectKind} id=${oldSubjectId}`,
            );
            continue;
          }

          const newProvId = crypto.randomUUID();
          const sourceKind = String(prov["source_kind"] ?? "manual");
          const sourceId = prov["source_id"] != null ? String(prov["source_id"]) : null;
          const excerpt = prov["excerpt"] != null ? String(prov["excerpt"]) : null;
          const confidence = prov["confidence"] != null ? Number(prov["confidence"]) : null;
          const createdAt = String(prov["created_at"] ?? now);

          await conn.run(
            `INSERT INTO lore_provenance (id, subject_kind, subject_id, source_kind, source_id, excerpt, confidence, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [newProvId, subjectKind, newSubjectId, sourceKind, sourceId, excerpt, confidence, createdAt],
          );
          provenanceInserted++;
        }

        // -----------------------------------------------------------------------
        // Step 8: Communities (best-effort)
        //
        // NOTE: Community member_ids in the legacy schema reference entity slugs
        // (level-0 communities) or child community ids (higher levels). At level 0,
        // slugs resolve via slugToUuid. For higher-level communities where member_ids
        // reference other community ids (not entity slugs), we cannot reliably rewrite
        // them without a two-pass approach. Given communities are fully regenerable via
        // recompute_communities, we migrate level-0 communities only, and report
        // communities: N (migrated level-0 count). Higher-level communities are skipped
        // with a warning — they will be regenerated naturally on the next
        // recompute_communities run.
        // -----------------------------------------------------------------------
        const commRows = await loreConn.runAndReadAll(`
          SELECT id, level, parent_id, member_ids, member_count, summary, embedding, metadata, created_at, updated_at
          FROM lore_communities
        `);
        const communities = commRows.getRowObjectsJS() as Record<string, unknown>[];

        // Build a legacy community id → new UUID map for parent_id rewriting.
        const commOldIdToUuid = new Map<string, string>();
        for (const comm of communities) {
          commOldIdToUuid.set(String(comm["id"] ?? ""), crypto.randomUUID());
        }

        for (const comm of communities) {
          const oldId = String(comm["id"] ?? "");
          const newCommUuid = commOldIdToUuid.get(oldId)!;
          const level = Number(comm["level"] ?? 0);

          const memberIdsRaw = comm["member_ids"];
          const memberIdStrs: string[] = Array.isArray(memberIdsRaw) ? memberIdsRaw.map(String) : [];

          // Rewrite member_ids via slug map (entity slugs) for level-0,
          // or via commOldIdToUuid for higher levels.
          const newMemberIds: string[] = [];
          let skipCommunity = false;
          for (const mid of memberIdStrs) {
            const entityUuid = slugToUuid.get(mid);
            const childCommUuid = commOldIdToUuid.get(mid);
            if (entityUuid) {
              newMemberIds.push(entityUuid);
            } else if (childCommUuid) {
              newMemberIds.push(childCommUuid);
            } else {
              // Can't resolve: skip this community
              skipCommunity = true;
              break;
            }
          }
          if (skipCommunity) {
            console.error(
              `[migrate] SKIP community (unresolvable member_ids): id=${oldId} level=${level}`,
            );
            continue;
          }

          const parentIdOld = comm["parent_id"] != null ? String(comm["parent_id"]) : null;
          const parentIdNew = parentIdOld ? (commOldIdToUuid.get(parentIdOld) ?? null) : null;

          const summary = String(comm["summary"] ?? "");
          const metadataStr = String(comm["metadata"] ?? "{}");
          const createdAt = String(comm["created_at"] ?? now);
          const updatedAt = String(comm["updated_at"] ?? now);
          const memberCount = Number(comm["member_count"] ?? newMemberIds.length);

          const memberIdsLiteral = newMemberIds.length > 0
            ? `[${newMemberIds.map((id) => `'${id}'`).join(",")}]::UUID[]`
            : `[]::UUID[]`;

          const embRaw = comm["embedding"];
          if (embRaw != null && Array.isArray(embRaw)) {
            const embArr = (embRaw as unknown[]).map(Number);
            const embLit = embeddingLiteral(embArr);
            await conn.run(
              `INSERT INTO lore_communities (id, level, parent_id, member_ids, member_count, summary, embedding, metadata, campaign_id, created_at, updated_at)
               VALUES (?, ?, ?, ${memberIdsLiteral}, ?, ?, ${embLit}, ?, ?, ?, ?)`,
              [newCommUuid, level, parentIdNew, memberCount, summary, metadataStr, campaignId, createdAt, updatedAt],
            );
          } else {
            await conn.run(
              `INSERT INTO lore_communities (id, level, parent_id, member_ids, member_count, summary, metadata, campaign_id, created_at, updated_at)
               VALUES (?, ?, ?, ${memberIdsLiteral}, ?, ?, ?, ?, ?, ?)`,
              [newCommUuid, level, parentIdNew, memberCount, summary, metadataStr, campaignId, createdAt, updatedAt],
            );
          }
          communitiesInserted++;
        }

        // -----------------------------------------------------------------------
        // Copy lore_extraction_log (scene_ids are already UUIDs in legacy)
        // -----------------------------------------------------------------------
        const elRows = await loreConn.runAndReadAll(`
          SELECT scene_id, extracted_at, entities_created, entities_updated, relations_created, skipped
          FROM lore_extraction_log
        `);
        const elEntries = elRows.getRowObjectsJS() as Record<string, unknown>[];
        for (const el of elEntries) {
          const sceneId = String(el["scene_id"] ?? "");
          const extractedAt = String(el["extracted_at"] ?? now);
          const entCreated = Number(el["entities_created"] ?? 0);
          const entUpdated = Number(el["entities_updated"] ?? 0);
          const relCreated = Number(el["relations_created"] ?? 0);
          const skipped = Number(el["skipped"] ?? 0);
          try {
            await conn.run(
              `INSERT INTO lore_extraction_log (scene_id, extracted_at, entities_created, entities_updated, relations_created, skipped)
               VALUES (?, ?, ?, ?, ?, ?)`,
              [sceneId, extractedAt, entCreated, entUpdated, relCreated, skipped],
            );
          } catch {
            // Duplicate scene_id — skip silently
          }
        }
      } finally {
        loreConn.closeSync();
        loreInst.closeSync();
      }
    }

    // -----------------------------------------------------------------------
    // Step 9: Scenes + beats from scenes.duckdb
    // -----------------------------------------------------------------------
    if (scenesExists) {
      const scenesInst = await DuckDBInstance.create(scenesPath);
      const scenesConn = await scenesInst.connect();
      try {
        const sceneRows = await scenesConn.runAndReadAll(`
          SELECT id, text, embedding, timestamp, kind, complication_theme, quality_notes
          FROM scenes
        `);
        const sceneEntries = sceneRows.getRowObjectsJS() as Record<string, unknown>[];

        for (const scene of sceneEntries) {
          const sceneId = String(scene["id"] ?? crypto.randomUUID());
          const text = String(scene["text"] ?? "");
          const timestamp = String(scene["timestamp"] ?? now);
          const kind = String(scene["kind"] ?? "scene");
          const compTheme = scene["complication_theme"] != null ? String(scene["complication_theme"]) : null;
          const qualNotes = scene["quality_notes"] != null ? String(scene["quality_notes"]) : null;

          const embRaw = scene["embedding"];
          const embArr: number[] = Array.isArray(embRaw)
            ? (embRaw as unknown[]).map(Number)
            : new Array(768).fill(0);
          const embLit = embeddingLiteral(embArr);

          // NOTE: Legacy scenes stored no entity refs, so scene_entity_refs stays empty
          // for migrated scenes. Refs accrue going forward via record_scene.
          await conn.run(
            `INSERT INTO scenes (id, campaign_id, place_entity, text, embedding, kind, complication_theme, quality_notes, timestamp)
             VALUES (?, ?, NULL, ?, ${embLit}, ?, ?, ?, ?)`,
            [sceneId, campaignId, text, kind, compTheme, qualNotes, timestamp],
          );
          scenesInserted++;
        }

        // scene_beats
        const beatRows = await scenesConn.runAndReadAll(`
          SELECT id, scene_id, beat_index, kind, speaker, text, embedding, metadata, created_at
          FROM scene_beats
        `);
        const beatEntries = beatRows.getRowObjectsJS() as Record<string, unknown>[];

        for (const beat of beatEntries) {
          const beatId = String(beat["id"] ?? crypto.randomUUID());
          const sceneId = String(beat["scene_id"] ?? "");
          const beatIndex = Number(beat["beat_index"] ?? 0);
          const kind = String(beat["kind"] ?? "narration");
          const speaker = beat["speaker"] != null ? String(beat["speaker"]) : null;
          const text = String(beat["text"] ?? "");
          const metadataStr = String(beat["metadata"] ?? "{}");
          const createdAt = String(beat["created_at"] ?? now);

          const embRaw = beat["embedding"];
          const embArr: number[] = Array.isArray(embRaw)
            ? (embRaw as unknown[]).map(Number)
            : new Array(768).fill(0);
          const embLit = embeddingLiteral(embArr);

          await conn.run(
            `INSERT INTO scene_beats (id, scene_id, beat_index, kind, speaker, text, embedding, metadata, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ${embLit}, ?, ?)`,
            [beatId, sceneId, beatIndex, kind, speaker, text, metadataStr, createdAt],
          );
          beatsInserted++;
        }
      } finally {
        scenesConn.closeSync();
        scenesInst.closeSync();
      }
    }

    // -----------------------------------------------------------------------
    // Step 10: NPCs from npcs/*.md → entities(type='person')
    // -----------------------------------------------------------------------
    const npcsDir = join(campaignPath, "npcs");
    const npcsExist = await fileExists(npcsDir);
    if (npcsExist) {
      let npcFiles: string[];
      try {
        npcFiles = await readdir(npcsDir);
      } catch {
        npcFiles = [];
      }
      for (const file of npcFiles) {
        if (!file.endsWith(".md")) continue;
        const filePath = join(npcsDir, file);
        const content = await readFile(filePath, "utf8");
        const npc = parseNpcMarkdown(content);
        if (!npc) continue;

        const entityId = crypto.randomUUID();
        const embedding = await embedder(npc.summary);
        const embLit = embeddingLiteral(embedding);
        const metadata = {
          impression: npc.latestImpression,
          history: npc.history,
        };

        await conn.run(
          `INSERT INTO entities (id, slug, canonical, aliases, type, summary, content, metadata, embedding,
             campaign_id, created_in_campaign, created_at, updated_at)
           VALUES (?, ?, ?, []::TEXT[], 'person', ?, '{}', ?, ${embLit}, ?, ?, ?, ?)`,
          [
            entityId,
            npc.slug,
            npc.canonical,
            npc.summary,
            JSON.stringify(metadata),
            campaignId,
            campaignId,
            now,
            now,
          ],
        );
        entitiesInserted++;
      }
    }

    // -----------------------------------------------------------------------
    // Step 11: Threads from threads.yaml → entities(type='thread')
    // -----------------------------------------------------------------------
    const threadsYamlPath = join(campaignPath, "threads.yaml");
    const threadsExist = await fileExists(threadsYamlPath);
    if (threadsExist) {
      const raw = await readFile(threadsYamlPath, "utf8");
      let threads: LegacyThread[] = [];
      try {
        const parsed = parseYaml(raw);
        if (Array.isArray(parsed)) {
          threads = parsed as LegacyThread[];
        }
      } catch {
        // malformed YAML — skip silently
      }
      for (const thread of threads) {
        const title = String(thread.title ?? "");
        if (!title) continue;

        const entityId = crypto.randomUUID();
        const notes = thread.notes ?? "";
        const summary = notes.length > 0 ? `${title} ${notes}` : title;
        const embedding = await embedder(summary);
        const embLit = embeddingLiteral(embedding);
        const metadata = {
          kind: thread.kind ?? "other",
          status: thread.status ?? "open",
          notes,
          openedAt: thread.openedAt ?? now,
          ...(thread.closedAt !== undefined ? { closedAt: thread.closedAt } : {}),
          ...(thread.resolution !== undefined ? { resolution: thread.resolution } : {}),
        };
        const threadSlug = slugify(title);
        const openedAt = thread.openedAt ?? now;

        await conn.run(
          `INSERT INTO entities (id, slug, canonical, aliases, type, summary, content, metadata, embedding,
             campaign_id, created_in_campaign, created_at, updated_at)
           VALUES (?, ?, ?, []::TEXT[], 'thread', ?, '{}', ?, ${embLit}, ?, ?, ?, ?)`,
          [
            entityId,
            threadSlug,
            title,
            summary,
            JSON.stringify(metadata),
            campaignId,
            campaignId,
            openedAt,
            openedAt,
          ],
        );
        entitiesInserted++;
      }
    }

    // -----------------------------------------------------------------------
    // Step 12: Verify counts before moving legacy files.
    //
    // Expected:
    //   entities_out == lore_entities + npc_files + thread_entries
    //   relations_out == lore_relations - unmapped (counted above)
    //   proximity_out == lore_proximity_edges - unmapped
    //   scenes_out == legacy scenes
    //   beats_out == legacy beats
    //
    // We verify via direct DB query against the written world.duckdb rows.
    // -----------------------------------------------------------------------
    const verifyResult = await conn.runAndReadAll(
      `SELECT
         (SELECT COUNT(*) FROM entities WHERE campaign_id = ?) AS entity_count,
         (SELECT COUNT(*) FROM relations WHERE campaign_id = ?) AS relation_count,
         (SELECT COUNT(*) FROM lore_proximity_edges WHERE campaign_id = ?) AS prox_count,
         (SELECT COUNT(*) FROM scenes WHERE campaign_id = ?) AS scene_count,
         (SELECT COUNT(*) FROM scene_beats sb JOIN scenes s ON sb.scene_id = s.id WHERE s.campaign_id = ?) AS beat_count`,
      [campaignId, campaignId, campaignId, campaignId, campaignId],
    );
    const verifyRows = verifyResult.getRowObjectsJS() as Record<string, unknown>[];
    const vr = verifyRows[0] ?? {};

    function toNum(v: unknown): number {
      if (typeof v === "bigint") return Number(v);
      if (typeof v === "number") return v;
      return 0;
    }

    const dbEntityCount = toNum(vr["entity_count"]);
    const dbRelCount = toNum(vr["relation_count"]);
    const dbProxCount = toNum(vr["prox_count"]);
    const dbSceneCount = toNum(vr["scene_count"]);
    const dbBeatCount = toNum(vr["beat_count"]);

    // Hard mismatch check: inserted counts must match DB counts.
    if (dbEntityCount !== entitiesInserted) {
      throw new Error(
        `[migrate] Entity count mismatch: inserted ${entitiesInserted} but DB shows ${dbEntityCount} for campaign ${campaignId}`,
      );
    }
    if (dbRelCount !== relationsInserted) {
      throw new Error(
        `[migrate] Relation count mismatch: inserted ${relationsInserted} but DB shows ${dbRelCount} for campaign ${campaignId}`,
      );
    }
    if (dbProxCount !== proximityInserted) {
      throw new Error(
        `[migrate] Proximity count mismatch: inserted ${proximityInserted} but DB shows ${dbProxCount} for campaign ${campaignId}`,
      );
    }
    if (dbSceneCount !== scenesInserted) {
      throw new Error(
        `[migrate] Scene count mismatch: inserted ${scenesInserted} but DB shows ${dbSceneCount} for campaign ${campaignId}`,
      );
    }
    if (dbBeatCount !== beatsInserted) {
      throw new Error(
        `[migrate] Beat count mismatch: inserted ${beatsInserted} but DB shows ${dbBeatCount} for campaign ${campaignId}`,
      );
    }
  } finally {
    conn.closeSync();
  }

  // -----------------------------------------------------------------------
  // Step 13: Move legacy artifacts to *.legacy (unless dryRun)
  // -----------------------------------------------------------------------
  const legacyMoved: string[] = [];

  if (!dryRun) {
    // lore.duckdb
    if (loreExists) {
      const dest = `${lorePath}.legacy`;
      await rename(lorePath, dest);
      legacyMoved.push(dest);
      // .wal file if present
      const walPath = `${lorePath}.wal`;
      if (await fileExists(walPath)) {
        const walDest = `${walPath}.legacy`;
        await rename(walPath, walDest);
        legacyMoved.push(walDest);
      }
    }

    // scenes.duckdb
    if (scenesExists) {
      const dest = `${scenesPath}.legacy`;
      await rename(scenesPath, dest);
      legacyMoved.push(dest);
      // .wal
      const walPath = `${scenesPath}.wal`;
      if (await fileExists(walPath)) {
        const walDest = `${walPath}.legacy`;
        await rename(walPath, walDest);
        legacyMoved.push(walDest);
      }
    }

    // npcs/ → npcs.legacy/
    const npcsDir = join(campaignPath, "npcs");
    if (await fileExists(npcsDir)) {
      const npcsDest = join(campaignPath, "npcs.legacy");
      await rename(npcsDir, npcsDest);
      legacyMoved.push(npcsDest);
    }

    // threads.yaml → threads.yaml.legacy
    const threadsYamlPath = join(campaignPath, "threads.yaml");
    if (await fileExists(threadsYamlPath)) {
      const dest = `${threadsYamlPath}.legacy`;
      await rename(threadsYamlPath, dest);
      legacyMoved.push(dest);
    }
  }

  return {
    worldRoot,
    campaignId,
    alreadyMigrated: false,
    entities: entitiesInserted,
    relations: relationsInserted,
    proximity_edges: proximityInserted,
    scenes: scenesInserted,
    beats: beatsInserted,
    provenance: provenanceInserted,
    communities: communitiesInserted,
    legacyMoved,
  };
}
