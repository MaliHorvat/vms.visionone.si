"""
VisionOne AI – zaznavanje objektov, sledenje, območja, linije, zadrževanje in sabotaža kamere.

Bere tokove iz go2rtc (RTSP restream, podtok), analizira slike z modelom YOLO (Ultralytics)
in dogodke s sličico pošilja strežniku VisionOne. Nastavitve kamer (vklop AI, razredi, območja)
prebere iz VisionOne vsakih 30 sekund, zato sprememb ni treba ročno prenašati.
"""
import base64
import json
import logging
import math
import os
import threading
import time
import urllib.request

import cv2
import numpy as np

VMS_URL = os.environ.get("VMS_URL", "http://vms:8080").rstrip("/")
AI_TOKEN = os.environ.get("AI_TOKEN", "")
RTSP_BASE = os.environ.get("GO2RTC_RTSP", "rtsp://go2rtc:8554").rstrip("/")
MODEL = os.environ.get("MODEL", "yolo11n.pt")
DEVICE = os.environ.get("DEVICE", "cpu")
IMGSZ = int(os.environ.get("IMGSZ", "640"))
FAKE = os.environ.get("FAKE_DETECTOR") == "1"  # samo za preizkus brez modela

logging.basicConfig(level=logging.INFO, format="%(asctime)s [ai] %(message)s")
log = logging.getLogger("ai")

COCO = {0: "person", 1: "bicycle", 2: "car", 3: "motorcycle", 5: "bus", 7: "truck", 14: "bird", 15: "cat", 16: "dog"}
LABEL_SL = {"person": "Oseba", "bicycle": "Kolo", "car": "Avto", "motorcycle": "Motor", "bus": "Avtobus", "truck": "Tovornjak", "bird": "Ptica", "cat": "Mačka", "dog": "Pes"}


