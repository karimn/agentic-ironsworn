# Oracle Prompt Interpretation

Patterns for interpreting `roll_oracle` results. The main `ironsworn-oracle` SKILL.md links here.

---

## Decision Flow — Ask vs. Decide

Before any oracle call, run this filter:

1. **Does established lore answer it?** Call `search_lore` / `search_lore_global` (in parallel). If yes → narrate the lore. Don't roll.
2. **Does the fiction strongly imply an answer?** Set `almost_certain` or `small_chance` and roll yes/no — the dice can still surprise you with a twist.
3. **Is the question genuinely binary?** Use `roll_yes_no` with the right likelihood.
4. **Is the question open-ended?** Use `roll_oracle` on a named table — Action+Theme for abstract uncertainty, specific tables (Region, Settlement Trouble, etc.) for typed answers.
5. **Is the question vague?** Sharpen it first. "What's in the woods?" → "Is anyone watching from the treeline?" + a likelihood.

**The sharpness test:** if both yes and no would feel boring, the question is wrong. Re-frame before rolling.

---

## Setting Likelihood

Likelihood is set by the fiction, **not** by what you want. Calibrate against this anchor:

- `almost_certain` — narrating "no" would contradict established fiction or feel dishonest.
- `likely` — the established fiction tilts this way; "no" would be a real surprise.
- `50_50` — genuine uncertainty. **The most common pick.** When in doubt, this.
- `unlikely` — the fiction tilts against it; "yes" would be a real surprise.
- `small_chance` — narrating "yes" would feel like a gift to the player.

**Never** pick a likelihood to *engineer* an outcome. If you want a specific result, just narrate it — that's a GM choice, not an oracle.

---

## Twist Interpretation (matched digits on yes/no)

A roll of 11, 22, 33, 44, 55, 66, 77, 88, 99, or 00 is a twist. The yes/no answer **stands** — but introduce a wrinkle the player didn't ask about.

Interpretation moves:

- **"Yes, but..."** — the answer is yes, but with an unwelcome condition or cost.
- **"No, but..."** — the answer is no, but with an unexpected opening or partial alternative.
- **"...and there's something else."** — the answer is true, but you also discovered something tangential and important.

The twist should *complicate the situation*, not nullify the answer. If the player asked "is the bridge intact?" and the roll is twist-yes, the bridge is intact — but something else is wrong (a body on it, a watcher beneath, a missing plank that wasn't missing yesterday).

---

## Action + Theme — The Universal Prompt

Roll both `Action` and `Theme`. You get two abstract words. The interpretation isn't literal — it's evocative.

**Process:**

1. `roll_oracle` "Action" → e.g. *"Betray"*
2. `roll_oracle` "Theme" → e.g. *"Shelter"*
3. **Ground:** call `search_lore_global` with the current scene's framing question (e.g. *"what's the shape of the conflict at Holtfen?"*). Get a 2–4 sentence cluster summary.
4. **Synthesize:** read the action/theme pair through the lore lens. *"Betray + Shelter"* in a campaign about oath-debt and harbored exiles → the safehouse host is about to turn the player in for an old debt. *"Betray + Shelter"* in a campaign about waking-darkness corruption → the cellar they hid in *is* the threat; the walls move when nobody looks.
5. **Narrate** the interpretation — don't quote the words. The oracle's language is a private prompt, not the player-facing fiction.

**Worked examples in references/examples.md** (if present) — otherwise treat the above pattern as the canonical form.

---

## Specific Table Cheat Sheet

### Canonical tables (from the Ironsworn rulebook)

| Table | Use when |
|---|---|
| `Action` + `Theme` | Open-ended "what happens?", "what's their angle?", "what's the twist?" |
| `Region` | Need a coarse location framing (Hinterlands, Deep Wilds, Tempest Hills, etc.) |
| `Location` | Specific scene-level locale within a region |
| `Settlement Trouble` | What's wrong in the village before the player arrives? |
| `Settlement Name` | Need a holt/town name on the fly (cross-check `search_lore` for collisions) |
| `Character Role` | Who is this person, structurally? (Warrior, Outcast, Scholar, etc.) |
| `Character Goal` | What do they want? |
| `Character Descriptor` | Single trait — "stoic," "vengeful," "frail" |
| `Major Plot Twist` | When the campaign feels stable — invite chaos |
| `Mystic Backlash` | When a ritual or supernatural action goes sideways |
| `Pay the Price` | Last resort for miss consequences (see references/pay-the-price.md) |
| `Endure Harm` / `Endure Stress` | Mortal harm / Desolation table — handled by `ironsworn-suffer`; cross-link |

### Plugin-original tables (not in the rulebook — invented for this plugin)

| Table | Use when |
|---|---|
| `Character Disposition` | Emotional/relational stance toward the player — how they enter the scene. Roll at NPC introduction if no record exists. |
| `Character Wound` | Formative event or loss that shaped who they became — their carried weight. Roll during `ironsworn-npc-backstory` scaffolding. |

After every roll on a specific table, call `search_lore_global` so the result lands in the campaign's themes rather than generic fantasy.

---

## When the Oracle Surprises You

Sometimes the oracle says something that contradicts your plan or seems impossible. **Never re-roll.** The oracle has spoken. Your options:

1. **Re-interpret.** What you read as impossible is probably just unexpected. A "Helpful + Death" pair in a tense interrogation isn't nonsense — the prisoner offers help in exchange for an oath, knowing it will get them killed.
2. **Take the gift.** The oracle just made the world more interesting than you would have. Run with it.
3. **Narrow the question.** If the answer truly cannot be resolved, ask a follow-up yes/no to clarify shape — but don't re-roll the same table for a "better" answer.

The dice know things you don't.

---

## Fiction Grounding (mandatory)

Before any narration that uses an oracle result:

```
search_lore_global  ←  thematic frame
search_lore         ←  if a name/place/NPC is implicated
```

Run them in parallel in the same turn. The oracle gives the *raw shape*; lore gives the *campaign-specific texture*. Without lore grounding, every oracle interpretation drifts toward generic fantasy. With it, the oracle becomes the engine that keeps surfacing the campaign's central tensions in new forms — the dark-elves' oath-tracking, the holtfolk's debt-economy, the corruption that makes beasts move wrong. The oracle is *of this world*, not above it.
