# Ironsworn World Truths — Simulation Transcript
**Mode:** Without skill guidance  
**Date:** 2026-04-26  
**Iteration:** 1, Eval: eval-1-full-run

---

## Opening

**GM:** Welcome. Before your story begins, we must establish the shape of your world — the truths that define the Ironlands. There are eleven categories. For each, I'll offer you the standard options, and you'll choose the one that fits the campaign you want to tell. Some will have three options; some I'll describe freely from memory. Let's begin.

---

## Truth 1: The Old World

**GM:** First, why did your people leave the Old World?

- **Option A — Exodus from Ruin:** The Old World fell to catastrophe — some say plague, some say war without end. Your people fled in great ships and found this new land.
- **Option B — Fleeing Darkness:** A great darkness arose in the Old World, something ancient and hungry. The survivors crossed the vast ocean to escape it, and they carry the memory of that evil like a wound.
- **Option C — The Old World is a Mystery:** No one knows, or no one will say. The elders who remember are long dead. The truth of the Old World is lost, and some believe it is better that way.

**Player:** Option B sounds compelling — I like the idea that something followed them, or at least cast a long shadow. Let's go with Fleeing Darkness.

**GM:** **Locked.** A great darkness arose in the Old World — something ancient and hungry that devoured kingdoms whole — and your ancestors crossed the perilous ocean to escape it; they do not speak of what they left behind, but some say the darkness is patient, and it is still out there, waiting.

> **upsert_lore** (simulated)
> ```json
> {
>   "type": "world_truth",
>   "name": "The Old World — Fleeing Darkness",
>   "summary": "The ancestors fled the Old World when an ancient, hungry darkness arose and devoured kingdoms. They crossed the ocean to the Ironlands. The darkness was not destroyed — it was escaped. Elders do not speak of what was left behind.",
>   "tags": ["old_world", "darkness", "exodus", "founding"]
> }
> ```

---

## Truth 2: Iron

**GM:** Next, the nature of iron itself — the metal that gives the Ironlands their name.

- **Option A — Iron is Precious:** Iron is scarce. Tools and weapons are handed down through generations. A warrior who owns an iron sword is wealthy indeed, and iron-tipped arrows are counted carefully.
- **Option B — Iron Holds Memory:** Iron forged in the Ironlands remembers. Blades passed through great deeds carry something of those deeds — a warmth, a weight, a whisper. Vow-iron is real.
- **Option C — Iron Wards Evil:** The darkness that followed from the Old World cannot abide cold iron. Iron charms hang above every doorway; iron is hammered into palisades; a blade of true iron is a weapon against more than flesh.

**Player:** Option C — it ties directly back to the darkness from Truth 1. Iron as a ward against the old evil creates immediate texture for daily life and for the vow system.

**GM:** **Locked.** Cold iron repels the ancient darkness and its servants — every homestead hammers iron nails above the door, travellers carry iron shards as charms, and an iron-forged weapon is as much a ward as a weapon; this is why the Ironsworn bind their vows in iron, for a vow made in iron is a vow the darkness cannot unravel.

> **upsert_lore** (simulated)
> ```json
> {
>   "type": "world_truth",
>   "name": "Iron — Wards Evil",
>   "summary": "Cold iron repels the ancient darkness and its creatures. Iron nails hang above every door, travellers carry iron charms, and iron weapons serve double duty as wards. Vows sworn on iron are considered inviolable even by the dark.",
>   "tags": ["iron", "darkness", "magic", "daily_life", "vows"]
> }
> ```

---

## Truth 3: The Legacies

**GM:** What do the people of the Ironlands remember — or believe — about their own history here?

- **Option A — Short Memory:** The Ironlands were settled only a few generations ago. Living memory still touches the crossing. History is oral and contested.
- **Option B — Ancient Settlers:** Some clans have been here for centuries. There are ruins, oral histories, competing accounts of who arrived first and what was found.
- **Option C — Something Was Here Before:** The Ironlands were not empty. There are older ruins, older stones, older bones — something was here before the settlers, and it is unclear whether they left, died, or are still here in some form.

**Player:** Option C. The idea of pre-existing ruins makes exploration richer and adds a mystery layer the party can chase. Let's say whoever was here before left structures that iron does not affect the same way.

**GM:** **Locked.** The Ironlands were not empty when your ancestors arrived — ancient ruins of an unknown people dot the highlands and deep forests, their architecture unlike anything from the Old World; iron wards do not seem to repel whatever lingered in those places, which suggests either the old inhabitants knew nothing of the darkness, or they had a different pact with it entirely.

