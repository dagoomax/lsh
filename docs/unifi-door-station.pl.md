# Stacja bramowa UniFi — instrukcja konfiguracji (LSH + Loxone)

*Wersja angielska: [unifi-door-station.md](unifi-door-station.md)*

Instrukcja opisuje pełną integrację stacji bramowej UniFi (G4 Doorbell,
G4 Doorbell Pro lub UniFi Intercom) z serwerem LSH oraz Miniserverem Loxone:

- **Obraz i zdarzenia w LSH** — zrzuty z kamery, dzwonek i ruch jako
  urządzenia na dashboardzie oraz akcesoria HomeKit (czujnik kontaktu + ruchu).
- **Odbieranie dzwonka w przeglądarce** — dashboard LSH rejestruje się jako
  softfon UniFi Talk; naciśnięcie dzwonka → dashboard dzwoni → odbierasz,
  rozmawiasz i otwierasz drzwi klawiszem DTMF.
- **Integracja z Loxone** — zdarzenia dzwonka i ruchu są natychmiast
  wypychane na Wejścia Wirtualne Miniservera, dzięki czemu można wyzwalać
  gong, światła, powiadomienia lub blok sterowania drzwiami.

## 1. Architektura

```
                 ┌──────────────────────── Konsola UniFi (UDM, 192.168.1.1) ────┐
Stacja bramowa ─►│  UniFi Protect  (kamera, zrzuty, zdarzenia dzwonka/ruchu)    │
                 │  UniFi Talk     (centrala SIP, wss://192.168.1.1:5443)       │
                 └───────┬──────────────────────────────┬──────────────────────-┘
                         │ API HTTPS (odpytywanie)      │ SIP przez WebSocket
                         ▼                              ▼
                 LSH  unifi-protect-client      softfon dashboardu LSH (nr wewn. 101)
                         │                              odbiór / rozmowa / „#” otwiera
        klucze store: unifi/<camId>/doorbell (impuls), unifi/<camId>/motion
                         │
                         ▼
                 LSH  loxoneOut  ──► http://MINISERVER/dev/sps/io/<VI>/<wartość>
                                      VI_UnifiDoorbell, VI_UnifiDoorMotion
```

Dwie niezależne ścieżki:

| Ścieżka | Cel | Opóźnienie |
|---|---|---|
| Odpytywanie API Protect | dzwonek/ruch → LSH → Loxone | ~`ringPollInterval` (domyślnie 3 s) |
| UniFi Talk SIP | rozmowa na żywo + otwarcie drzwi z dashboardu | natychmiast (prawdziwe połączenie) |

## 2. Wymagania wstępne

- Stacja bramowa dodana (adopted) w UniFi Protect na konsoli (UDM,
  `192.168.1.1`).
- Aktywna aplikacja/usługa UniFi Talk na konsoli (dla ścieżki połączeń).
- Działający serwer LSH (to repozytorium) — w tej instalacji
  `192.168.1.229`, HTTP port `3001`, HTTPS `3443`.
- Miniserver Loxone osiągalny z serwera LSH po HTTP.

## 3. Konfiguracja konsoli UniFi

### 3.1 Protect — dostęp do API

Wybierz **jedną** z dwóch opcji (klucz API jest zalecany — sesja nie wygasa):

- **Klucz API:** konsola UniFi → *Settings → Control Plane → Integrations* →
  utwórz klucz API. Wklej go do `unifi.apiKey` w `config.json`.
- **Administrator lokalny:** utwórz administratora *tylko z dostępem
  lokalnym* z uprawnieniem **podglądu** Protect i wypełnij
  `unifi.username` / `unifi.password`.

### 3.2 Talk — kierowanie połączeń na dashboard

1. W UniFi Talk stacja bramowa dostaje własny numer wewnętrzny automatycznie
   po przypisaniu do Talk.
