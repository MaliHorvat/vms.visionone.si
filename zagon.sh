#!/bin/sh
# VisionOne VMS – zagon (Linux/macOS)
cd "$(dirname "$0")"
[ -f .env ] || { cp .env.example .env; echo "Ustvarjena datoteka .env – preglejte gesla, HOST_IP in TUNNEL_TOKEN."; }
PROFILI=""
grep -Eq '^TUNNEL_TOKEN=.+' .env && PROFILI="--profile tunel"
docker compose $PROFILI up -d --build
echo
echo "VisionOne View:   http://localhost:8080/view/"
echo "VisionOne Admin:  http://localhost:8080/admin/"
[ -n "$PROFILI" ] && echo "Od zunaj:         https://vms.visionone.si/"
