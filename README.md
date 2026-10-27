# VisionOne — nadzorni portal

Administrativna platforma za nadzor omrežne infrastrukture na več lokacijah:
seznam in nastavitve naprav, spremljanje delovanja in izpadov, Telegram
obvestila in ukazi, daljinsko sprožanje domofona/releja ter **licenciranje po
lokaciji**. Drugi del je **agent**, ki teče pri stranki in pošilja podatke na
portal.

- **Portal:** Node (Vercel Functions) + vanilla JS, domena `vms.visionone.si`.
- **Baza:** MySQL/MariaDB (Neoserv).
- **Agent:** ena izvršljiva datoteka (Go) — Windows storitev ali Docker.

```
┌────────────┐   HTTPS (agent kliče ven)   ┌───────────────────────┐
│  Agent @   │ ─────────────────────────▶  │  Portal (Vercel)      │
│  stranka   │  telemetrija / ukazi        │  vms.visionone.si     │
└────────────┘ ◀─────────────────────────  │  + MySQL (Neoserv)    │
   kamere, switchi, UPS,                    │  + Telegram bot       │
   strežnik, domofon                        └───────────────────────┘
```

Pri stranki **ni treba odpirati nobenih vrat** — agent vzpostavi povezavo navzven.

---

## 1. Namestitev portala (Vercel + Neoserv)

### a) Baza na Neoservu
V nadzorni plošči gostovanja ustvari MySQL bazo in uporabnika ter **dovoli
oddaljeni dostop** (Remote MySQL). Zabeleži: host, port (3306), ime baze,
uporabnika in geslo.

### b) Skrivnosti
Lokalno zaženi (potrebuješ Node 20+):
```
npm install
node scripts/keygen.js
```
Izpiše `SESSION_SECRET`, `SETUP_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`,
`DEVICE_SECRET_KEY` ter licenčni par `LICENSE_PRIVATE_KEY` / `LICENSE_PUBLIC_KEY`.
**Javni licenčni ključ** shrani tudi za agente (ga vgradiš ob izdaji licence).

### c) Vercel
1. Poveži GitHub repo `vms.visionone.si` z Vercel projektom.
2. V **Settings → Environment Variables** vnesi vse iz `.env.example`
   (baza, skrivnosti, `TELEGRAM_BOT_TOKEN`, `PORTAL_URL=https://vms.visionone.si`).
3. Dodaj domeno `vms.visionone.si` (Vercel → Domains) in pri Neoserv/registrarju
   nastavi DNS (CNAME na Vercel, kot ti pokaže Vercel).
4. Objavi (Deploy). Samodejne objave so izklopljene (`vercel.json`) — objaviš ročno
   ali vklopiš po želji.

### d) Prvi zagon (ustvari tabele + skrbnika)
Enkratni klic (zamenjaj vrednosti):
```
curl -X POST https://vms.visionone.si/api/setup \
  -H "Content-Type: application/json" \
  -d '{"token":"<SETUP_TOKEN>","username":"admin","password":"<mocno-geslo>"}'
```
Nato se prijavi na `https://vms.visionone.si`, **spremeni geslo** in **vklopi 2FA**
(Moj račun). Po namestitvi lahko `SETUP_TOKEN` odstraniš.

> **Zaznavanje izpadov** teče sproti ob vsakem agentovem poročilu (~45 s), zato
> deluje tudi na **brezplačnem (Hobby)** planu Vercela, ki dovoli le dnevne crone.
> Vercel crona sta zato dnevna (varovalni pregled + opomniki licenc).
>
> Če želiš minutno zaznavo tudi takrat, ko agent povsem odpove (ne pošilja nič),
> nastavi `CRON_SECRET` in naj zunanji brezplačni razporejevalnik (npr. cron-job.org,
> UptimeRobot) vsako minuto kliče:
> `GET https://vms.visionone.si/api/cron/check` z glavo `Authorization: Bearer <CRON_SECRET>`.
> Na planu **Pro** lahko namesto tega v `vercel.json` cron `check` nastaviš na `* * * * *`.

---

## 2. Telegram bot

