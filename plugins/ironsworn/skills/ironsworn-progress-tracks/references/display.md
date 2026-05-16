# Progress Track Display Reference

Glyph rendering for any progress track. The main `ironsworn-progress-tracks` SKILL.md links here.

---

## Glyphs

Use these for any progress-track display: `○ ◔ ◑ ◕ ●`.

The `ticks` field returned by tools is total ticks (0–40), not boxes.

| Ticks in box | Glyph |
|---|---|
| 0 | ○ |
| 1 | ◔ |
| 2 | ◑ |
| 3 | ◕ |
| 4 | ● |

---

## Display Formula

For a track with `total_ticks` (0–40):

1. `full_boxes = floor(total_ticks / 4)` — render that many `●`.
2. `partial_ticks = total_ticks % 4` — if > 0, render the partial-box glyph for that count.
3. `empty_boxes = 10 - full_boxes - (1 if partial_ticks > 0 else 0)` — render that many `○`.

Concatenate the three segments.

---

## Examples

| Total ticks | Notes | Display |
|---|---|---|
| 0 | empty | `○○○○○○○○○○` |
| 1 | partial first box | `◔○○○○○○○○○` |
| 8 | dangerous, 1 mark | `●●○○○○○○○○` |
| 16 | dangerous, 2 marks | `●●●●○○○○○○` |
| 30 | 7 full + 1 partial | `●●●●●●●◑○○` |
| 40 | full | `●●●●●●●●●●` |
