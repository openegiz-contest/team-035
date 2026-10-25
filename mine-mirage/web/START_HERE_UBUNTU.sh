#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if ! command -v python3 >/dev/null 2>&1; then
  echo 'Установите Python3 (sudo apt update && sudo apt install python3)'
  exit 1
fi
printf '%s\n' 'MINE MIRAGE 5234 — DRILLING / MWD / FRAGMENTATION' 'http://127.0.0.1:5233/' 'Ctrl+C для остановки'
exec python3 -m http.server 5233 --bind 127.0.0.1
