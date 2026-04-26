# Character Creation Session Transcript
**Skill:** ironsworn-character-builder
**Eval:** eval-1-soldier-concept
**Date:** 2026-04-26

---

## Step 0: Concept Check

**GM:** Who are you coming to the table as? Even a sentence — a former soldier? A healer who's seen too much? Someone with a score to settle? Or should we discover it together as we go?

**Player:** I want to make an Ironsworn character. She's a former soldier who left her war-band after a battle went wrong. I'm thinking something with iron as her highest stat, maybe a sword, and she has a hound. For her background vow, she wants to find the commander who betrayed her unit.

**GM:** Good bones already. A warrior shaped by iron and loss — someone who survived what others didn't, and can't let go of why. Let's build her properly.

---

## Step 1: Name

**GM:** What's your character's name? Or I can roll on the Ironlander Names oracle.

**Player:** Go ahead and roll — I want something that feels authentically Ironlands.

**GM:** Let me roll twice and we'll see what comes up.

```
[TOOL: roll_oracle("Ironlander Names")]
→ Result: "Mara"

[TOOL: roll_oracle("Ironlander Names")]
→ Result: "Kaela"
```

**GM:** The oracle gives us **Mara** and **Kaela**. Mara is short, hard-edged — it sounds like someone who doesn't waste words. Kaela has a bit more presence, like a name people remember after a battle. Which one fits her?

**Player:** Kaela. That's her.

**GM:** Kaela it is.

```
[TOOL: override("name", "Kaela")]
```

---

## Step 2: Stats

**GM:** Let's talk about who Kaela is in her bones — not just what she can do, but what she *is*. Five stats, and you assign 3, 2, 2, 1, 1 among them:

- **Iron** — strength, endurance, close combat. The one who goes first through the door.
- **Heart** — courage, willpower, empathy. The one who holds the room, who doesn't break.
- **Edge** — quickness, agility, ranged combat. The hunter, the sprinter, the one who strikes first.
- **Shadow** — deception, cunning, stealth. The one who works the angles.
- **Wits** — knowledge, observation, expertise. The one who reads the room and plans three moves ahead.

You said iron is her highest — what made her that way? And where does she fall short?

**Player:** Iron 3 for sure. She was a front-line fighter, shield wall and sword work. She trained for years. Heart 2 — she's not broken, she still cares about people even if she's guarded. Wits 2 — she's a veteran, she reads terrain and tactics. Edge 1 — she was never a runner or a skirmisher, always the heavy fighter. Shadow 1 — she's not subtle, terrible at lying.

**GM:** That tracks perfectly. Iron 3 from years of hard fighting. Heart 2 — the war didn't hollow her out, just calloused her. Wits 2 — she reads a battlefield the way a carpenter reads wood grain. Edge 1 and Shadow 1 — she's the boot coming through the door, not the hand in the shadow.

So: **Iron 3, Heart 2, Wits 2, Edge 1, Shadow 1**. Writing those now.

```
[TOOL: override("stats.iron", 3)]
[TOOL: override("stats.heart", 2)]
[TOOL: override("stats.wits", 2)]
[TOOL: override("stats.edge", 1)]
[TOOL: override("stats.shadow", 1)]
```

---

## Step 3: Starting Resources

**GM:** Kaela enters the Ironlands healthy, armed, and unbroken — whatever happened at that battle, she walked away. She starts with 5 health, 5 spirit, 5 supply, and +2 momentum.

```
[TOOL: override("health", 5)]
[TOOL: override("spirit", 5)]
[TOOL: override("supply", 5)]
[TOOL: override("momentum", 2)]
[TOOL: override("momentumReset", 2)]
[TOOL: override("bonds", 0)]
```

---

## Step 4: Assets

**GM:** Three assets — they say as much about who Kaela is as her stats do. Based on what you've described, here are the ones that feel earned:

**Combat Talents:**
- **Swordmaster** — *requires a sword.* When you Strike or Clash and burn momentum to improve your result, inflict +2 harm. If the fight continues, add +1 on your next move. This is a fighter who's spent thousands of hours with a blade — someone who makes every opening count.
- **Ironclad** — *requires armor.* A veteran soldier in her kit. When you Endure Harm in a fight, add +1 and take +1 momentum. She knows how to take a hit.

**Companions:**
- **Hound** — *Sharp:* When you Gather Information using your hound's keen senses to track quarry or investigate a scene, add +1 and take +1 momentum on a hit. You said she has a hound — this makes it official.

**Paths:**
- **Veteran** — When you burn momentum to improve your result in combat, envision how your hard-won fighting experience gives you the upper hand. Pairs beautifully with Swordmaster.
- **Honorbound** — When you Turn the Tide, your vows give you +2 instead of +1. For a soldier whose betrayal is the wound she carries, this could be powerful.
- **Wildblood** — When you Face Danger, Secure an Advantage, or Gather Information using tracking or woodland knowledge, add +1. Useful for a soldier who campaigned across the Ironlands.

You said Swordmaster and Hound are definite. What's the third? I'd lean toward **Veteran** — it reinforces her combat expertise mechanically and narratively, and it pairs with Swordmaster (both trigger on burning momentum). But **Honorbound** has a thematic weight for someone sworn to track down a betrayer.

**Player:** Veteran. It makes the most sense — she's been fighting since she was young. Swordmaster, Hound, Veteran.

**GM:** Good choices. Swordmaster and Veteran together mean that when she burns momentum in a fight, she inflicts extra harm *and* gains momentum back from her experience — a dangerous combination for someone who fights like she does.

Now — what's the hound's name?

**Player:** Grim. She found him as a stray after the battle. He's the only one she trusts completely.

**GM:** Grim. A war dog who found a war-scarred soldier. Writing him in.

