#!/usr/bin/env python3
"""Sync go2rtc.yaml from VisionOne VMS gateway config API."""
import json
import os
import urllib.request
from pathlib import Path

STATE_FILE = Path("/opt/visionone-vms-gateway/gateway-state.json")
CONFIG_FILE = Path("/opt/visionone-vms-gateway/go2rtc.yaml")


def env(name, default=""):
    return os.environ.get(name, default).strip()


def load_state():
    if not STATE_FILE.exists():
        return {}
    return json.loads(STATE_FILE.read_text(encoding="utf-8"))


def fetch_config(api_base, token):
    req = urllib.request.Request(
        f"{api_base.rstrip('/')}/api/gateway/config",
        headers={"Authorization": f"Bearer {token}"},
        method="GET",
    )
    with urllib.request.urlopen(req, timeout=20) as res:
        return json.loads(res.read().decode("utf-8"))


def build_yaml(config):
    lines = ["streams:"]
    for camera in config.get("cameras") or []:
        if not camera.get("enabled", True):
            continue
        rtsp = str(camera.get("rtspUrl") or "").strip()
        if not rtsp:
            continue
        name = str(camera.get("streamName") or f"ch{camera.get('channel', 1)}")
        lines.append(f"  {name}:")
        lines.append(f"    - {rtsp}")
    if len(lines) == 1:
        lines.append("  {}: []")
    return "\n".join(lines) + "\n"


def main():
    api_base = env("VMS_API_BASE", "https://vms.visionone.si")
    state = load_state()
    token = state.get("token")
    if not token:
        print("missing gateway token, skip go2rtc sync")
        return
    config = fetch_config(api_base, token)
    yaml_text = build_yaml(config)
    CONFIG_FILE.write_text(yaml_text, encoding="utf-8")
    print("go2rtc.yaml updated")


if __name__ == "__main__":
    main()
