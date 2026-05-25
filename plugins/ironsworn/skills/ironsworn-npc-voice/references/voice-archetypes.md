# Voice Archetypes — Starting Palette

A starting palette of voice archetypes you can blend with an NPC's recorded faction, disposition, and drives. **Never use these in place of the lore record** — they're a scaffold for *how* a recorded trait should sound, not a substitute for `get_npc` / `search_lore_global`.

For each archetype: **vocabulary** (words they reach for; words they avoid), **rhythm** (sentence shape, pacing), **negative space** (what they will not say, even under pressure).

---

## 1. The Hinterlander Clan-Warrior

- **When to reach for this**: Warrior or Mercenary role + Guarded Respect or Transactional disposition — someone who measures you by what you've earned, not what you say.
- **Vocabulary**: oaths, kin-words, weapon-names, weather. Avoids: abstractions ("perhaps", "concept", "frankly").
- **Rhythm**: short, declarative. Verbs first. Pauses where a softer speaker would qualify.
- **Negative space**: will not name a coward; will not explain a debt of blood; will not speak the dead's name lightly.

> "I rode three days. The horse is yours. The matter — that you and I will speak of by the fire."

---

## 2. The Deep Wilds Elder

- **When to reach for this**: Mystic, Priest, or Forester role + Preoccupied or Resignd disposition — someone whose attention is divided between this world and something older.
- **Vocabulary**: river, root, season, breath, the old word for things. Avoids: clock-time, coin-words, "I think".
- **Rhythm**: long, looping. Ends questions you didn't ask. Trails into silence and lets you fill it.
- **Negative space**: will not give a straight yes; will not name the spirits casually; will not confirm what you already know.

> "You came down through the alder cut. The hounds were quiet for you, then. That is something."

---

## 3. The Iron-Town Magistrate

- **Vocabulary**: oath, levy, custom, precedent, the law, the records. Avoids: "maybe", endearments, first names without title.
- **Rhythm**: balanced clauses, weight on the second half. Refers to itself in the third person under pressure.
- **Negative space**: will not contradict the written record in public; will not concede a favor; will not bend on a sworn matter even if the law is wrong.

> "The matter is recorded. The matter is closed. If the Ironsworn wishes the matter reopened, the Ironsworn will swear it before the stone."

---

## 4. The Smuggler-Captain

- **Vocabulary**: tide, weight, share, the run, *friend* (used as warning). Avoids: oaths, formal titles, the names of authorities.
- **Rhythm**: fast on the safe topics, slow and exact on numbers. Smiles in the wrong places.
- **Negative space**: will not name the buyer; will not say "no" — will say "not for that price"; will not ever say "always".

> "We carry. We don't ask. Your iron sees you across the sound — your name doesn't. Friend."

---

## 5. The Cleric of the Old Gods

- **Vocabulary**: wound, vigil, ash, the long road, the cost. Avoids: trivial pleasantries, modern names, anything quick.
- **Rhythm**: liturgical. Speaks in pairs. Repeats your own words back at you.
- **Negative space**: will not absolve without weight; will not lie in the temple; will not name the god they fear.

> "You came hungry. You came hungry and armed. The gods know which to feed first."

---

## 6. The Frostborn Diplomat

- **Vocabulary**: courtesy, distance, the long view, *kin* (used coldly). Avoids: contractions, slang, anger-words.
- **Rhythm**: even, glacial. Always one beat slower than the room expects.
- **Negative space**: will not raise voice; will not threaten directly — implies; will not break form even when struck.

> "You are tired. Sit. The wine is from your river. I had it brought up the day I was told you were coming."

---

## 7. The Broken Veteran

- **Vocabulary**: weight, the cold, *that one*, *the boy*, names not spoken. Avoids: grand words, present tense for old things.
- **Rhythm**: jagged. Starts strong, dies mid-sentence, restarts somewhere else.
- **Negative space**: will not look directly at certain objects; will not say the place-name; will not ask for help in plain words.

> "I — no. The pass. We took the pass. Most of us. Don't put me back there, Ironsworn. Don't."

---

## 8. The Trickster Stranger

- **Vocabulary**: questions, riddles, your own name said too often, fragments of three other dialects. Avoids: clarity.
- **Rhythm**: unpredictable. Answers a different question than the one asked. Repeats with a twist.
- **Negative space**: will not give a true name; will not stand still in a doorway; will not confirm what they did yesterday.

> "Yes. No. Both. — You asked it that way last time, too. Did you like the answer?"

---

## How to Use

1. Read the NPC record (`get_npc`) and lore (`search_lore_global`).
2. Find the archetype whose vocabulary/rhythm/negative-space *most matches* the recorded faction and disposition.
3. **Blend, don't copy.** Take the rhythm from one, the negative space from another, the vocabulary from the lore. The archetype is a starting frequency, not a costume.
4. After the scene, if a memorable phrase or refusal emerged, `upsert_npc` to make it durable.
