#!/usr/bin/env python3
import ipaddress
import json
import os
import socket
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

STATE_FILE = Path("gateway-state.json")
VERSION = "0.2.0"
SCAN_PORTS = (554, 80, 8000, 37777)
NVR_PORTS = {80, 8000, 37777}


def env(name, default=""):
    return os.environ.get(name, default).strip()


def env_bool(name, default=True):
    raw = env(name, "1" if default else "0").lower()
    return raw not in {"0", "false", "no", "off"}


def auth_headers(token=None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


def post_json(url, payload, token=None):
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers=auth_headers(token),
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=15) as res:
        return json.loads(res.read().decode("utf-8"))


def get_json(url, token=None):
    req = urllib.request.Request(url, headers=auth_headers(token), method="GET")
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


def tcp_reachable(host, port=80, timeout=0.35):
    if not host:
        return False
    try:
        with socket.create_connection((host, int(port)), timeout=timeout):
            return True
    except OSError:
        return False


def guess_subnet(local_address):
    override = env("SCAN_SUBNET")
    if override:
        return override
    parts = local_address.split(".")
    if len(parts) != 4:
        return ""
    return f"{parts[0]}.{parts[1]}.{parts[2]}.0/24"


def scan_host(ip, ports):
    open_ports = [port for port in ports if tcp_reachable(ip, port)]
    if not open_ports:
        return None
    return {"ip": ip, "ports": open_ports}


def classify_device(open_ports):
    port_set = set(open_ports)
    if port_set.intersection({37777, 8000}):
        return "nvr"
    if 554 in port_set and port_set.intersection(NVR_PORTS):
        return "nvr"
    if 554 in port_set:
        return "camera"
    if 80 in port_set:
        return "nvr_candidate"
    return "unknown"


def discover_network(local_address):
    subnet = guess_subnet(local_address)
    if not subnet:
        return []
    try:
        network = ipaddress.ip_network(subnet, strict=False)
    except ValueError:
        return []

    hosts = [str(host) for host in network.hosts() if str(host) != local_address]
    discovered = []
    workers = min(64, max(16, len(hosts) // 4 or 16))
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = [pool.submit(scan_host, host, SCAN_PORTS) for host in hosts]
        for future in as_completed(futures):
            result = future.result()
            if not result:
                continue
            result["role"] = classify_device(result["ports"])
            discovered.append(result)

    discovered.sort(key=lambda item: item["ip"])
    return discovered


def pick_nvr_ip(discovered, remote_config=None, env_override=""):
    if env_override:
        return env_override
    remote_ip = str(((remote_config or {}).get("nvr") or {}).get("ip") or "").strip()
    if remote_ip:
        for item in discovered:
            if item["ip"] == remote_ip:
                return remote_ip
    for role in ("nvr", "nvr_candidate"):
        for item in discovered:
            if item.get("role") == role:
                return item["ip"]
    for item in discovered:
        ports = set(item.get("ports") or [])
        if ports.intersection(NVR_PORTS) and 554 not in ports:
            return item["ip"]
    return remote_ip


def camera_devices(discovered, nvr_ip):
    cameras = []
    for item in discovered:
        if item["ip"] == nvr_ip:
            continue
        if item.get("role") == "camera" or 554 in (item.get("ports") or []):
            cameras.append(item)
    return cameras


def build_camera_statuses(discovered, remote_config, nvr_ip):
    remote_cameras = (remote_config or {}).get("cameras") or []
    discovered_cameras = camera_devices(discovered, nvr_ip)
    statuses = []

    if discovered_cameras:
        for index, device in enumerate(discovered_cameras, start=1):
            remote = next((row for row in remote_cameras if row.get("ip") == device["ip"]), None)
            if remote is None:
                remote = next((row for row in remote_cameras if int(row.get("channel") or 0) == index), None)
            statuses.append(
                {
                    "id": str((remote or {}).get("id") or ""),
                    "channel": int((remote or {}).get("channel") or index),
                    "name": str((remote or {}).get("name") or f"Kamera {index}"),
                    "ip": device["ip"],
                    "reachable": True,
                    "status": "online",
                }
            )
        return statuses

    for remote in remote_cameras:
        if not remote.get("enabled", True):
            continue
        ip = str(remote.get("ip") or "").strip()
        reachable = tcp_reachable(ip, 80) or tcp_reachable(ip, 554) if ip else False
        statuses.append(
            {
                "id": str(remote.get("id") or ""),
                "channel": int(remote.get("channel") or 0),
                "name": str(remote.get("name") or ""),
                "ip": ip,
                "reachable": reachable,
                "status": "online" if reachable else "offline",
            }
        )
    return statuses


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


def fetch_remote_config(api_base, token):
    try:
        return get_json(f"{api_base}/api/gateway/config", token=token)
    except Exception as exc:
        print("config fetch failed", exc)
        return None


def main():
    api_base = env("VMS_API_BASE", "https://vms.visionone.si").rstrip("/")
    interval = int(env("CHECK_INTERVAL_SECONDS", "30"))
    scan_interval = int(env("SCAN_INTERVAL_SECONDS", "300"))
    auto_discover = env_bool("AUTO_DISCOVER", True)
    started_at = time.time()
    state = claim_if_needed(api_base)
    token = state["token"]
    remote_config = None
    config_loaded_at = 0.0
    discovered = []
    last_scan_at = 0.0
    own_ip = local_ip()

    while True:
        now = time.time()
        if remote_config is None or now - config_loaded_at >= 300:
            remote_config = fetch_remote_config(api_base, token)
            config_loaded_at = now

        if auto_discover and (not discovered or now - last_scan_at >= scan_interval):
            print("scanning local network…")
            discovered = discover_network(own_ip)
            last_scan_at = now
            print("discovered", len(discovered), "devices")

        nvr_ip = pick_nvr_ip(discovered, remote_config, env("NVR_IP"))
        camera_statuses = build_camera_statuses(discovered, remote_config, nvr_ip)
        nvr_reachable = tcp_reachable(nvr_ip, 80) or tcp_reachable(nvr_ip, 554) or tcp_reachable(nvr_ip, 8000)
        any_camera_online = any(item.get("reachable") for item in camera_statuses)
        overall = "online" if nvr_reachable or any_camera_online else ("warn" if discovered else "warn")

        payload = {
            "status": overall,
            "localIp": own_ip,
            "version": VERSION,
            "uptimeSec": int(time.time() - started_at),
            "nvrReachable": nvr_reachable,
            "nvrIp": nvr_ip,
            "discovered": discovered,
            "cameras": camera_statuses,
            "checkedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }

        try:
            post_json(f"{api_base}/api/gateway/status", payload, token=token)
            print("status sent", overall, f"discovered={len(discovered)}", f"cameras={len(camera_statuses)}", f"nvr={nvr_ip or '-'}")
        except urllib.error.HTTPError as exc:
            print("status failed", exc.code, exc.read().decode("utf-8"))
        except Exception as exc:
            print("status failed", exc)

        own_ip = local_ip() or own_ip
        time.sleep(interval)


if __name__ == "__main__":
    main()
