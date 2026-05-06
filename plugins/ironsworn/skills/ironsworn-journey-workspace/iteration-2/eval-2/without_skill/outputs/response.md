# GM Response — Undertake a Journey (Weak Hit, no skill)

## Roll Resolution

**Move:** Undertake a Journey (Wits)

| | Value |
|---|---|
| Action die | 4 |
| Wits | 2 |
| Adds | +0 |
| **Action score** | **6** |
| Challenge die 1 | 3 |
| Challenge die 2 | 8 |

6 > 3 — beats one. 6 < 8 — misses one. **Weak Hit.**

---

## Outcome

Progress made, but at a cost. Mark progress (Dangerous = 2 ticks) and suffer **-1 supply**.

**Tool calls:**
- `resolve_move({ move: "Undertake a Journey", action_score: 6, challenge_dice: [3, 8] })` → `weak_hit`
- `mark_progress({ track: "Journey to Deepcrag", rank: "Dangerous", ticks_to_add: 2 })` — Track: 0 → 2 ticks
- `update_character({ stat: "supply", delta: -1 })`

---

## Narration

The trail to Deepcrag winds through frost-bitten forest. You press forward through the grey morning, reading the landscape with practiced eyes — a distant ridgeline, the bend of a frozen creek, the smell of pine smoke. Your wits serve you, and after several hours you reach a waypoint: a collapsed waystation at the edge of a rocky clearing, its timbers sagging under old snow.

You have made progress on the road to Deepcrag, but the journey has taken its toll. The cold was sharper than expected, and you burned through your rations faster than you planned. **-1 Supply.**

---

Journey to Deepcrag progress: **2/40 ticks (1 box filled)**
