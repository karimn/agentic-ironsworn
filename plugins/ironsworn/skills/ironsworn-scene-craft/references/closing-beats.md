# Closing Beats — Question, Image, Decision

A scene closes well when the player feels the *exit* — the moment when the camera holds, then turns. There are exactly three closes that work in Ironsworn, and one anti-pattern.

The Ironsworn rulebook's *Begin and End with the Fiction* principle (Chapter 7, *General Principles*, p. 226) is the rule this implements: "Keep things moving forward, bookending the mechanics of your moves with the fiction." A scene's close is the back bookend.

---

## The three legitimate closes

### 1. Question

End on a question the player must answer. Two flavors:

- **Explicit question** — an NPC asks; an oracle prompt is on the table; a literal "what do you do?" is unavoidable. Use sparingly; over-explicit gets dull fast.
- **Implicit question** — the situation poses a choice without the GM stating it. Best for scenes that have already done the work of making the choice obvious.

Examples:
- "She holds out the coin. Her hand does not shake." (implicit: take it or don't)
- "Sit," he says. (implicit: sit, or don't)
- "Do you draw your sword, or speak first?" (explicit — only after a beat where speaking is genuinely an option)

### 2. Image

End on a single image that **resonates with the beat the scene was about**. The image is the last thing in the player's mind before the next move; choose it for what it carries forward.

Examples:
- "Blood on the iron. None of it your own."
- "The candle she left burning is still burning when you leave. You don't put it out."
- "Brand has fallen asleep at last. The fire is down to a single coal."

The image works because it is **specific** (not "blood everywhere" — *blood on the iron*) and **carries forward** — every image above is a thread the next scene can pull.

### 3. Decision point

End at the moment the next move is the player's. The scene closes by handing them the dice — sometimes literally.

Examples:
- "She turns, walks to the door, and pauses with her hand on the latch. — Pay the Price for the miss, or speak now."
- "The track forks: north into the bog, west toward the smoke. — Undertake a Journey?"
- "Karek waits. — what do you do?"

Decision-point closes are the cleanest hand-off when a move is about to fire. They make the seam between scene and mechanics invisible.

---

## The anti-pattern: summary close

Never close with a summary of what just happened, what was decided, or what comes next.

Anti-examples (do not write):
- "And so you rest, and the night passes uneventfully."
- "You leave the longhouse, having learned what you came for."
- "The journey ahead will be difficult."
- "You and Brand are now allies."

These close the scene with **GM voice** rather than with the world. The player has nothing to do with a summary. Summaries also tell the player what to feel ("difficult", "uneventfully") instead of leaving the feeling in the image.

If a scene seems to want a summary close, one of two things is true:
1. The scene was actually a montage — defer to `ironsworn-pacing`.
2. The scene has no beat — you don't have a scene yet; cut it or reframe.

---

## Pairing the close to the beat

The close should match the **kind of beat** the scene was about:

| Scene's beat | Best close type |
|---|---|
| A reveal | Image |
| A confrontation that didn't yet break | Question (often implicit) |
| A confrontation that broke into action | Decision point (a move is firing) |
| A quiet recovery / Make Camp | Image |
| A vow-swearing / ceremony | Image |
| A test of bond / Compel / Sojourn | Question |
| Arrival before something starts | Image or decision point |
| A miss that calls for Pay the Price | Decision point — hand off to ironsworn-oracle for the consequence |

---

## How long is a close?

**One sentence to three.** Anything longer is narration creeping back in. The close is the last thing the player reads; it should be the lightest, sharpest thing in the scene.

Compare:

- Three-line close (good): "The candle she left burning is still burning when you leave. You don't put it out. Outside, the wind has dropped."
- Six-line close (bad): "The candle is burning. You think about putting it out but decide not to. You walk outside and notice that the wind has dropped. You think about your vow and what you must do next. The path home is long. You begin the walk back."

The six-line version isn't worse English — it's *narrating the player's interiority*. Hand interiority back to the player.

---

## After the close — record_scene

Once the scene closes:

1. Call `record_scene` with the situated narration (one short paragraph), `complication_theme` if a complication landed, and `mood`/`tone` tags appropriate to the close type.
2. If the close revealed lore (a name, a place, a thread), `upsert_lore` and/or `open_thread` immediately — before the next scene fires.
3. If a move is about to fire from the close, the next skill loads (combat, social, suffer, progress-tracks, oracle). Scene-craft hands off cleanly.

---

## Diagnostic checklist for closes

Before you commit a close, ask:

1. Is it a **question, image, or decision** — not a summary?
2. Is it **one to three sentences**?
3. Does it **match the beat** the scene was about?
4. If it's an image, is it **specific** (a coin, a coal, an empty doorway) rather than generic?
5. Did I **hand the next move back to the player** — explicitly or implicitly?

If any answer is no, rewrite. The close is the last impression — it carries more weight than any other line in the scene.
