# VisionOne VMS — vms.visionone.si

Sistem za videonadzor (VMS), ki teče v Docker Desktop pri vas, od zunaj pa je dosegljiv na **https://vms.visionone.si** prek Cloudflare Tunnela.
Aplikacija za serviserja (VisionOne Field) je na https://portal.visionone.si.

| Aplikacija | Naslov | Za koga |
|---|---|---|
| **VisionOne Admin** | http://localhost:8080/admin/ | Skrbnik: kamere, snemalniki, diski, pravila, uporabniki |
| **VisionOne View** | http://localhost:8080/view/ | Operater: živa slika, PTZ, predvajanje, alarmi, pametno iskanje |
| **Od zunaj** | https://vms.visionone.si/ | View in Admin prek Cloudflare Tunnela |
| VisionOne AI (neobvezno) | – | Zaznavanje oseb in vozil, območja, linije, sabotaža |

Pametno hišo upravlja Home Assistant. VisionOne mu pošilja dogodke prek MQTT (senzorji se v HA dodajo samodejno).

---

## 1. Zagon

Potrebujete [Docker Desktop](https://www.docker.com/products/docker-desktop/) (Windows, macOS ali Linux).

1. Razširite mapo `visionone` na disk strežnika, npr. `C:\VisionOne`.
2. Kopirajte `.env.example` v `.env` in v njej nastavite:
   - `ADMIN_PASSWORD` – začetno geslo,
   - `AI_TOKEN` – dolg naključen niz (skupen VMS-ju in AI modulu),
   - `HOST_IP` – IP naslov računalnika v lokalnem omrežju,
   - `RECORDINGS_PATH` – mapa za posnetke, npr. `D:/VisionOne/posnetki`.
3. Zaženite:
   - Windows: dvoklik na `zagon.bat`
   - ali v terminalu: `docker compose up -d --build`
   - z AI modulom: `docker compose --profile ai up -d --build`

Prva gradnja traja nekaj minut (AI modul do 15 minut, prenese ~1,5 GB).

4. Odprite http://localhost:8080/admin/ in se prijavite (uporabnik `admin`, geslo iz `.env`). **Geslo takoj spremenite** v Sistem → Moj račun in vklopite dvofaktorsko prijavo.

Za preizkus brez kamer nastavite `DEMO_CAMERAS=2` – ob prvem zagonu se dodata dve testni kameri, ki snemata na strežnik.

### Posodobitev in zaustavitev

```
docker compose up -d --build     # po zamenjavi datotek z novo različico
docker compose down              # zaustavitev (podatki ostanejo v mapah data/ in posnetki)
docker compose logs -f vms       # dnevnik strežnika
```

---

## 2. VisionOne Admin

**Dodajanje snemalnika (NVR/DVR) z vsemi kamerami** – Snemalniki → Dodaj snemalnik. Vpišete IP, uporabnika in geslo; VisionOne samodejno prepozna proizvajalca, prebere vse kanale z imeni in stanjem, diske snemalnika ter jih uvozi kot kamere.

| Proizvajalec | Uvoz kanalov | Imena kamer | Stanje diskov | Predvajanje s snemalnika | Časovnica posnetkov | PTZ |
|---|---|---|---|---|---|---|
| Hikvision / HiLook / HiWatch (ISAPI) | da | da | da | da | da | da |
| Dahua / Imou / Lorex (CGI) | da | da | da | da | – | da |
| Uniview | da (ONVIF) | da | – | da | – | ONVIF |
| Drugi (ONVIF) | da | da | – | – | – | ONVIF |
| Ročna predloga RTSP | da | – | – | – | – | – |

**Kje se snema – za vsako kamero posebej** (Kamere → Uredi → Snemanje):
- **Na snemalnik** – NVR snema kot doslej, VisionOne posnetke predvaja z njega.
- **Na strežnik** – VisionOne snema na diske v strežniku (1-minutne MP4 datoteke).
- **Oboje** – dvojna varnost.
- **Ne snemaj** – samo živa slika.

Načini snemanja: stalno, ob dogodku (s pred- in po-snemanjem) ali po tedenskem urniku. Rok hrambe se nastavi po kameri; ko je disk poln, se brišejo najstarejši nezaklenjeni posnetki.

**Več diskov v strežniku**: v `docker-compose.yml` dodajte vrstico, npr. `- E:/VisionOne/disk2:/recordings/disk2`, ponovno zaženite in disk dodajte v Snemanje in diski. Za vsak disk lahko nastavite kvoto in najmanjši prosti prostor.

**Iskanje naprav** – vpišite območje lokalnega omrežja (npr. `192.168.1.0/24`). Docker Desktop na Windows/macOS ne prepušča ONVIF multicasta, zato VisionOne vsak naslov preveri posebej (ONVIF unicast + vrata 80, 554, 8000, 37777).

Ostalo: skupine kamer, tlorisi z razporeditvijo kamer, pravila in alarmi (resnost, pojavno okno, zvok, push obvestila ntfy, webhook, MQTT, zaklep posnetka, premik PTZ), uporabniki z vlogami in dostopom do posameznih kamer, revizijska sled (GDPR), API žetoni, varnostna kopija nastavitev.

## 3. VisionOne View

- mreže 1, 4, 6, 9, 12, 16, 25, 36; povleci in spusti; shranjeni in skupni pogledi; samodejno kroženje
- dvoklik poveča kamero (glavni tok), v mreži se uporablja podtok
- digitalni zoom (kolešček), posnetek zaslona, takojšnje predvajanje zadnjih 30 s
- PTZ z hitrostjo in prednastavljenimi položaji, ročni alarm, zvok, dvosmerni zvok (potrebuje HTTPS in WebRTC)
- predvajanje do 4 kamer sinhrono, časovnica s posnetki strežnika in snemalnika ter dogodki, hitrost do 16×, skok na dogodke
- izvoz MP4 z vodnim žigom in kontrolno vsoto SHA-256, zaznamki in zaklepanje posnetkov
- dogodki v živo, potrjevanje alarmov s komentarjem, pojavna okna
- **pametno iskanje** v slovenščini: »oseba včeraj med 14 in 16«, »rdeč avto ponoči«, »oseba dvorišče«
- statistika (osebe, vozila, štetje na linijah), tloris s kamerami

## 4. Pametne funkcije (AI modul)

Zaženite z `docker compose --profile ai up -d --build`, nato pri kameri vklopite **Pametne funkcije**:
- zaznava oseb, vozil, koles, živali (model YOLO, deluje na procesorju)
- vstop v območje, prečkanje linije s smerjo (štetje noter/ven), zadrževanje v območju
- prevladujoča barva (za iskanje »rdeč avto«)
- sabotaža: prekrita, zamegljena ali premaknjena kamera
- sličica z označenim objektom pri vsakem dogodku

Obremenitev: približno 1 procesorsko jedro za 4–6 kamer pri 2 analizah na sekundo. Brez AI modula VisionOne še vedno sprejema dogodke kamer prek ONVIF (gibanje, linija, vdor, sabotaža).

## 5. Home Assistant

Admin → Integracije → MQTT: vpišite IP Home Assistanta (Mosquitto dodatek), uporabnika in geslo. Za vsako kamero se v HA pojavijo senzorji *gibanje, oseba, vozilo, povezava, sabotaža* in *zadnji dogodek*. Teme: `visionone/events`, `visionone/camera/<id>/...`.

Sliko kamere v HA dobite z naslovom `http://<strežnik>:8080/api/cameras/<id>/snapshot` in API žetonom ali z RTSP restreamom (odkomentirajte vrata 8554 v `docker-compose.yml`).

## 6. Oddaljen dostop – vms.visionone.si

VMS mora teči pri vas (v istem omrežju kot kamere). Domena vms.visionone.si do njega vodi prek **Cloudflare Tunnela**: na usmerjevalniku ni treba odpirati vrat, povezava je HTTPS.

1. Cloudflare → **Zero Trust → Networks → Tunnels → Create a tunnel** (vrsta *Cloudflared*), ime npr. `visionone-vms`.
2. Kopirajte **žeton** tunela (niz za `--token`) v `.env` kot `TUNNEL_TOKEN=…`.
3. V tunelu dodajte **Public Hostname**: poddomena `vms`, domena `visionone.si`, storitev `HTTP` → `vms:8080`.
   Če za `vms.visionone.si` že obstaja DNS zapis (npr. na Vercel), ga najprej izbrišite in domeno odstranite iz projekta na Vercelu.
4. Zaženite `zagon.bat` (ali `docker compose --profile tunel up -d --build`). Odprite https://vms.visionone.si.

Priporočila: vklopite **dvofaktorsko prijavo** za vse uporabnike (Admin → Sistem → Moj račun). Za dodatno zaščito lahko v Cloudflare Zero Trust dodate še **Access** pravilo (npr. potrditev po e-pošti).

Omejitve od zunaj: živa slika gre prek MSE (WebSocket), ki skozi tunel deluje. **Dvosmerni zvok** potrebuje WebRTC (UDP) in deluje le v lokalnem omrežju.

## 7. ESP32 programator (View → ESP32)

Nalaganje firmwara na ESP32 neposredno iz brskalnika (Web Serial, knjižnica esptool-js). Plošča je priklopljena na USB **računalnika, na katerem je odprt View** – ne na strežnik.

- deluje v **Chrome ali Edge** na računalniku, prek HTTPS (vms.visionone.si) ali na localhost
- prepozna čip (ESP32, S2, S3, C3, C6 …), nalaganje ene datoteke (merged) ali več datotek na naslove (bootloader, partitions, boot_app0, aplikacija)
- brisanje flasha, ponastavitev plošče, serijski monitor
- če se povezava ne vzpostavi, med povezovanjem držite tipko BOOT; za CP210x/CH340 namestite gonilnik

---

## 8. Varnost

- VMS-a **ne odpirajte neposredno v internet** (posredovanje vrat). Za oddaljen dostop uporabite priloženi Cloudflare Tunnel (poglavje 6) ali VPN.
- HTTPS je potreben tudi za mikrofon v brskalniku (dvosmerni zvok).
- Revizijska sled beleži prijave, predvajanja, izvoze in spremembe nastavitev.

## 9. Varnostne kopije

- `data/vms` – nastavitve VMS, dogodki, sličice, izvozi (ali Admin → Sistem → Prenesi kopijo)
- mapa posnetkov – po potrebi

## 10. Omejitve in kaj preveriti

- **Kodeki v brskalniku**: H.264 deluje povsod. H.265 (HEVC) predvajajo Chrome, Edge in Safari na novejši strojni opremi; za starejše računalnike nastavite podtok kamere na H.264.
- **Predvajanje s snemalnika Hikvision** uporablja lokalni čas snemalnika; strežnik in snemalnik naj imata isti časovni pas (NTP).
- Prepoznava registrskih tablic še ni vključena.
- Maske zasebnosti delujejo v živi sliki View, ne pa v posnetkih in izvozih.

## Zgradba

```
visionone/
├── docker-compose.yml      vse storitve
├── .env.example            nastavitve
├── go2rtc/go2rtc.yaml      pretočni strežnik (živa slika, RTSP restream)
├── vms/                    VisionOne strežnik + Admin + View (Node.js, brez zunanjih knjižnic)
│   ├── src/                API, ONVIF, snemalniki, snemanje, dogodki, pravila, MQTT
│   └── web/                admin/, view/ (vključno z ESP32 programatorjem), common/
└── ai/                     VisionOne AI (Python, YOLO, OpenCV)
```

Uporabljeni odprtokodni projekti: [go2rtc](https://github.com/AlexxIT/go2rtc) (MIT), [Ultralytics YOLO](https://github.com/ultralytics/ultralytics) (AGPL-3.0 – za komercialno prodajo VisionOne preverite licenčne pogoje ali uporabite drug model), [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) (MIT), [esptool-js](https://github.com/espressif/esptool-js) (Apache-2.0, naloži se iz CDN), [cloudflared](https://github.com/cloudflare/cloudflared) (Apache-2.0), FFmpeg (LGPL/GPL).
