// Rules
export { roll } from "./rules/dice.js";
export type { RollResult } from "./rules/dice.js";

// State
export { npcFilePath, getNpc, upsertNpc, findStaleNpcs, getNpcLastUpdated, listNpcs, writeNpcRaw } from "./state/npcs.js";
export type { NpcStalenessInput, StaleNpc } from "./state/npcs.js";
export { loadThreads, saveThreads, openThread, closeThread, listThreads } from "./state/threads.js";
export type { Thread, ThreadKind, ThreadStatus } from "./state/threads.js";

// Migrations
export { runDbMigrations, runCharacterMigrations } from "./migrations/index.js";
export type { DbMigration, CharacterMigration } from "./migrations/index.js";
export { LORE_MIGRATIONS } from "./migrations/lore.js";
export { SCENES_MIGRATIONS } from "./migrations/scenes.js";
export { WORLD_MIGRATIONS } from "./migrations/world.js";
export { migrateToWorldDb } from "./migrations/world-migrate.js";
export type { MigrateOptions, MigrateReport } from "./migrations/world-migrate.js";

// RAG — lore DB
export { getLoreDb, openLoreWriteConn, getLoreEmbedding, peekLoreDb } from "./rag/lore-db.js";

// RAG — world DB
export { getWorldDb, peekWorldDb, openWorldWriteConn, getWorldEmbedding } from "./rag/world-db.js";
export type { WorldContext } from "./rag/world-db.js";

// World context + world.json helpers
export {
  resolveWorldContext,
  loadWorldJson,
  writeWorldJson,
  assertEmbeddingPin,
  ensureWorldJson,
  CURRENT_WORLD_SCHEMA_VERSION,
  DEFAULT_EMBEDDING_PIN,
} from "./world.js";
export type { EmbeddingPin, WorldJson } from "./world.js";

// RAG — lore
export { slugify, recordProvenance, upsertLore, searchLore, linkLore, getLoreGraph, getLore, listProvenance, exportLore, exportProvenance, replayProvenance, checkpointLore, canonizeEntity, decanonizeEntity, canonizeRelation, decanonizeRelation, LORE_TYPES } from "./rag/lore.js";
export type { LoreType, ProvenanceInput, ProvenanceEntry, LoreRelation, LoreEntity, LinkLoreInput, UpsertLoreInput, UpsertLoreResult, LoreSearchHit, LoreGraph, LoreEntityExport, LoreRelationExport } from "./rag/lore.js";

// RAG — recall (unified grounding dossier)
export { recall } from "./rag/recall.js";
export type { NearFilter, RecallOptions, RecallScene, RecallEntity, RecallCommunity, RecallResult } from "./rag/recall.js";

// RAG — contradictions
export {
  checkEntityContradiction,
  checkRelationContradiction,
  listContradictions,
  resolveContradiction,
  ENTITY_CONTRADICTION_THRESHOLD,
} from "./rag/contradictions.js";
export type { ContradictionFlag } from "./rag/contradictions.js";

// RAG — scenes
export { recordScene, getScene, updateScene, deleteScene, recordBeat, recordBeats, getBeats, searchBeats, exportScenes, importScene, checkpointScenes, searchScenes, getRecentScenesChronological, countScenesMentioningNpc, getRecentComplications, setSceneEntityRefs, getSceneEntityRefs, exportSceneEntityRefs } from "./rag/scenes.js";
export type { Scene, BeatInput, Beat, BeatSearchResult, BeatExport, SceneExport, RecentSceneSummary, ComplicationScene, BeatKind, SceneEntityRefExport } from "./rag/scenes.js";

// RAG — communities
export { stableCommunityId, clusterGraph, recomputeCommunities, listCommunities, getCommunity, searchCommunities, _makeDefaultSummarizer } from "./rag/communities.js";
export type { SummarizerEntity, SummarizerRelation, SummarizerInput, Summarizer, Embedder, RecomputeOptions, RecomputeReport, CommunityListItem, CommunityDetail, CommunitySearchHit, AnthropicLike } from "./rag/communities.js";

// RAG — proximity
export { invertDirection, validateLinkInput, linkProximity, proximityDistance, proximityWithin, exportProximity, PROXIMITY_DIMENSIONS, COMPASS_POINTS } from "./rag/proximity.js";
export type { ProximityDimension, CompassPoint, OrderKind, LinkProximityInput, LinkProximityResult, ProximityDistance, ProximityNeighbor, ProximityEdgeExport } from "./rag/proximity.js";

// RAG — extraction
export { extractLoreFromScene, extractUnprocessedScenes, _makeDefaultExtractor } from "./rag/extraction.js";
export type { ExtractedEntity, ExtractedRelation, ExtractionResult, ExtractionReport, BatchReport, ExtractOptions, Extractor } from "./rag/extraction.js";

// RAG — beat-queue
export { pushBeat, drainNotices, replayFailures, shutdown, _setRecordBeatFn, _resetRecordBeatFn } from "./rag/beat-queue.js";
export type { BeatQueueEntry } from "./rag/beat-queue.js";

// Checkpoint
export { startPeriodicCheckpoint, recordMutation } from "./checkpoint.js";

// Tools
export { register as registerNarrativeTools, buildSceneWarnings } from "./tools/narrative.js";
export type { SceneReferenceResult } from "./tools/narrative.js";
export { register as registerLoreTools } from "./tools/lore.js";
export { register as registerCampaignTools } from "./tools/campaign.js";