2. Utwórz (lub użyj istniejącego) numeru **101** dla dashboardu LSH — musi się
   zgadzać z `sip.username` w `config.json`. Zanotuj hasło SIP →
   `sip.password`.
3. Ustaw **cel połączenia** stacji bramowej na numer 101 (lub grupę
   dzwonienia, która go zawiera) — dzięki temu dashboard dzwoni po
   naciśnięciu przycisku.
4. Skonfiguruj w UniFi przekaźnik zamka tak, aby DTMF **`#`** podczas
   rozmowy wyzwalał otwarcie drzwi. `#` to domyślna wartość
   `sip.dtmfUnlock`; przy zmianie klawisza zmień obie strony.

### 3.3 Opcjonalnie — obraz na żywo (RTSP)

Zrzuty działają od razu przez proxy LSH. Dla **obrazu na żywo**
(strumień na dashboardzie / podgląd w HomeKit):

1. Protect → kamera stacji bramowej → *Advanced* → włącz strumień RTSPS
   (wybierz rozdzielczość). Protect pokaże adres typu
   `rtsps://192.168.1.1:7441/AbCdEfGh?enableSrtp`.
2. Dodaj go do `config.json`:

   ```json
   "cameras": [
     { "name": "Stacja bramowa", "url": "rtsps://192.168.1.1:7441/AbCdEfGh?enableSrtp" }
   ]
   ```

   Restreamer `ffmpegRtsp` (już włączony, port bazowy 8554) przejmie strumień.

## 4. Konfiguracja serwera LSH

Wszystkie ustawienia znajdują się w `config.json` (po zmianach wymagany
restart serwera).

### 4.1 `unifi` — klient Protect

```json
"unifi": {
  "host": "192.168.1.1",
  "username": "",
  "password": "",
  "apiKey": "WKLEJ_KLUCZ_API",
  "ringPollInterval": 3
}
```

| Pole | Znaczenie |
|---|---|
| `host` | IP konsoli UniFi (tu działa Protect i API) |
| `apiKey` | klucz API z §3.1 — gdy ustawiony, zostaw `username`/`password` puste |
| `username`/`password` | dane administratora lokalnego (alternatywa dla `apiKey`) |
| `ringPollInterval` | co ile sekund sprawdzany jest dzwonek (domyślnie 3). Zwykłe czujniki są odpytywane co 30 s niezależnie. |

### 4.2 `sip` — softfon dashboardu (już skonfigurowany)

```json
"sip": {
  "wsUrl": "wss://192.168.1.1:5443",
  "username": "101",
  "domain": "192.168.1.1",
  "password": "…",
  "displayName": "LSH Dashboard",
  "dtmfUnlock": "#",
  "relayIndex": null
}
```

| Pole | Znaczenie |
|---|---|
| `wsUrl` | punkt końcowy SIP-przez-WebSocket UniFi Talk na konsoli |
| `username`/`password` | numer wewnętrzny Talk dashboardu (§3.2) |
| `dtmfUnlock` | klawisz DTMF wysyłany przyciskiem „otwórz” podczas rozmowy |
| `relayIndex` | opcjonalny przekaźnik Victron impulsowany przy otwarciu; `null` = tylko DTMF |

Te ustawienia można też edytować na żywo w *Ustawienia → SIP* na dashboardzie.

### 4.3 Pierwsze uruchomienie — odczytaj ID kamery

Zrestartuj LSH (`node server.js`). Przy starcie powinno pojawić się:

```
[UniFi Protect] Authenticated
[UniFi Protect] Doorbell "Front Door" — store keys unifi/66a1b2c3d4e5f6a7b8c9d0e1/doorbell, unifi/66a1b2c3d4e5f6a7b8c9d0e1/motion
[UniFi Protect] Started — 3 camera(s), 2 sensor(s)
```

Ciąg szesnastkowy to **ID kamery** — potrzebny do mapowań `loxoneOut`
(§5.3) oraz adresu zrzutu (§5.6). Widać go też w
`GET /api/devices?token=…`.