# ---------------------------------------------------------------- komunikacija z VisionOne
def api(path, body=None, timeout=10):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(VMS_URL + path, data=data, method="POST" if data else "GET",
                                 headers={"Authorization": f"Bearer {AI_TOKEN}", "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read() or b"{}")


def send_event(ev, frame=None, boxes=()):
    if frame is not None:
        img = frame.copy()
        h, w = img.shape[:2]
        for (x1, y1, x2, y2), color in boxes:
            cv2.rectangle(img, (int(x1 * w), int(y1 * h)), (int(x2 * w), int(y2 * h)), color, max(2, w // 320))
        if w > 960:
            img = cv2.resize(img, (960, int(h * 960 / w)))
        ok, jpg = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 80])
        if ok:
            ev["snapshot_b64"] = base64.b64encode(jpg.tobytes()).decode()
    try:
        api("/api/events", ev)
    except Exception as e:  # noqa: BLE001
        log.warning("dogodka ni bilo mogoče poslati: %s", e)


# ---------------------------------------------------------------- model
class Detector:
    def __init__(self):
        self.lock = threading.Lock()
        if FAKE:
            self.model = None
            log.info("preizkusni način: lažni detektor")
            return
        from ultralytics import YOLO  # pylint: disable=import-outside-toplevel
        self.model = YOLO(MODEL)
        log.info("model %s naložen (%s)", MODEL, DEVICE)

    def detect(self, frame, classes, min_score):
        if self.model is None:
            return fake_detect(frame)
        ids = [k for k, v in COCO.items() if v in classes] or list(COCO)
        with self.lock:
            res = self.model.predict(frame, imgsz=IMGSZ, conf=min_score, classes=ids, device=DEVICE, verbose=False)[0]
        h, w = frame.shape[:2]
        out = []
        for b in res.boxes:
            cls = int(b.cls[0])
            if cls not in COCO:
                continue
            x1, y1, x2, y2 = [float(v) for v in b.xyxy[0]]
            out.append({"label": COCO[cls], "score": float(b.conf[0]), "bbox": [x1 / w, y1 / h, x2 / w, y2 / h]})
        return out


_fake_t0 = time.time()


def fake_detect(frame):
    # oseba, ki se sprehodi z leve na desno vsakih 20 s
    t = (time.time() - _fake_t0) % 20
    if t > 12:
        return []
    x = 0.05 + t / 12 * 0.8
    return [{"label": "person", "score": 0.9, "bbox": [x, 0.35, x + 0.1, 0.85]}]


# ---------------------------------------------------------------- geometrija
ASPECT = 562.5 / 1000  # enako kot v urejevalniku območij


def foot(b):
    return ((b[0] + b[2]) / 2, b[3])


def in_poly(p, poly):
    x, y = p
    inside = False
    n = len(poly)
    for i in range(n):
        x1, y1 = poly[i]
        x2, y2 = poly[(i + 1) % n]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / ((y2 - y1) or 1e-9) + x1:
            inside = not inside
    return inside


def side(p, a, b):
    """>0 = stran, kamor kaže puščica "noter" v urejevalniku."""
    dx, dy = (b[0] - a[0]), (b[1] - a[1]) * ASPECT
    px, py = (p[0] - a[0]), (p[1] - a[1]) * ASPECT
    return px * dy - py * dx


def segments_cross(p1, p2, a, b):
    def orient(p, q, r):
        return (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
    o1, o2, o3, o4 = orient(a, b, p1), orient(a, b, p2), orient(p1, p2, a), orient(p1, p2, b)
    return (o1 > 0) != (o2 > 0) and (o3 > 0) != (o4 > 0)


def iou(a, b):
    ix = max(0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0, min(a[3], b[3]) - max(a[1], b[1]))
    inter = ix * iy
    u = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / u if u > 0 else 0


COLORS = [  # (ime, H od, H do) – OpenCV H je 0–180
    ("rdeča", 0, 8), ("oranžna", 8, 20), ("rumena", 20, 33), ("zelena", 33, 85), ("modra", 85, 130), ("vijolična", 130, 160), ("rdeča", 160, 181)]


def dominant_color(frame, b):
    h, w = frame.shape[:2]
    x1, y1, x2, y2 = int(b[0] * w), int(b[1] * h), int(b[2] * w), int(b[3] * h)
    # sredina zgornje polovice (trup osebe / karoserija vozila)
    cx1, cx2 = x1 + (x2 - x1) // 4, x2 - (x2 - x1) // 4
    cy1, cy2 = y1 + (y2 - y1) // 5, y1 + (y2 - y1) * 3 // 5
    crop = frame[max(cy1, 0):max(cy2, 1), max(cx1, 0):max(cx2, 1)]
    if crop.size == 0:
        return None
    hsv = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV).reshape(-1, 3).astype(np.float32)
    s, v = np.median(hsv[:, 1]), np.median(hsv[:, 2])
    if v < 50:
        return "črna"
    if s < 40:
        return "bela" if v > 170 else "siva"
    hue = np.median(hsv[hsv[:, 1] > 60][:, 0]) if np.any(hsv[:, 1] > 60) else np.median(hsv[:, 0])
    for name, a, bnd in COLORS:
        if a <= hue < bnd:
            return name
    return None


# ---------------------------------------------------------------- branje toka
class Grabber(threading.Thread):
    """Neprekinjeno bere tok in hrani zadnjo sliko (prepreči zakasnitev medpomnilnika)."""

    def __init__(self, url):
        super().__init__(daemon=True)
        self.url, self.frame, self.ts, self.stop_flag = url, None, 0, False
        self.lock = threading.Lock()

    def run(self):
        while not self.stop_flag:
            cap = cv2.VideoCapture(self.url, cv2.CAP_FFMPEG)
            if not cap.isOpened():
                time.sleep(5)
                continue
            fails = 0
            while not self.stop_flag:
                ok, frame = cap.read()
                if not ok:
                    fails += 1
                    if fails > 50:
                        break
                    time.sleep(0.05)
                    continue
                fails = 0
                with self.lock:
                    self.frame, self.ts = frame, time.time()
            cap.release()
            time.sleep(2)

    def latest(self):
        with self.lock:
            return self.frame, self.ts


# ---------------------------------------------------------------- analiza ene kamere
class Track:
    _next = 1

    def __init__(self, det, now):
        self.id = Track._next
        Track._next += 1
        self.label, self.score, self.bbox = det["label"], det["score"], det["bbox"]
        self.first, self.last, self.hits = now, now, 1
        self.prev_foot = foot(det["bbox"])
        self.reported = False
        self.zones_in = {}       # id območja -> čas vstopa
        self.loiter_done = set()
        self.zone_reported = set()


class CameraWorker(threading.Thread):
    def __init__(self, cfg, detector):
        super().__init__(daemon=True)
        self.cfg, self.det = cfg, detector
        self.stop_flag = False
        self.grabber = Grabber(f"{RTSP_BASE}/{cfg['stream']}")
        self.tracks = []
        self.tamper = {"ref": None, "edge_ref": None, "since": None, "reason": None, "last_alarm": 0, "frames": 0}
        self.stats = {"frames": 0, "detections": 0, "events": 0}

    def update(self, cfg):
        self.cfg = cfg

    def run(self):
        self.grabber.start()
        last_tamper = 0
        while not self.stop_flag:
            cfg = self.cfg
            period = 1.0 / max(0.2, float(cfg.get("fps") or 2))
            t0 = time.time()
            frame, ts = self.grabber.latest()
            if frame is None or time.time() - ts > 10:
                time.sleep(1)
                continue
            try:
                if cfg.get("ai"):
                    self.process(frame, cfg)
                if cfg.get("tamper") and time.time() - last_tamper > 2:
                    last_tamper = time.time()
                    self.check_tamper(frame)
            except Exception as e:  # noqa: BLE001
                log.exception("kamera %s: %s", cfg["id"], e)
            self.stats["frames"] += 1
            time.sleep(max(0, period - (time.time() - t0)))
        self.grabber.stop_flag = True

    # ---- objekti, območja, linije, zadrževanje
    def process(self, frame, cfg):
        now = time.time()
        classes = cfg.get("classes") or list(COCO.values())
        dets = [d for d in self.det.detect(frame, classes, float(cfg.get("min_score") or 0.5)) if d["label"] in classes]
        self.stats["detections"] += len(dets)
        # povezovanje s sledmi (IoU)
        unmatched = list(dets)
        for tr in self.tracks:
            best, best_iou = None, 0.25
            for d in unmatched:
                if d["label"] != tr.label and {d["label"], tr.label} - {"car", "truck", "bus"}:
                    continue
                v = iou(tr.bbox, d["bbox"])
                if v > best_iou:
                    best, best_iou = d, v
            if best:
                unmatched.remove(best)
                tr.prev_foot = foot(tr.bbox)
                tr.bbox, tr.score, tr.last = best["bbox"], max(tr.score, best["score"]), now
                tr.hits += 1
        for d in unmatched:
            self.tracks.append(Track(d, now))
        self.tracks = [t for t in self.tracks if now - t.last < 4]

        zones = [z for z in cfg.get("zones", []) if z.get("type") == "zone" and len(z.get("points", [])) >= 3]
        lines = [z for z in cfg.get("zones", []) if z.get("type") == "line" and len(z.get("points", [])) == 2]
        for tr in self.tracks:
            if tr.last != now or tr.hits < 2:  # potrditev v vsaj dveh zaporednih analizah
                continue
            f, pf = foot(tr.bbox), tr.prev_foot
            color = None
            # objekt (brez nastavljenih območij)
            if not zones and not tr.reported:
                tr.reported = True
                color = dominant_color(frame, tr.bbox)
                self.emit("object", tr, frame, {"color": color} if color else {})
            # območja
            for z in zones:
                if z.get("classes") and tr.label not in z["classes"]:
                    continue
                inside = in_poly(f, z["points"])
                if inside and z["id"] not in tr.zones_in:
                    tr.zones_in[z["id"]] = now
                    if z["id"] not in tr.zone_reported:
                        tr.zone_reported.add(z["id"])
                        color = color or dominant_color(frame, tr.bbox)
                        self.emit("zone", tr, frame, {"color": color} if color else {}, zone=z["name"])
                elif not inside and z["id"] in tr.zones_in:
                    del tr.zones_in[z["id"]]
                loiter = float(z.get("loiter_seconds") or 0)
                if inside and loiter > 0 and z["id"] not in tr.loiter_done and now - tr.zones_in.get(z["id"], now) >= loiter:
                    tr.loiter_done.add(z["id"])
                    self.emit("loiter", tr, frame, {"dwell": round(now - tr.zones_in[z["id"]])}, zone=z["name"], severity="warning")
            # linije
            for ln in lines:
                if ln.get("classes") and tr.label not in ln["classes"]:
                    continue
                a, b = ln["points"]
                if pf != f and segments_cross(pf, f, a, b):
                    direction = "in" if side(f, a, b) > 0 else "out"  # "noter" = na stran puščice
                    want = ln.get("direction") or "both"
                    if want == "both" or want == direction:
                        self.emit("line", tr, frame, {"direction": direction}, zone=ln["name"])

    def emit(self, typ, tr, frame, data, zone=None, severity=None):
        self.stats["events"] += 1
        ev = {"type": typ, "camera_id": self.cfg["id"], "label": tr.label, "score": round(tr.score, 3), "zone": zone,
              "data": {"bbox": [round(v, 4) for v in tr.bbox], "track": tr.id, "source": "ai", **data}}
        if severity:
            ev["severity"] = severity
        color = (0, 200, 255) if tr.label == "person" else (255, 170, 60)
        log.info("kamera %s: %s %s %s", self.cfg["id"], typ, LABEL_SL.get(tr.label, tr.label), zone or "")
        threading.Thread(target=send_event, args=(ev, frame, [(tr.bbox, color)]), daemon=True).start()

    # ---- sabotaža: prekrita, zamegljena ali premaknjena kamera
    def check_tamper(self, frame):
        st = self.tamper
        small = cv2.resize(cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY), (160, 90)).astype(np.float32)
        bright = float(small.mean())
        edges = float(cv2.Laplacian(small, cv2.CV_32F).var())
        st["frames"] += 1
        if st["ref"] is None:
            st["ref"], st["edge_ref"] = small.copy(), edges
            return
        diff = float(np.abs(small - st["ref"]).mean())
        reason = None
        if bright < 12:
            reason = "Kamera je prekrita ali brez slike (popolnoma temna slika)"
        elif st["frames"] > 30 and st["edge_ref"] > 20 and edges < st["edge_ref"] * 0.15:
            reason = "Slika je zamegljena (morda poškropljena ali razostrena leča)"
        elif st["frames"] > 30 and diff > 55:
            reason = "Kamera je bila premaknjena ali se je prizor močno spremenil"
        now = time.time()
        if reason:
            if st["reason"] != reason:
                st["reason"], st["since"] = reason, now
            elif now - st["since"] >= 10 and now - st["last_alarm"] > 300:
                st["last_alarm"] = now
                log.warning("kamera %s: sabotaža – %s", self.cfg["id"], reason)
                threading.Thread(target=send_event, args=({"type": "tamper", "camera_id": self.cfg["id"], "severity": "alarm", "data": {"detail": reason, "source": "ai"}}, frame), daemon=True).start()
        else:
            st["reason"] = None
            # počasno prilagajanje referenci (dan/noč, vreme)
            cv2.accumulateWeighted(small, st["ref"], 0.02)
            st["edge_ref"] = st["edge_ref"] * 0.98 + edges * 0.02


# ---------------------------------------------------------------- glavna zanka
def main():
    if not AI_TOKEN:
        log.error("AI_TOKEN ni nastavljen – nastavite isto vrednost za vms in ai v .env")
        return
    detector = Detector()
    workers = {}
    last_cfg = 0
    last_hb = 0
    while True:
        now = time.time()
        if now - last_cfg > 30:
            last_cfg = now
            try:
                cfg = api("/api/ai/config")
                want = {c["id"]: c for c in cfg.get("cameras", [])}
                for cid, w in list(workers.items()):
                    if cid not in want:
                        w.stop_flag = True
                        del workers[cid]
                        log.info("kamera %s: analiza ustavljena", cid)
                for cid, c in want.items():
                    if cid in workers:
                        workers[cid].update(c)
                    else:
                        workers[cid] = CameraWorker(c, detector)
                        workers[cid].start()
                        log.info("kamera %s (%s): analiza zagnana", cid, c["name"])
            except Exception as e:  # noqa: BLE001
                log.warning("povezava z VisionOne ni uspela: %s", e)
        if now - last_hb > 20:
            last_hb = now
            try:
                api("/api/ai/heartbeat", {"cameras": len(workers), "device": DEVICE.upper(), "model": "preizkus" if FAKE else MODEL,
                                          "stats": {str(k): w.stats for k, w in workers.items()}})
            except Exception:  # noqa: BLE001
                pass
        time.sleep(1)


if __name__ == "__main__":
    main()