```
[TOOL: override("assets", [
  { "name": "Swordmaster", "abilities": [true, false, false] },
  { "name": "Hound", "abilities": [true, false, false] },
  { "name": "Veteran", "abilities": [true, false, false] }
])]

[TOOL: override("customState", { "companion_name": "Grim" })]
```

---

## Step 5: Background Vow

**GM:** The background vow is the great sworn purpose of Kaela's life — the oath that exists beneath every other oath. Something that will take many sessions, possibly the whole campaign, to fulfill. You said she wants to find the commander who betrayed her unit. Tell me more about that vow in Kaela's voice. Not what she wants — what she *swore*.

**Player:** She swore she'd find Commander Valdris — that's his name — and make him answer for what he did. He ordered the retreat and sealed the gate, left her unit to die. She doesn't know yet if she wants justice or just answers, but she swore it over the graves of her shield-mates.

**GM:** *Over the graves of her shield-mates.* That's an iron vow if anything is. This is the kind of oath the Ironlands remembers.

The vow: **"I will find Valdris and make him answer for what he did to my unit."** Epic rank — this could define her whole life. Some things can't be rushed.

```
[TOOL: create_progress_track({
  "name": "Find Valdris and make him answer for the betrayal at the gate",
  "kind": "vow",
  "rank": "epic"
})]

[TOOL: open_thread({
  "title": "Find Valdris and make him answer for the betrayal at the gate",
  "description": "Kaela swore this vow over the graves of her fallen shield-mates after Commander Valdris ordered the retreat and sealed the gate, abandoning her unit to die. She does not yet know if she seeks justice, answers, or revenge — only that the oath must be kept."
})]
```

---

## Step 6: Inciting Incident

**GM:** The background vow is the north star. But something just happened — something that forces Kaela to *move now*, not eventually. What crisis or threat or burning need has just arrived? What can't wait?

**Player:** She's been drifting since leaving the war-band, taking mercenary work. A young survivor from her old unit — barely more than a boy, named Torvin — just found her. He says Valdris has resurfaced and taken a position as a warlord's steward in the eastern settlements. He's building a new power base. If Kaela doesn't act now, he'll be untouchable within a season.

**GM:** Torvin comes limping into whatever muddy settlement Kaela's been sleeping in, and suddenly drifting isn't an option anymore. Valdris is out there, building something, and every day she waits is another wall around him.

The vow: **"I will reach Valdris before he becomes untouchable."** Formidable rank — this is the first chapter of something much larger.

```
[TOOL: create_progress_track({
  "name": "Reach Valdris before he becomes untouchable",
  "kind": "vow",
  "rank": "formidable"
})]

[TOOL: open_thread({
  "title": "Reach Valdris before he becomes untouchable",
  "description": "Torvin, a young survivor of Kaela's old unit, found her with news: Valdris has resurfaced as steward to an eastern warlord and is building a power base. If Kaela waits a full season, he will be protected by wealth and alliance. She must move before that happens."
})]
```

---

## Step 7: Background Bonds

**GM:** Before the story started, was there anyone Kaela was deeply connected to? A mentor, a family member, someone who sheltered her? These are background bonds — they give you a mechanical edge and they're the people you fight for when everything else falls apart.

**Player:** Torvin — the young survivor who just found her. He was the youngest in the unit, she protected him like a little brother. And there's an old healer in the last town she stopped in, named Sera, who patched her up and didn't ask questions. Kaela kept coming back. That's as close to a home as she has right now.

**GM:** Torvin and Sera — a ward and a quiet harbor. Those are the kinds of bonds that keep soldiers standing.

These will be formalized mechanically through Forge a Bond during play — that's the move that puts them on your sheet as counted bonds. But I'm noting them as established relationships.

```
[TOOL: upsert_npc({
  "name": "Torvin",
  "description": "Young survivor of Kaela's old war-band. Barely grown when the battle happened. Found Kaela with the news about Valdris. She treats him like a younger brother — he is one of the reasons she cannot look away.",
  "role": "ward / fellow survivor",
  "disposition": "loyal"
})]

[TOOL: upsert_npc({
  "name": "Sera",
  "description": "Healer in the last settlement Kaela passed through. She asked no questions and charged fair prices. Kaela returned more than once. The closest thing to safe ground she has in the Ironlands.",
  "role": "healer / quiet harbor",
  "disposition": "neutral-warm"
})]

[TOOL: upsert_npc({
  "name": "Valdris",
  "description": "Former commander of Kaela's war-band. Ordered the retreat and sealed the gate, abandoning Kaela's unit. Now resurfaced as steward to an eastern warlord, building influence and alliances.",
  "role": "antagonist / betrayer",
  "disposition": "hostile"
})]
```

---

## Finishing Up

**GM:** Let me pull the full sheet together.

```
[TOOL: get_character_full()]
```

---

**Name:** Kaela
**Stats:** Edge 1 | Heart 2 | Iron 3 | Shadow 1 | Wits 2
**Assets:** Swordmaster, Hound (Grim), Veteran
**Background Vow:** "Find Valdris and make him answer for the betrayal at the gate" (epic)
**Inciting Incident:** "Reach Valdris before he becomes untouchable" (formidable)

---

Kaela stands at the edge of a grey settlement, the kind of place that doesn't bother learning your name. Grim sits beside her boot, watching Torvin with the steady patience of a dog who has smelled trouble before. The boy's words are still settling in her chest like a stone dropped into still water. She has been drifting for two seasons, taking work that keeps her hands busy and her head empty. That ends now.

She wraps a hand around the hilt of her sword — the one she kept after everything else was stripped away — and breathes out slowly.

*When you're ready, swear your first vow. The Ironlands are waiting.*