### 4.4 Co pojawia się automatycznie

- **Dashboard:** urządzenie 🔔 z odczytami *Doorbell* i *Motion*; wszystkie
  kamery Protect (podgląd zrzutów) w panelu kamer.
- **HomeKit:** dzwonek jako *czujnik kontaktu* (dzwonienie) + *czujnik
  ruchu* — do użycia w automatyzacjach aplikacji Dom.
- **Proxy zrzutów:** `GET /api/unifi/snapshot/<cameraId>` — JPEG, dane
  logowania pozostają po stronie serwera (używane przez dashboard i Loxone,
  §5.6).

### 4.5 Semantyka dzwonka

Po naciśnięciu przycisku klucz store `unifi/<cameraId>/doorbell` przechodzi
na **`1` i wraca na `0` po 3 sekundach** — czysty impuls, więc logika
wyzwalana zboczem w Loxone i HomeKit działa niezawodnie. Ruch podąża za
`isMotionDetected` z Protect i jest wysyłany tylko przy zmianie.

## 5. Integracja z Loxone

### 5.1 Zasada działania

Moduł `loxoneOut` w LSH nasłuchuje zmian w store i wypycha zmapowane klucze
na **Wejścia Wirtualne** Miniservera przez
`http://MINISERVER/dev/sps/io/<wejścieWirtualne>/<wartość>` (HTTP GET,
Basic auth, debounce 200 ms). To model push — bez odpytywania po stronie
Loxone; dzwonek dociera w ~`ringPollInterval` + kilkaset ms.

### 5.2 Użytkownik na Miniserverze

Utwórz w Loxone Config dedykowanego użytkownika (np. `lsh`) z uprawnieniem
do korzystania z API/aplikacji. Jego dane wpisz w `loxoneOut`.

### 5.3 Konfiguracja `loxoneOut`

```json
"loxoneOut": {
  "host": "IP_MINISERVERA",
  "port": 80,
  "username": "lsh",
  "password": "…",
  "mappings": [
    { "storeKey": "unifi/66a1b2c3d4e5f6a7b8c9d0e1/doorbell", "virtualInput": "VI_UnifiDoorbell" },
    { "storeKey": "unifi/66a1b2c3d4e5f6a7b8c9d0e1/motion",   "virtualInput": "VI_UnifiDoorMotion" }
  ]
}
```

Podmień ID kamery na to z §4.3. Moduł startuje tylko, gdy `host` nie jest
pusty i istnieje co najmniej jedno mapowanie; log przy starcie:
`[LoxoneOut] Started — 2 mapping(s) → IP_MINISERVERA`.

### 5.4 Wejścia Wirtualne w Loxone Config

1. W drzewie peryferii: *Wejścia wirtualne → prawy przycisk → Nowe wejście
   wirtualne*.
2. Utwórz wejście **cyfrowe** i ustaw jego **nazwę (połączenie) dokładnie**
   na `VI_UnifiDoorbell` — LSH wywołuje adres
   `/dev/sps/io/VI_UnifiDoorbell/1`, a Miniserver rozpoznaje wejście po tej
   nazwie. Powtórz dla `VI_UnifiDoorMotion` (opcjonalnie).
3. Zapisz do Miniservera.

### 5.5 Przykładowa logika dzwonka

Przeciągnij `VI_UnifiDoorbell` na stronę i podłącz np. do:

- **wyjścia gongu** (przekaźnik/audio) bezpośrednio — 3-sekundowy impuls
  działa jak naturalny dzwonek,
- bloku **Powiadomienie / Caller** → push „Ktoś jest przy drzwiach”
  w aplikacji Loxone,
- wejścia dzwonka bloku **sterowania drzwiami (Intercom)**, jeśli drzwi są
  zamodelowane w Loxone,
- `VI_UnifiDoorMotion` → np. logika oświetlenia przed wejściem w nocy.

