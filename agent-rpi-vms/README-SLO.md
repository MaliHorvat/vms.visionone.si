# VisionOne VMS Raspberry Pi Gateway

MVP gateway agent pošlje status lokalnega NVR-ja in kamer na `vms.visionone.si`. V tej fazi ne streama videa.

## Namestitev

1. Ustvari claim kodo v bazi ali seed podatkih.
2. Kopiraj `.env.example` v `.env`.
3. Nastavi `VMS_API_BASE`, `VMS_CLAIM_CODE` in po potrebi IP-je kamer/NVR-ja.
4. Zaženi:

```bash
python3 visionone_vms_gateway.py
```

Po uspešnem claimu agent ustvari `gateway-state.json`, kjer shrani gateway token.