1. Pri `@BotFather` ustvari bota → dobiš `TELEGRAM_BOT_TOKEN` (v Vercel ENV).
   Zabeleži tudi uporabniško ime bota v `TELEGRAM_BOT_USERNAME`.
2. Registriraj webhook (enkrat):
   ```
   curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://vms.visionone.si/api/telegram&secret_token=<TELEGRAM_WEBHOOK_SECRET>"
   ```
3. V portalu → **Moj račun → Telegram** dobiš kodo; v botu pošlji `/povezi KODA`.
4. Ukazi: `/status`, `/lokacije`, `/izpadi`, `/odpri` (gumbi za domofone/releje).

Osebje prejema vsa obvestila; stranka le svoja. Vsak ukaz prek Telegrama se beleži.

---

## 3. Agent pri stranki

Podroben opis: [`agent/README.md`](agent/README.md). Na kratko:

**Windows (storitev):**
1. Skopiraj `visionone-agent.exe` in `config.json` (iz `config.example.json`) v mapo, npr. `C:\VisionOne`.
2. V `config.json` vpiši `portal_url` in `token` (žeton lokacije iz portala).
3. Kot **Administrator**: `visionone-agent.exe install` → teče kot storitev `VisionOneAgent`.

**Linux / NAS (Docker):**
```
cd agent
VO_TOKEN=<žeton-lokacije> docker compose up -d --build
```

Agent spremlja ping/vrata, kamere in snemalnike (ONVIF/ISAPI), omrežno opremo
(SNMP), strežnik in Docker; zazna nove naprave v omrežju; izvaja dovoljene
daljinske ukaze.

---

## 4. Uporaba portala

- **Stranke → Lokacije → Naprave.** Vsaka lokacija dobi svoj žeton agenta (prikazan enkrat; lahko ga zavrtiš).
- **Nadzorna plošča:** stanje lokacij/naprav, odprti izpadi, licence.
- **Licence:** paketi Basic / Pro / Enterprise (letno). Ob izdaji dobiš podpisano
  datoteko (Ed25519), ki jo pošlješ stranki; agent jo preveri. Opomniki pred potekom
  gredo po Telegramu.
- **Daljinski ukazi:** gumb na napravi (domofon/rele) ali prek Telegrama. Agent
  izvede **samo lokalno dovoljena dejanja** (definirana v `config.json`).
- **Uporabniki:** vloge skrbnik / tehnik / stranka (stranka vidi le svoje).
- **Dnevnik:** vsa dejanja (prijave, ukazi, spremembe).

---

## 5. Varnost

- Agent se povezuje **navzven** (HTTPS/WSS) — pri stranki ni odprtih vrat.
- Gesla naprav lahko ostanejo **lokalno v agentu** (portal jih ne vidi) ali se
  shranijo v portal **šifrirana** (AES-256-GCM, ključ `DEVICE_SECRET_KEY` izven baze).
- Portalna gesla: scrypt. Seje v bazi (preklicljive), piškotki HttpOnly+Secure.
- 2FA (TOTP), omejevanje poskusov prijave, zaklep računa.
- Ločevanje med strankami se preverja pri **vsaki** poizvedbi.
- Žetoni agentov so v bazi shranjeni le kot sha256; licence podpisane z Ed25519
  (ponarejanje ni mogoče).
- Stroge varnostne HTTP glave in CSP (`vercel.json`).
- Daljinski ukazi: agent sme sprožiti le vnaprej določena dejanja; vse se beleži.

> Opozorilo: odpiranje vrat/relejev na daljavo je občutljivo. Dejanja omeji na
> nujna, uporabljaj močna gesla naprav in 2FA za račune.

---

## 6. Razvoj in testi

```
npm install
npm test          # testi avtentikacije, licenc, agent API
```
Struktura:
- `api/` — Vercel funkcije (REST), `api/agent/*` za agenta, `api/cron/*` za nadzor.
- `lib/` — baza, avtentikacija, kripto, TOTP, licence, Telegram.
- `public/` — spletni vmesnik (vanilla JS).
- `agent/` — Go agent (Windows storitev + Docker).