### 5.6 Obraz stacji bramowej w aplikacji Loxone

Ustaw adres obrazu w bloku **Intercom / Strona WWW** na proxy zrzutów LSH:

```
http://192.168.1.229:3001/api/unifi/snapshot/<cameraId>?token=TWÓJ_TOKEN_LSH
```

Token API utworzysz na dashboardzie LSH w *Ustawienia → Tokeny API* (lub
`POST /api/auth/tokens`); tokeny są zapisywane w `persist/api-tokens.json`.
Obraz odświeża się przy każdym odpytaniu bloku.

### 5.7 Alternatywa: odpytywanie zamiast push

Jeśli wolisz wzorzec używany przez pozostałe szablony LSH↔Loxone
(`docs/loxone/`), Miniserver może odpytywać `/api/devices?token=…` przez
Wirtualne Wejście HTTP i wyciągać `unifi/<cameraId>/doorbell` wzorcem
`Check`. Dla dzwonka niezalecane — przy odpytywaniu co 5 s impuls 3 s może
zostać pominięty; dla zdarzeń dzwonka używaj ścieżki push (§5.1).

## 6. Lista kontrolna testów

1. **Restart LSH** — oczekuj wpisów z §4.3 oraz
   `[LoxoneOut] Started — 2 mapping(s) → …`.
2. **Naciśnij dzwonek:**
   - log: `[UniFi Protect] 🔔 Ring: Front Door`,
   - podgląd na żywo w Loxone Config: `VI_UnifiDoorbell` przechodzi 1 → 0 po
     ~3 s,
   - softfon na dashboardzie dzwoni — odbierz, porozmawiaj, naciśnij przycisk
     otwarcia (wysyła `#`) → drzwi się otwierają,
   - aplikacja Dom: czujnik kontaktu się wyzwala.
3. **Przejdź przed kamerą:** `VI_UnifiDoorMotion` podąża za ruchem.

## 7. Rozwiązywanie problemów

| Objaw | Sprawdź |
|---|---|
| `UniFi auth failed: HTTP 4xx` | Klucz API prawidłowy? Administrator lokalny ma dostęp do Protect? Poprawny `host`? |
| Dzwonek nie został wykryty | Czy urządzenie jest dzwonkiem w Protect? Brak wpisu o odkryciu → sprawdź osiągalność `/proxy/protect/api/cameras` |
| Dzwonek dociera do Loxone późno / wcale | `loxoneOut.host` ustawiony? `storeKey` mapowania zgodny co do znaku z kluczem z logu? `[LoxoneOut] HTTP 401` → zły użytkownik Miniservera; `HTTP 404` → niezgodna nazwa VI (§5.4) |
| Dashboard nie dzwoni | `sip.password` = hasło Talk numeru 101? Cel połączenia stacji zawiera 101? Przeglądarka musi działać po HTTPS, żeby mieć dostęp do mikrofonu |
| Otwieranie nie działa | Klawisz DTMF w UniFi zgodny z `sip.dtmfUnlock`? Przekaźnik skonfigurowany na stacji? |
| Pusty zrzut / 503 | Sekcja `unifi` skonfigurowana i klient wystartował? Poprawne ID kamery? |

## 8. Ściągawka

| Element | Wartość |
|---|---|
| Klucze store | `unifi/<cameraId>/doorbell` (impuls 1→0, 3 s), `unifi/<cameraId>/motion` |
| Proxy zrzutów | `GET /api/unifi/snapshot/<cameraId>` |
| Lista urządzeń | `GET /api/devices?token=…` |
| Adres push do Loxone | `http://<miniserver>/dev/sps/io/<VI>/<wartość>` (Basic auth) |
| Kod źródłowy | `src/unifi-protect-client.js`, `src/loxone-out-client.js`, `public/sip-phone.js` |
| Powiązane dokumenty | `docs/loxone/README.md` (szablony XML Loxone dla urządzeń LSH) |
