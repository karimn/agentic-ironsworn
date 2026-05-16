# Complication Archetypes by Ironlands Region

Region-specific complication palettes. Use these when the campaign is rooted in a known Ironlands region — the texture should *feel like* the place. Region descriptions are paraphrased from the rulebook (Chapter 4, pages 113-130) — `search_rules` for the canonical text before improvising.

The map is open; pull from your campaign's world truths (chapter 4 truths Q&A) rather than this list when they conflict. This is a **starter palette**, not a constraint.

---

## Barrier Islands (rulebook p.113)

Slate-cliff islands, fierce winds, persistent rain, sparse fisher-folk settlements.

- Sudden squall — visibility cuts to an arm's length; a known landmark vanishes.
- The wreck on the shore turns out to be recent.
- A spectral maiden at a ship's bow asks a price for safe passage (canonical quest starter).
- The fisher-folk have already left — the village is empty and the boats are gone.
- A seabird carries something in its beak it shouldn't.
- The cliff path crumbles where it didn't yesterday.

## Ragged Coast

Storm-lashed cliffs, raider-haunted shorelines, fjords thick with mist.

- Smoke on the horizon from the wrong direction.
- A shoreline that should be familiar isn't — the tide is wrong.
- Raider sails appear at the bay-mouth where you intended to camp.
- A fisherman pulls in a net heavy with what isn't fish.

## Deep Wilds (rulebook p.115)

Ancient forest, hanging moss, perpetual mist, elf-haunted, prehuman.

- The path closes behind — looking back, only trees.
- An elf, watching from the canopy, names the character (knowing-without-meeting).
- A growl that doesn't match any beast you know.
- The rain stops everywhere except directly overhead.
- Trees that are not trees — bark patterned in a way you can't keep looking at.
- A clearing with stones laid in old patterns; the air smells wrong.

## Flooded Lands

Swamps, fens, bogs, mire-holds, drowned ruins.

- The path through the fen is gone — peat that held yesterday won't today.
- Foul gas; the lantern flame turns blue.
- A mire-holdfolk elder won't open the gate without a tally settled.
- A drowned ruin breaches the waterline — something inside watching.
- Leeches; supply spoiled; a body in the reeds the locals don't claim.

## Havens (rulebook p.117)

Hill settlements, palisaded holds, deep winters, raider attacks, the seat of "civilization."

- A jarl's banner where it shouldn't be — politics has moved without you.
- The settlement gate is barred mid-day; no one will say why.
- A debt comes due at a feast; the tally-stick is produced in front of witnesses.
- The harvest failed; the holdfolk look at you and your supply.
- A leader you helped is now a tyrant; the people quietly ask if you'll fix what you started.

## Hinterlands (rulebook p.118)

Forested high country, hunter camps, varou bands, brutal winters.

- A varou war-song from beyond the firelight.
- The hunters' camp is empty and recently empty — fires still warm.
- The snowshoe trail you were following ends at a frozen body.
- A bear that should be hibernating, isn't.
- Your guide's loyalty cracks — the wages won't be enough to keep them past the next ridge.

## Tempest Hills (rulebook p.119)

Rugged hills, screaming winds, mining settlements, nomad camps, mammoth pastures.

- The wind carries a name (rulebook flavor: *"the winds carry the names of those fated to die"*).
- A mine entrance that wasn't there yesterday; an entrance gone today.
- An ironlander caravan, abandoned mid-route, the ore still loaded.
- A wyvern's shadow passing overhead.
- A nomad camp moved in the night — the circle of stones still warm.

## Veiled Mountains

High peaks, ancient passes, alpine cold, things older than Ironlanders.

- The pass that was open is filled with snow — not weather, an old door closing.
- Altitude sickness blurs the senses where it shouldn't.
- A cairn newly built; the stones still cold.
- A track of footprints that go up the cliff face.
- The path forks where there was no fork.

## Shattered Wastes

Stone, ash, ruin, the Old World's broken bones.

- A line of shadow that crosses no light source.
- A ruin's entrance where the carvings are still wet.
- The waste is silent in a way that hurts the ears.
- Iron rusts visibly while you watch.
- A traveler ahead on the road has been ahead of you for three days.

---

## How to Use This

1. Identify the region of the current scene (`search_lore` if uncertain, `search_rules` for canonical region flavor).
2. Cross-reference the region archetypes against `get_recent_complications` — pick a category that hasn't been used recently, that fits the region.
3. Texture it — one sensory detail, one named or describable thing.
4. Cross-link: if the complication involves an NPC, route voice and reactions through `ironsworn-npc-voice`. If it involves harm/stress/supply, `ironsworn-suffer` applies the cost. If it expands into a scene, `ironsworn-scene-craft` frames it.

Region archetypes are flavor, not destiny. A weather complication can land anywhere; what changes is *the kind of weather* and *what it implies about the place.* The Tempest Hills wind carries names; the Flooded Lands cold rises out of the ground; the Deep Wilds rain falls only on you. Region is the seasoning, not the dish.
