#!/usr/bin/env bash
# Prevede agenta za Windows, Linux in Raspberry Pi. Potreben je Go 1.21+.
set -e
cd "$(dirname "$0")"
mkdir -p dist
LD="-s -w"
echo "Prevajam VisionOne agent ..."
CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -ldflags="$LD" -o dist/visionone-agent.exe .
CGO_ENABLED=0 GOOS=linux   GOARCH=amd64 go build -ldflags="$LD" -o dist/visionone-agent-linux-amd64 .
CGO_ENABLED=0 GOOS=linux   GOARCH=arm64 go build -ldflags="$LD" -o dist/visionone-agent-linux-arm64 .
CGO_ENABLED=0 GOOS=linux   GOARCH=arm GOARM=7 go build -ldflags="$LD" -o dist/visionone-agent-linux-armv7 .
cp config.example.json dist/
echo "Končano. Datoteke so v dist/:"
ls -la dist/
