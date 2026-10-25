#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ ! -f deploy/compose/docker-compose.yml || ! -f mine-mirage/compose.yml ]]; then
  echo 'ERROR: Run this script from a repository containing OpenEgiz and mine-mirage.' >&2
  exit 1
fi
if [[ ! -f deploy/compose/.env ]]; then
  echo 'Preparing OpenEgiz and generated credentials...'
fi
make up
# Build our app + auto-provision the Grafana panel while preserving the OpenEgiz stack.
docker compose \
  --env-file deploy/compose/.env \
  -f deploy/compose/docker-compose.yml \
  -f mine-mirage/compose.yml \
  -f mine-mirage/grafana/compose.yml \
  up -d --build --wait --wait-timeout 900
printf '\nMINE//MIRAGE: http://localhost:5233/\nLive telemetry: http://localhost:5233/telemetry.html\nGrafana: http://localhost:3000/\n'
for i in $(seq 1 60); do
  if curl -fsS --max-time 6 http://localhost:5233/api/twin >/dev/null 2>&1; then
    echo 'OK: Digit twin telemetry available from Ditto.'
    echo 'Grafana -> Dashboards -> OpenEgiz Examples -> MINE//MIRAGE | Телеметрия карьера OpenEgiz'
    exit 0
  fi
  sleep 3
done
echo 'WARNING: Ditto snapshot not available; inspect logs for mirage-app, mirage-setup, connectivity, and telegraf.' >&2
exit 1
