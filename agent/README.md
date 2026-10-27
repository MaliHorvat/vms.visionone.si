# VisionOne agent

Ena izvršljiva datoteka (Go, brez odvisnosti), ki pri stranki spremlja
infrastrukturo in se povezuje **navzven** na portal. Pri stranki ni odprtih vrat.

## Kaj spremlja

- **Ping / odprta vrata** vseh naprav (dosegljivost, odzivni čas).
- **Kamere in snemalniki** (ONVIF / Hikvision ISAPI): stanje, model, firmware.
- **Omrežna oprema (SNMP v2c):** switchi, UPS, usmerjevalniki.
- **Strežnik in Docker:** CPU, RAM, disk, padli vsebniki.
- **Odkrivanje:** poišče nove naprave v lokalnem omrežju (predlog v portalu).

Izvaja tudi **daljinske ukaze** (domofon/rele) — a samo tiste, ki so **lokalno
dovoljeni** v `config.json`. Poverilnice naprav ostanejo pri agentu.

## Nastavitev

Kopiraj `config.example.json` v `config.json`:

```json
{
  "portal_url": "https://vms.visionone.si",
  "token": "ŽETON-LOKACIJE-IZ-PORTALA",
  "interval_sec": 45,
  "discover_every": 20
}
```

Namesto datoteke lahko uporabiš spremenljivki `VO_PORTAL` in `VO_TOKEN`.
Žeton dobiš v portalu: Lokacije → (lokacija) → *Nov žeton* (prikazan enkrat).

### Lokalna dejanja (domofon / rele)

Dejanja definiraš v `config.json` → `devices[].actions`. Podprti tipi:
`hikvision`, `dahua`, `2n`, `shelly`, `ha` (Home Assistant), `http` (poljuben).
Primeri so v `config.example.json`. Poverilnice naprav ostanejo samo tu.

## Zagon

### Windows (storitev)
```
visionone-agent.exe install     # kot Administrator; teče kot storitev VisionOneAgent
visionone-agent.exe uninstall   # odstrani
visionone-agent.exe once        # enkratni preizkus (izpiše stanje naprav)
```

### Linux / NAS
```
docker compose up -d --build
# ali neposredno:
VO_PORTAL=https://vms.visionone.si VO_TOKEN=... ./visionone-agent-linux-amd64 run
```
Za systemd lahko uporabiš `visionone-agent run` kot `ExecStart`.

### Raspberry Pi
Uporabi `dist/visionone-agent-linux-arm64` (ali `armv7`).

## Gradnja

```
./build.sh      # ustvari dist/ za Windows, Linux amd64/arm64/armv7
```
Potreben je Go 1.21+. Brez zunanjih knjižnic (`go.mod` nima odvisnosti).

## Opombe

- ICMP ping deluje s pravicami (Windows SYSTEM, Docker/root). Brez pravic agent
  samodejno uporabi TCP preverjanje.
- Nadzor Docker vsebnikov: priklopi `/var/run/docker.sock` (Linux). Windows
  named pipe ni podprt — uporabi `docker_socket: "tcp://..."`, če je vklopljen.
- Odkrivanje omrežja skenira lokalne /24 podmreže; interval nastaviš z `discover_every`
  (0 = izklop).
