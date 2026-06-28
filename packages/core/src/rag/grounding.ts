// Retrieval-discipline enforcement (v1 priority #6). Entity-returning read
// tools (get_npc, search_lore) append this hint so the agent is told what to
// re-read before narrating: a direct read returns the stored record only, while
// `recall` surfaces the entity's recent scenes and the community context that
// keep narration coherent. Stateless by design — it always nudges toward recall.

export function groundingHint(subject?: string): string {
  if (subject && subject.trim().length > 0) {
    return (
      `Grounding reminder: before narrating ${subject}, call recall("${subject}"). ` +
      `This read returns the stored record only — recall adds the recent scenes ` +
      `and community context you need to stay consistent.`
    );
  }
  return (
    `Grounding reminder: before narrating any of these, call recall(<name>). ` +
    `This read returns stored records only — recall adds the recent scenes ` +
    `and community context you need to stay consistent.`
  );
}
