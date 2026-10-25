#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ ! -f deploy/compose/docker-compose.yml ]]; then
  echo "ERROR: OpenEgiz team template is missing (deploy/compose/docker-compose.yml)." >&2
  echo "Copy this overlay into the root of your private OpenEgiz team repository first." >&2
  exit 1
fi
command -v docker >/dev/null || { echo "Docker is required" >&2;exit 1; }
command -v make >/dev/null || { echo "Install make first: sudo apt-get update && sudo apt-get install -y make" >&2;exit 1; }
echo '=== Starting official OpenEgiz platform ==='
make up
echo '=== Building and starting MINE//MIRAGE twins, MQTT bridge and 3D UI ==='
docker compose --env-file deploy/compose/.env -f deploy/compose/docker-compose.yml -f mine-mirage/compose.yml up -d --build --wait --wait-timeout 900
printf '\n=== Waiting for twin data read back from Eclipse Ditto ===\n'
for i in $(seq 1 120); do
  if curl --silent --fail --max-time 8 http://127.0.0.1:5233/api/twin >/dev/null; then
    echo 'OK: Ditto snapshot available in MINE//MIRAGE UI.'
    echo 'Open: http://127.0.0.1:5233/'
    exit 0
  fi
  sleep 2
done
echo 'ERROR: MINE//MIRAGE UI did not receive state back from Eclipse Ditto.' >&2
exit 1