> **upsert_lore** (simulated)
> ```json
> {
>   "type": "world_truth",
>   "name": "The Legacies — The First People",
>   "summary": "The Ironlands were inhabited before the settlers arrived. Ancient ruins of an unknown civilisation remain in highlands and deep forests. Their construction is alien to Old World craft, and iron wards do not function normally within them — suggesting a different relationship to the ancient darkness.",
>   "tags": ["history", "ruins", "first_people", "mystery", "ironlands"]
> }
> ```

---

## Truth 4: The Land

**GM:** How does the land itself shape life?

- **Option A — A Vast Wilderness:** The Ironlands are enormous and mostly wild. Settlements are small, isolated, separated by long stretches of forest, fen, and mountain. Most people live and die within a few days' travel of where they were born.
- **Option B — Harsh and Alive:** The land has moods. Winters are brutal, summers brief and burning. The land seems almost sentient in how it resists taming — animals are larger, storms are fiercer, rivers run harder here than anywhere described in Old World scrolls.
- **Option C — Sacred Ground:** Certain places in the Ironlands are nodes of power — standing stones, deep pools, ancient peaks. The people have learned to avoid or honour these places, because strange things happen to those who don't.

**Player:** Option B. The "land resists taming" theme gives good survival stakes and makes every journey feel weighty. I like the implication that the Ironlands themselves push back.

**GM:** **Locked.** The Ironlands resist settlement with a ferocity that seems almost intentional — winters are savage, predators run larger than the Old World breeds, rivers flood without warning, and more than one scholar has noted that the land became wilder after the settlers arrived, as though it recognised invaders.

> **upsert_lore** (simulated)
> ```json
> {
>   "type": "world_truth",
>   "name": "The Land — Harsh and Alive",
>   "summary": "The Ironlands are vast, wild, and resistant to settlement. Winters are brutal, predators oversized, rivers treacherous. Some scholars believe the land grew wilder after the settlers arrived, as if it recognised them as invaders.",
>   "tags": ["land", "wilderness", "survival", "nature", "ironlands"]
> }
> ```

---

## Truth 5: The Horrors

**GM:** What unnatural threats haunt the Ironlands?

- **Option A — The Remnants of the Darkness:** Creatures drawn from the Old World darkness have followed the settlers. They are rare but real — things with too many eyes, things that speak in voices of the dead, things that unmake iron.
- **Option B — The Land's Own Monsters:** The horrors here are native — great beasts, twisted spirits, things that live in deep water and deep wood. They pre-date the settlers and they pre-date the darkness.
- **Option C — Both, and They Are In Conflict:** The imported darkness and the native horrors are not allies. They compete for territory, for prey, for power. Settlements caught between them fare poorly.

**Player:** Option C — conflict between the old darkness and native monsters raises the stakes and creates interesting faction dynamics. Sometimes the enemy of your enemy is still your enemy.

**GM:** **Locked.** Two categories of horror haunt the Ironlands: the servants of the ancient darkness that crossed the ocean alongside the settlers, and the native terrors that were here before any human set foot on this shore; these two forces skirmish at the edges of settled lands, and wise folk know that a village squeezed between them is the most dangerous place to be.

> **upsert_lore** (simulated)
> ```json
> {
>   "type": "world_truth",
>   "name": "The Horrors — Two Darkness",
>   "summary": "The Ironlands face two categories of threat: servants of the ancient Old World darkness that followed the settlers across the ocean, and native terrors predating human settlement. These two forces compete with each other. Settlements caught between them are especially vulnerable.",
>   "tags": ["horrors", "darkness", "native_monsters", "conflict", "threats"]
> }
> ```

---

## Truth 6: Religion

**GM:** What do the people believe, and what powers — if any — answer those beliefs?

- **Option A — The Old Gods are Gone:** The Old World gods, if they ever existed, did not follow the settlers across the water. The Ironlands have no gods. People find meaning in their vows, their kin, and their deeds.
- **Option B — The Spirits of the Land:** There are no gods as such, but the land has spirits — in rivers, in stones, in great trees, in storms. Seers and bone-singers can speak to them, bargain with them, and occasionally anger them.
- **Option C — One Truth, Many Names:** Different clans worship different things, but certain wise folk claim all of these are the same force wearing different faces: a vast, slow, indifferent weaving that humans mistake for gods.

