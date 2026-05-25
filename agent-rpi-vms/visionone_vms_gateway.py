#!/usr/bin/env python3
import json
import os
import socket
import time
import urllib.error
import urllib.request
from pathlib import Path

STATE_FILE = Path("gateway-state.json")
VERSION = "0.1.0"


def env(name, default=""):
    return os.environ.get(name, default).strip()


def post_json(url, payload, token=None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"), headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=15) as res:
        return json.loads(res.read().decode("utf-8"))


def load_state():
    if not STATE_FILE.exists():
        return {}
    return json.loads(STATE_FILE.read_text(encoding="utf-8"))


def save_state(state):
    STATE_FILE.write_text(json.dumps(state, indent=2), encoding="utf-8")


def local_ip():
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.connect(("8.8.8.8", 80))
        value = sock.getsockname()[0]
        sock.close()
        return value
    except OSError:
        return ""


def tcp_reachable(host, port=80, timeout=2):
    if not host:
        return False
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def parse_camera_targets(raw):
    cameras = []
    for item in [part.strip() for part in raw.split(",") if part.strip()]:
        if "=" in item:
            channel, ip = item.split("=", 1)
        else:
            channel, ip = str(len(cameras) + 1), item
        cameras.append({"channel": int(channel), "ip": ip.strip()})
    return cameras


def claim_if_needed(api_base):
    state = load_state()
    if state.get("token"):
        return state

    claim_code = env("VMS_CLAIM_CODE")
    if not claim_code:
        raise RuntimeError("VMS_CLAIM_CODE is required for first claim.")

    response = post_json(
        f"{api_base}/api/gateway/claim",
        {
            "claimCode": claim_code,
            "gatewayName": env("GATEWAY_NAME", "VisionOne Pi Gateway"),
            "localIp": local_ip(),
            "version": VERSION,
        },
    )
    config = response["config"]
    state = {"token": config["token"], "gateway_id": config["gateway_id"], "site_id": config["site_id"]}
    save_state(state)
    return state


def main():
    api_base = env("VMS_API_BASE", "https://vms.visionone.si").rstrip("/")
    interval = int(env("CHECK_INTERVAL_SECONDS", "30"))
    started_at = time.time()
    state = claim_if_needed(api_base)
    token = state["token"]
    nvr_ip = env("NVR_IP")
    cameras = parse_camera_targets(env("CAMERA_TARGETS"))

    while True:
        camera_statuses = []
        for camera in cameras:
            reachable = tcp_reachable(camera["ip"], 80) or tcp_reachable(camera["ip"], 554)
            camera_statuses.append(
                {
                    "channel": camera["channel"],
                    "name": f"Kamera {camera['channel']}",
                    "reachable": reachable,
                    "status": "online" if reachable else "offline",
                }
            )

        nvr_reachable = tcp_reachable(nvr_ip, 80) or tcp_reachable(nvr_ip, 554)
        payload = {
            "status": "online" if nvr_reachable or any(item["reachable"] for item in camera_statuses) else "warn",
            "localIp": local_ip(),
            "version": VERSION,
            "uptimeSec": int(time.time() - started_at),
            "nvrReachable": nvr_reachable,
            "cameras": camera_statuses,
            "checkedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }

        try:
            post_json(f"{api_base}/api/gateway/status", payload, token=token)
            print("status sent", payload["status"])
        except urllib.error.HTTPError as exc:
            print("status failed", exc.code, exc.read().decode("utf-8"))
        except Exception as exc:
            print("status failed", exc)
        time.sleep(interval)


if __name__ == "__main__":
    main()
