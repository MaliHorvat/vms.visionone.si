# VisionOne VMS Raspberry Pi Gateway

Gateway sam preskenira lokalno omrežje in poišče NVR-je ter kamere. IP-jev ni treba ročno vnašati.

## Namestitev

1. Ustvari claim kodo v portalu ali prenesi gateway ZIP paket.
2. Kopiraj `.env.example` v `.env` in nastavi `VMS_CLAIM_CODE`.
3. Zaženi:

```bash
python3 visionone_vms_gateway.py
```

Po uspešnem claimu agent ustvari `gateway-state.json`.

## Nastavitve (.env)

- `AUTO_DISCOVER=1` — samodejno skeniranje omrežja (privzeto)
- `SCAN_INTERVAL_SECONDS=300` — polni scan vsakih 5 min
- `SCAN_SUBNET=` — opcijsko ročno (npr. `192.168.1.0/24`)
- `NVR_IP=` / `CAMERA_TARGETS=` — opcijski ročni override, običajno prazno