**Player:** Option B. Spirits of the land ties beautifully to the "harsh and alive" land truth and to the ruins of the First People — perhaps those ruins were sacred sites where the First People communed with these spirits.

**GM:** **Locked.** No gods crossed the ocean, but the Ironlands are full of spirits — in stones, rivers, old trees, and high winds; seers called the Bone-Singers speak with them, and the ancient ruins of the First People are believed to be nodes where the spirit-world and the living world overlap, which is why iron wards fail there.

> **upsert_lore** (simulated)
> ```json
> {
>   "type": "world_truth",
>   "name": "Religion — Spirits of the Land",
>   "summary": "No gods from the Old World followed the settlers. The Ironlands have spirits dwelling in rivers, stones, ancient trees, and storms. Practitioners called Bone-Singers commune with them. The ruins of the First People are believed to be spirit-nodes where the spirit world and living world overlap — which explains why iron wards fail within them.",
>   "tags": ["religion", "spirits", "bone_singers", "first_people", "ruins", "magic"]
> }
> ```

---

## Truth 7: Magic

**GM:** Does magic exist in the Ironlands, and if so, what is its nature?

- **Option A — Magic is Rare and Dangerous:** True magic exists but it is uncommon and unpredictable. Those who wield it are feared as often as they are respected.
- **Option B — Magic is a Bargain:** All magic requires something in return — a cost paid to a spirit, a debt incurred, a piece of yourself given over. There is no free working.
- **Option C — Magic is Corrupted:** Magic in the Ironlands has been tainted by the ancient darkness. What might have been clean power in the Old World is now something riskier, more volatile, prone to going wrong in dark ways.

**Player:** Option B. A bargain system for magic harmonises with the Ironsworn vow mechanics thematically, and it gives the Bone-Singers from the religion truth a compelling cost structure.

**GM:** **Locked.** All magic in the Ironlands is transactional — spirits grant power only in exchange for something real: a memory, a year of life, a secret never to be spoken, a vow the caster may not survive; Bone-Singers spend themselves in their work, and the most powerful among them are visibly diminished — aged before their time, scarred in ways that cannot be explained.

> **upsert_lore** (simulated)
> ```json
> {
>   "type": "world_truth",
>   "name": "Magic — The Bargain",
>   "summary": "All magic requires a price paid to a spirit: memories, years of life, secrets, impossible vows. There is no free working. Bone-Singers are visibly diminished by their practice — prematurely aged, strangely scarred. The most powerful are the most spent.",
>   "tags": ["magic", "bargain", "spirits", "bone_singers", "cost", "power"]
> }
> ```

---

## Truth 8: The Firstborn

**GM:** Are there other peoples sharing the Ironlands?

- **Option A — Elves and the Like:** Beings from the old mythologies exist here — long-lived, strange, with their own agendas and territories. They predate the settlers and regard them with wariness at best, hostility at worst.
- **Option B — Giants and Varou:** Great giants inhabit the deep wilderness, and wolf-folk called the Varou control certain forests. Both have their own codes and can be negotiated with, but neither is friendly by default.
- **Option C — The Firstborn are Scarce:** Whatever Firstborn peoples existed in the Ironlands have been pushed back, diminished, or driven to the far margins. Encounters are rare and freighted with history.

**Player:** Option B. Giants and Varou give immediate, tangible encounter flavour without requiring a full fantasy-race mythology. And "can be negotiated with" implies useful plot hooks.

**GM:** **Locked.** Two non-human peoples share the Ironlands: the Giants, solitary and slow-thinking but immensely powerful, who treat the settlers as an irritating novelty; and the Varou, wolf-blooded kin who run in packs through the deep forests and hold complex territorial codes that settlers frequently violate by accident.

> **upsert_lore** (simulated)
> ```json
> {
>   "type": "world_truth",
>   "name": "The Firstborn — Giants and Varou",
>   "summary": "Two non-human peoples share the Ironlands. Giants are solitary, ancient, and immensely powerful — they regard settlers with irritated indifference. The Varou are wolf-blooded pack-runners who hold complex territorial codes in the deep forests; settlers frequently violate these codes by accident, causing conflict.",
>   "tags": ["firstborn", "giants", "varou", "peoples", "territory", "non_human"]
> }
> ```

---

## Truth 9: Settlements

**GM:** How do the people of the Ironlands organise their communities?

