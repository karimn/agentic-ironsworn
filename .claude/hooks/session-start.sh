#!/bin/bash
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

bun install

# Ollama backs scene/lore embeddings (nomic-embed-text); best-effort start —
# skip silently if the binary isn't provisioned in this environment.
if command -v ollama >/dev/null 2>&1 && ! curl -sS -m 2 http://localhost:11434/api/tags >/dev/null 2>&1; then
  nohup ollama serve >/tmp/ollama.log 2>&1 &
  disown
  for _ in $(seq 1 10); do
    curl -sS -m 1 http://localhost:11434/api/tags >/dev/null 2>&1 && break
    sleep 1
  done
fi
