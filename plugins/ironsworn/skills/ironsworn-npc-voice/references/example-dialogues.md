# Example Dialogues — Worked Beats

Three worked examples covering the cases that go wrong most often: continuity across sessions, reaction under bond strain, and refusing in-voice on a Compel miss.

Each example shows the **lore record** the GM read first, the **want / fear / will-not-budge** for the scene, and the **delivered beat**. Read these to internalize the discipline — *then* improvise.

---

## Example 1 — Returning NPC, voice continuity

**Setup.** Three sessions ago the player met **Branwen**, a smuggler-captain on the Veiled Coast. Last session she ferried them across the Sound and asked for a future favor (open thread, kind=`debt`). Tonight the player returns to her dock.

**What the GM reads first:**

```
get_npc(name: "Branwen")
  → disposition: "wary, transactional, faintly amused"
  → drives: "keep the run alive; protect her crew; never owe iron"
  → impressions: "S2 — called the Ironsworn 'friend' twice, which she
    reserves for people she may need to disappear"
  → bonds: 0
  → tags: ["smuggler", "veiled-coast", "debt-open"]

search_lore_global(query: "Branwen smuggler veiled coast")
  → top result: scene S5 — she lost a deckhand to a Frostborn patrol last
    fall; she blames the cleric who tipped them off
```

**This scene:**
- **Want**: information about the cleric — but never to ask for it
- **Fear**: looking like she needs the Ironsworn
- **Will not budge on**: never naming her dead deckhand out loud

**Delivered beat (player walks onto the dock):**

> She sees you before you see her. Doesn't wave. Coils a line, finishes the coil, *then* looks up.
>
> "Ironsworn. Friend. — You came back, and you came back walking. That's two surprises before noon." A half-smile. "I don't suppose you've been east of the Iron Bridge lately. No reason. Just — the wind has been odd this season."

Notice: archetype-5 vocabulary (*friend* as warning), the recorded phrase "friend" is used because the lore *records* she uses it that way, and the dead deckhand is in the negative space — gestured at by "the wind has been odd" but never named. The cleric question is laundered through weather-talk because she will not be seen to ask.

---

## Example 2 — Reaction under bond strain (Test Your Bond, weak hit)

**Setup.** Player has a bond with **Old Halric**, an Iron-Town magistrate (archetype 3) who once vouched for them when their vow was contested. Player rolls Test Your Bond +heart on a weak hit: Halric is fragile in this moment and asks for proof of loyalty.

**What the GM reads first:**

```
get_npc(name: "Old Halric")
  → disposition: "principled, weary, secretly afraid of being wrong"
  → drives: "uphold the law; protect the town; never see a record falsified"
  → bonds: 1 with Ironsworn
  → tags: ["magistrate", "iron-town", "bonded"]

search_lore_global(query: "Halric magistrate Iron Town record")
  → context: Halric's son was hanged on a forged record three years ago;
    the player helped uncover it but Halric still hasn't spoken of his son
```

**This scene:**
- **Want**: the player to *prove* the loyalty so he doesn't have to ask twice
- **Fear**: that the bond was always one-sided
- **Will not budge on**: he will not say his son's name out loud

**Delivered beat (Halric's chambers, fire low):**

> Halric does not stand. The third-person form returns — never a good sign.
>
> "The magistrate is asked to rule on a quiet matter. The magistrate finds — that he cannot." He sets down the tally-stone. "The Ironsworn knows what was lost in this room. The Ironsworn knows the name we do not speak. Bring me the merchant's ledger by the second bell. Not the copy. The original. — If the Ironsworn cannot, the magistrate must rule alone, and the magistrate is tired of ruling alone."

Notice: rhythm collapses to third-person under bond strain (recorded archetype trait), the dead son is in the negative space ("the name we do not speak"), and the ask back from the weak hit *echoes* his drives (a falsified record is the wound he cannot risk again) — not a generic favor.

After the scene, the GM calls `upsert_npc` to record: *"S9 — Halric named the wound for the first time, obliquely. Disposition shift: still principled, but now visibly leaning on the Ironsworn."*

---

## Example 3 — Compel miss: refusal in-voice

**Setup.** Player attempts to Compel **Sera the Frostborn diplomat** (archetype 6) into withdrawing the levy on their home village. Rolls +iron (threaten) — miss. Rulebook: refusal or costly demand. The GM voices the refusal *as Sera*, then defers the mechanical Pay the Price to `ironsworn-suffer`.

**What the GM reads first:**

```
get_npc(name: "Sera")
  → disposition: "courteous, glacial, never raises voice"
  → drives: "honor the treaty; embarrass nobody including herself; outlast"
  → impressions: "S3 — declined the player's first overture with a smile;
    has not forgotten"
  → tags: ["frostborn", "diplomat", "treaty-keeper"]
```

**This scene:**
- **Want**: the levy stands and the conversation ends without a scene
- **Fear**: any record of being threatened in her own hall
- **Will not budge on**: she will not break form, even struck

**Delivered beat (player has just made the threat; dice come up a miss):**

> Sera does not move. She is one beat slower than the room. Then she lifts the cup, drinks, sets it down.
>
> "You are tired. The road from your village is long, and I have kept you standing. Forgive me." A pause that costs you. "The levy stands. I will have the steward see you to the gate. If you raise your voice in this hall a second time, Ironsworn, the steward will see you to the *border*, and I will be very sorry to have lost you."

Notice: no contraction, no raised voice (archetype 6), implied threat ("the *border*") rather than a stated one. The refusal lands inside the things she will not budge on — form. The GM then hands off to `ironsworn-suffer` for the Pay the Price (likely Endure Stress, possibly a costly demand opened as a debt thread).

---

## What to take away

- The **lore read** is the first beat. Voice that ignores the record contradicts itself within two sessions.
- The **want / fear / will-not-budge** triple is what makes a line feel pressured rather than ornamental.
- The most memorable lines often live in the **negative space** — what the NPC *won't* say.
- After any beat that revealed something durable, **`upsert_npc`** before moving on. The next session is built on what you record, not what you remember.