- **Option A — Scattered Steadings:** There are no cities. Settlements are small — a handful of families in a defensible steading, maybe a larger village at a river crossing. Nothing that could be called a town without generosity.
- **Option B — A Few Fragile Towns:** A handful of larger settlements exist, fortified against the wilds, but they are islands in a sea of wilderness. Trade between them is dangerous; politics between them is treacherous.
- **Option C — The Holds:** A network of fortified Holds — not quite castles, but substantial stone structures — serves as the anchors of what passes for civilisation, each ruled by an Overseer and bound by mutual defence pacts of varying reliability.

**Player:** Option A. I want the world to feel sparse and dangerous. Scattered steadings mean that help is never close, every NPC settlement matters, and travel is genuinely perilous.

**GM:** **Locked.** There are no cities in the Ironlands, and nothing that deserves the name town — only steadings: clusters of a few families behind timber palisades, iron-nailed gates, and whatever defences they can manage; the nearest neighbours might be a day's hard travel away, and when something goes wrong, there is no cavalry coming.

> **upsert_lore** (simulated)
> ```json
> {
>   "type": "world_truth",
>   "name": "Settlements — Scattered Steadings",
>   "summary": "No cities or true towns exist. Settlements are small steadings — a few families behind palisades and iron-nailed gates. Nearest neighbours can be a full day's travel away. Self-reliance is not a virtue but a necessity; no outside help can be counted on.",
>   "tags": ["settlements", "steadings", "isolation", "survival", "daily_life"]
> }
> ```

---

## Truth 10: Leadership

**GM:** How is power organised — who leads, and how?

- **Option A — Clan Elders:** Leadership flows through age and demonstrated wisdom. A council of elders governs each steading; regional decisions are made at moots where elders argue and reach consensus.
- **Option B — The Ironsworn:** Those who take iron vows and survive to fulfil them accumulate prestige. Leadership belongs to the proven: warriors, scouts, healers who have paid in deeds.
- **Option C — The Wardens:** A tradition of appointed protectors — Wardens — exists, each responsible for a region. Wardens are selected by the communities they serve and hold authority only so long as they serve well.

**Player:** Option B. Leadership through fulfilled vows connects leadership directly to the game's central mechanic and feels most distinctively Ironsworn.

**GM:** **Locked.** Authority in the Ironlands is earned through iron: those who take vows and live to complete them accumulate standing; a person known to have fulfilled three great vows is listened to in any steading they walk into; those who break their vows are shamed — not punished by law, but diminished in the eyes of all, which in a world this spare is punishment enough.

> **upsert_lore** (simulated)
> ```json
> {
>   "type": "world_truth",
>   "name": "Leadership — Fulfilled Vows",
>   "summary": "Authority is earned by completing iron vows. Individuals known to have fulfilled great vows command respect across the Ironlands regardless of birth or blood. Oath-breakers are not formally punished but are socially diminished — and social standing is everything when survival depends on community trust.",
>   "tags": ["leadership", "vows", "authority", "social_structure", "ironsworn"]
> }
> ```

---

## Truth 11: Defense

**GM:** Finally — how do people defend themselves against the horrors and the wilderness?

- **Option A — Every Person Fights:** There is no standing army. Every adult in a steading is expected to be capable with a weapon; the Ironsworn serve as the sharpest edge when things go truly wrong.
- **Option B — The Watch:** Each steading maintains a Watch — volunteers who patrol, train together, and serve as the first line of response; larger regions coordinate Watches into loose alliances.
- **Option C — The Warband Tradition:** Warriors form wandering warbands that travel the Ironlands for hire or for honour, serving wherever they are needed and moving on when the threat is met.

**Player:** Option A — "every person fights" matches the sparse, isolated steading world we've built. There's no room for specialisation when you might face a Varou pack or a darkness-servant on any given morning.

**GM:** **Locked.** There are no professional soldiers in the Ironlands — every adult in a steading is expected to carry iron and know how to use it; the Ironsworn are not an army but the sharpest of ordinary people, those who have sworn to go where others cannot and face what others will not.

> **upsert_lore** (simulated)
> ```json
> {
>   "type": "world_truth",
>   "name": "Defense — Every Person Fights",
>   "summary": "No standing armies or professional soldiers. Every adult is expected to be capable with weapons and ready to defend their steading. The Ironsworn are not a separate warrior class but distinguished ordinary people — those who have taken great vows and become the sharpest edge of a community's defence.",
>   "tags": ["defense", "warfare", "ironsworn", "community", "steadings", "survival"]
> }
> ```

---

