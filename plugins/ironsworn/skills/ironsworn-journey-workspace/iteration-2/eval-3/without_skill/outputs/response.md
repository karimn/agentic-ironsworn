# GM Response — Journey to Deepcrag (Arrival Attempt)

## Simulated Tool Calls

### 1. roll_progress

The player wants to Reach Your Destination. The journey progress track has 6 filled boxes (24 ticks on a Dangerous rank track), translating to a progress score of 6.

```
Tool: roll_progress
Arguments: {
  "move": "Reach Your Destination",
  "progress_score": 6
}

Result: {
  "progress_score": 6,
  "challenge_dice": [4, 3],
  "outcome": "Strong Hit",
  "match": false
}
```

Progress score (6) beats both challenge dice (4 and 3) — a **Strong Hit**.

---

### 2. update_progress_track (mark complete)

```
Tool: update_progress_track
Arguments: {
  "character": "Zura Rhian",
  "track_name": "Journey to Deepcrag",
  "action": "complete"
}

Result: {
  "success": true,
  "track_name": "Journey to Deepcrag",
  "status": "completed"
}
```

---

### 3. take_momentum (Strong Hit bonus)

On a Strong Hit, Reach Your Destination grants: mark experience (1 tick per rank: Dangerous = 2 ticks), and you may choose one of +1 momentum, +1 supply, +1 health, or +1 spirit.

```
Tool: take_momentum
Arguments: {
  "character": "Zura Rhian",
  "amount": 1,
  "reason": "Reach Your Destination – Strong Hit bonus"
}

Result: {
  "success": true,
  "previous_momentum": 4,
  "new_momentum": 5
}
```

---

### 4. mark_experience

```
Tool: mark_experience
Arguments: {
  "character": "Zura Rhian",
  "ticks": 2,
  "reason": "Completed Dangerous journey: Journey to Deepcrag"
}

Result: {
  "success": true,
  "experience_ticks_added": 2
}
```

---

## GM Narration

The road narrows. The air grows colder and carries the smell of deep stone and old smoke. And then, cresting a ridge of frost-bitten pine, you see it.

**Deepcrag.**

It is smaller than the stories made it sound — squat walls of mortared fieldstone, torchlight flickering behind oiled-hide windows, a watchtower leaning slightly east as if listening for something in the dark. But it is *real*, and it is *there*, and after everything the road demanded of you, that is enough.

The gate-warden looks you over from the parapet — suspicious, as all wardens in the Ironlands are — but when you state your purpose, he nods and hauls on the rope. The gate groans open.

You have arrived. **Strong Hit.**

---

## Mechanical Summary

| Field | Value |
|---|---|
| **Move** | Reach Your Destination |
| **Progress Score** | 6 |
| **Challenge Dice** | 4, 3 |
| **Outcome** | Strong Hit |
| **Journey Track** | Journey to Deepcrag — COMPLETED |
| **Experience Gained** | +2 ticks (Dangerous rank) |
| **Bonus (chosen)** | +1 momentum (momentum: 4 → 5) |

---

## Rules Applied

Per the Ironsworn rulebook, on a **Strong Hit** for Reach Your Destination:

> *The journey comes to an end. Mark experience (1 tick per rank of the journey). You and your allies may each choose one: +1 momentum, +1 supply, +1 health, or +1 spirit.*

Zura chose **+1 momentum** to arrive with resolve intact. The journey is behind you — Deepcrag awaits.

---

*What do you do first now that you are inside the walls?*
