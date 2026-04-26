#!/usr/bin/env python3
"""
import_datasworn.py

Converts data/ironsworn/classic.json (from rsek/datasworn) into:
  data/ironsworn/moves.yaml
  data/ironsworn/oracles.yaml

Usage:
  python3 scripts/import_datasworn.py
"""

import json
import re
import sys
from pathlib import Path

try:
    import yaml
except ImportError:
    sys.exit("Missing pyyaml: pip install pyyaml")

ROOT = Path(__file__).parent.parent
CLASSIC_JSON = ROOT / "data" / "ironsworn" / "classic.json"
MOVES_YAML   = ROOT / "data" / "ironsworn" / "moves.yaml"
ORACLES_YAML = ROOT / "data" / "ironsworn" / "oracles.yaml"


def clean(text: str) -> str:
    """Strip Datasworn markdown: __bold__, [label](id:...) links."""
    if not text:
        return ""
    text = re.sub(r"__(.+?)__", r"\1", text)
    text = re.sub(r"\[(.+?)\]\(id:[^)]+\)", r"\1", text)
    return text.strip()


def convert_moves(data: dict) -> list:
    moves = []
    for _cat_key, category in data["moves"].items():
        for _move_key, move in category.get("contents", {}).items():
            if move.get("type") != "move":
                continue

            trigger_obj = move.get("trigger", {})
            conditions  = trigger_obj.get("conditions") or []

            stat_options = []
            stat_hints   = []
            for cond in conditions:
                for opt in cond.get("roll_options", []):
                    if opt.get("using") == "stat":
                        stat = opt["stat"]
                        if stat not in stat_options:
                            stat_options.append(stat)
                if cond.get("text"):
                    stat_hints.append(cond["text"])

            roll_type_raw = move.get("roll_type", "action_roll")
            roll_type = "progress" if "progress" in roll_type_raw else "action"

            outcomes_raw = move.get("outcomes") or {}
            outcomes = {
                "strong_hit": clean((outcomes_raw.get("strong_hit") or {}).get("text", "")),
                "weak_hit":   clean((outcomes_raw.get("weak_hit")   or {}).get("text", "")),
                "miss":       clean((outcomes_raw.get("miss")       or {}).get("text", "")),
            }

            moves.append({
                "name":         move["name"],
                "trigger":      clean(trigger_obj.get("text", "")),
                "stat_options": stat_options,
                "stat_hint":    "; ".join(stat_hints),
                "roll_type":    roll_type,
                "outcomes":     outcomes,
            })
    return moves


def collect_oracles(obj: dict | list, results: list, depth: int = 0) -> None:
    if depth > 8:
        return
    if isinstance(obj, dict):
        if obj.get("type") == "oracle_rollable":
            rows = [
                {
                    "min":     r["min"],
                    "max":     r["max"],
                    "outcome": clean(r.get("text", "")),
                }
                for r in obj.get("rows", [])
            ]
            results.append({
                "name":  obj["name"],
                "dice":  obj.get("dice", "1d100"),
                "rolls": rows,
            })
            return
        for v in obj.values():
            collect_oracles(v, results, depth + 1)
    elif isinstance(obj, list):
        for item in obj:
            collect_oracles(item, results, depth + 1)


def main() -> None:
    if not CLASSIC_JSON.exists():
        sys.exit(f"Missing {CLASSIC_JSON}\nClone rsek/datasworn and copy datasworn/classic/classic.json there.")

    with open(CLASSIC_JSON) as f:
        data = json.load(f)

    moves = convert_moves(data)
    print(f"Moves: {len(moves)}")
    for m in moves:
        print(f"  - {m['name']}")

    oracles: list = []
    collect_oracles(data.get("oracles", {}), oracles)
    print(f"\nOracles: {len(oracles)}")
    for o in oracles:
        print(f"  - {o['name']} ({o['dice']}, {len(o['rolls'])} rows)")

    with open(MOVES_YAML, "w") as f:
        yaml.dump(moves, f, default_flow_style=False, allow_unicode=True, sort_keys=False)
    print(f"\nWritten: {MOVES_YAML}")

    with open(ORACLES_YAML, "w") as f:
        yaml.dump(oracles, f, default_flow_style=False, allow_unicode=True, sort_keys=False)
    print(f"Written: {ORACLES_YAML}")


if __name__ == "__main__":
    main()