## World Summary

The Ironlands were born from flight. When an ancient, nameless darkness began devouring the Old World, those who could fled across the vast ocean and found this place — already inhabited, already strange. The ruins of a First People stand in the highlands and deep forests, their architecture unlike anything from the Old World, their stone indifferent to the iron wards that protect against the darkness. The settlers learned quickly that cold iron repels the old evil and its servants, and so iron became sacred: nailed above every door, hammered into every palisade, sworn upon at every vow.

The land itself does not welcome them. Winters are brutal, predators enormous, rivers treacherous. It grows wilder the longer they stay, as though resisting. And the horrors they face are doubled: the darkness sent its servants across the ocean too, and the Ironlands had their own native terrors long before any settler arrived. These two categories of horror compete at the edges of settlement, and the steadings — small, isolated, never more than a few families behind iron-nailed timber walls — must rely entirely on themselves.

No gods accompanied the settlers, but the land has spirits: in stones, old trees, deep rivers, high winds. Practitioners called Bone-Singers bargain with these spirits for power, paying with memories, years, or impossible vows. The ruins of the First People are believed to be the places where the spirit-world and the living world press closest — which is why iron fails there, and why those ruins are both sacred and deeply dangerous.

Sharing the wilderness with the settlers are two non-human peoples: the Giants, vast and ancient and irritated, and the Varou, wolf-blooded pack-runners whose territorial codes settlers stumble into constantly. Neither is an ally by default. Power in this world belongs to those who take vows on iron and survive to complete them — an oath-keeper commands respect anywhere in the Ironlands; an oath-breaker is simply no one. And when the darkness comes, when native horrors press at the walls, every adult picks up iron and fights, because the Ironsworn are just the sharpest of all ordinary people who refused to let the darkness win.

---

## Entity Definitions (simulated upsert_lore / link_lore calls)

### Entities

```
upsert_lore("world", "The Old World", "The civilisation left behind when the settlers crossed the ocean. Destroyed by an ancient darkness. Details suppressed or forgotten — elders who remember will not speak of it.")

upsert_lore("faction", "The Ancient Darkness", "An ancient, nameless force that arose in the Old World and devoured kingdoms. It was escaped, not destroyed. Its servants crossed the ocean alongside the settlers and now haunt the Ironlands.")

upsert_lore("faction", "The First People", "An unknown civilisation that inhabited the Ironlands before the settlers. Left behind architectural ruins in highlands and forests. Their relationship with the land's spirits was different from that of the settlers — iron wards do not function within their ruins.")

upsert_lore("faction", "The Giants", "Ancient solitary beings of enormous size and power inhabiting the deep wilderness. They predate human settlement and regard the settlers as a minor irritation. Can be negotiated with but are not friendly by default.")

upsert_lore("faction", "The Varou", "Wolf-blooded pack-runners who control large tracts of deep forest under complex territorial codes. Settlers frequently violate these codes by accident. Dangerous if provoked, capable of negotiation with sufficient respect and knowledge of their customs.")

upsert_lore("concept", "Bone-Singers", "Practitioners who bargain with the land's spirits for magical power. Every working extracts a price: memories, years of life, secrets, or vows the singer may not survive. The most powerful Bone-Singers are visibly diminished — aged beyond their years, carrying inexplicable scars.")

upsert_lore("concept", "Iron Vows", "The central social contract of the Ironlands. Vows sworn on cold iron are considered inviolable — the darkness itself cannot unravel them. Fulfilling vows is the primary source of social authority; breaking them is a form of social death.")

upsert_lore("place", "The Ruins of the First People", "Scattered ruins in the highlands and deep forests of unknown pre-settler construction. Iron wards fail within them. Believed to be nodes where the spirit-world and living world overlap. Both sacred and deeply dangerous.")
```

### Links

```
link_lore("The Ancient Darkness", "The Old World", "destroyed")
link_lore("The Ancient Darkness", "Iron Vows", "cannot_unravel")
link_lore("The Ancient Darkness", "The First People", "may_have_known")
link_lore("Iron Vows", "Bone-Singers", "used_by")
link_lore("Bone-Singers", "The Ruins of the First People", "converge_at")
link_lore("The First People", "The Ruins of the First People", "built")
link_lore("The Giants", "The Ironlands", "inhabit")
link_lore("The Varou", "The Ironlands", "inhabit")
link_lore("The First People", "The Ironlands", "preceded_settlers_in")
```

---

*End of simulation transcript.*
