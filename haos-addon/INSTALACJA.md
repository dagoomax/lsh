# LSH w Home Assistant — instrukcja instalacji

LSH instaluje się w **Home Assistant OS** (także Home Assistant Green / Yellow) jako dodatek zarządzany przez Supervisora. Działa obok Home Assistant na tym samym urządzeniu, z własnym panelem na porcie **3000**. Wersja angielska (widoczna w zakładce *Dokumentacja* dodatku): [`lsh/DOCS.md`](lsh/DOCS.md).

**Wersja dodatku: 1.0.9.** Zawiera m.in.:
- **Nowy wygląd panelu.**
- **Nowe integracje:** Tuya / Smart Life i Sonoff / eWeLink.
- **Wbudowany broker MQTT.**
- **Model 3D mieszkania** z prawdziwymi urządzeniami.
- **Sceny eksportowane do Apple Home.**

## Spis treści

1. [Wymagania](#1-wymagania)
2. [Instalacja](#2-instalacja)
3. [Pierwsze uruchomienie](#3-pierwsze-uruchomienie)
4. [Połączenie LSH z Home Assistant](#4-połączenie-lsh-z-home-assistant)
5. [LSH w menu bocznym Home Assistant](#5-lsh-w-menu-bocznym-home-assistant)
6. [MQTT: broker LSH czy Mosquitto](#6-mqtt-broker-lsh-czy-mosquitto)
7. [Porty](#7-porty)
8. [Dane, kopie zapasowe, aktualizacje](#8-dane-kopie-zapasowe-aktualizacje)
9. [Rozwiązywanie problemów](#9-rozwiązywanie-problemów)

---

## 1. Wymagania

- **System:**
  - Home Assistant OS albo Home Assistant Supervised. Instalacje *Container* i *Core* nie mają dodatków; tam użyj Dockera, opisanego w [głównym README](../README.md).
  - Procesor 64-bitowy: `amd64` (PC, NUC, maszyna wirtualna) albo `aarch64` (Green, Yellow, Raspberry Pi 4/5 z 64-bitowym systemem).
- **Miejsce i pamięć:** około **1,5 GB** wolnego miejsca na obraz i **300–500 MB RAM** w działaniu.
- **Internet podczas instalacji:** obraz jest budowany na Twoim urządzeniu, więc Home Assistant musi mieć dostęp do `github.com` i `registry.npmjs.org`. Później LSH działa bez internetu, poza integracjami chmurowymi.

## 2. Instalacja

### Dodanie repozytorium

Najprościej: otwórz ten link na komputerze w tej samej sieci co Home Assistant i potwierdź:

```
https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2Fdagoomax%2Flsh
```

Ręcznie:

1. **Ustawienia → Dodatki → Sklep z dodatkami**.
2. ⋮ (prawy górny róg) → **Repozytoria**.
3. Wklej adres i kliknij **Dodaj**:
   ```
   https://github.com/dagoomax/lsh
   ```
   Wklej sam adres repozytorium, bez `/tree/...`. Supervisor sam znajdzie dodatek w folderze `haos-addon/lsh`.

### Instalacja dodatku

1. W sklepie: ⋮ → **Sprawdź aktualizacje**, potem otwórz **LSH** (sekcja *LSH* na dole listy).
2. Kliknij **Zainstaluj**. Home Assistant pobiera LSH z GitHuba i buduje obraz razem z pakietami wszystkich integracji:
   - **około 5 minut** na komputerze PC lub NUC,
   - **10–25 minut** na Green i Raspberry Pi.

   Nie zamykaj tej strony i nie restartuj urządzenia.
3. Po instalacji włącz **Uruchom przy starcie** i **Watchdog**.
4. Kliknij **Uruchom** i otwórz zakładkę **Dziennik**.
   - Pierwsza linia pokazuje, co zostało zbudowane, np. `LSH add-on 1.0.9 · main @ 66ce10a · built 2026-10-25`.
   - LSH jest gotowy, gdy pojawi się linia `[Automation] Started`.

> ⚠️ **Nigdy nie używaj „Odinstaluj”**, żeby zacząć od nowa. Odinstalowanie kasuje dane dodatku: konfigurację, konta, tokeny, flowy, sceny, model 3D i parowanie HomeKit.

## 3. Pierwsze uruchomienie

1. Otwórz `http://<adres-home-assistant>:3000`, np. `http://homeassistant.local:3000` albo `http://192.168.1.50:3000`.
2. LSH poprosi o utworzenie **konta administratora**. Login i hasło LSH są niezależne od kont Home Assistant.
3. Integracje konfigurujesz w **Ustawieniach** LSH (ikona koła zębatego w nagłówku), m.in.:
   - **Energia:** Victron (Cerbo GX / VRM), falowniki, magazyny energii, taryfy.
   - **Oświetlenie i przełączniki:** Shelly, Tuya / Smart Life, Sonoff / eWeLink, IKEA, WLED.
   - **Platformy i huby:** Loxone, KNX, Fibaro, **Home Assistant**, **HomeKit**, Matter.

   Pakiety wszystkich integracji są już w obrazie, więc każda zaczyna działać od razu po zapisaniu ustawień i restarcie dodatku.
4. Po zmianie ustawień, które wymagają restartu, kliknij na stronie dodatku **Uruchom ponownie**. Komunikat w LSH mówi, kiedy jest to potrzebne.

## 4. Połączenie LSH z Home Assistant

Są dwa niezależne kierunki. Możesz włączyć jeden albo oba, pętli nie będzie: LSH nie importuje własnych urządzeń z powrotem.

### 4a. Urządzenia Home Assistant w LSH (import)

1. W Home Assistant: kliknij swój profil (lewy dolny róg) → **Bezpieczeństwo** → **Tokeny długoterminowe** → **Utwórz token**, nazwij go np. „LSH” i skopiuj.
2. W LSH: **Ustawienia → Platformy i huby → Home Assistant**:
   - **Home Assistant URL:** `http://127.0.0.1:8123`. Dodatek działa w sieci hosta, więc to adres Home Assistanta na tym samym urządzeniu.
   - **Long-lived access token:** wklej token.
   - Zostaw włączone **Import entities**, wybierz domeny lub konkretne encje i zapisz.
3. Urządzenia z HA pojawią się w LSH z nazwami i pokojami (obszarami) z Home Assistant. Można nimi sterować, dodawać je do scen i flowów, do modelu 3D i do Apple Home.

### 4b. Urządzenia LSH w Home Assistant

Wybierz **jeden** z dwóch sposobów.

**Sposób 1 — HomeKit Device.** Najprostszy, bez dodatkowych dodatków.

LSH ogłasza się w sieci jako most HomeKit, a Home Assistant ma wbudowaną integrację, która takie mosty obsługuje.

1. W LSH: **Ustawienia → Platformy i huby → HomeKit** — sprawdź, że most jest włączony, i zapisz **kod PIN** (domyślnie `031-45-154`).
2. W Home Assistant: **Ustawienia → Urządzenia i usługi**. Powinno pojawić się wykryte urządzenie **„LSH”** (integracja *HomeKit Device*). Kliknij **Konfiguruj**, wpisz PIN.
   - Jeśli się nie pojawi: **Dodaj integrację → HomeKit Device**.
3. Urządzenia LSH (światła ze ściemnianiem i kolorem, rolety, przełączniki, czujniki, sceny) pojawią się w HA jako normalne encje.

⚠️ **Most HomeKit można sparować tylko z jednym „domem”.** Jeśli LSH jest już dodany do aplikacji **Dom** na iPhonie, Home Assistant go nie sparuje. Wtedy użyj sposobu 2, albo usuń LSH z aplikacji Dom i zrób z Home Assistanta jedyny dom dla tego mostu.

**Sposób 2 — MQTT Discovery.** Działa razem z Apple Home.

1. W Home Assistant zainstaluj dodatek **Mosquitto broker** (Sklep z dodatkami), uruchom go i dodaj integrację **MQTT**, którą HA zwykle wykrywa sam.
2. Utwórz w Home Assistant zwykłego użytkownika, np. `lsh` z hasłem: **Ustawienia → Osoby → Użytkownicy**. Mosquitto loguje użytkowników Home Assistant.
3. W LSH: **Ustawienia → Platformy i huby → Home Assistant** → włącz **Publish LSH devices to Home Assistant (MQTT Discovery)**:
   - **MQTT broker:** `mqtt://127.0.0.1:1883`
   - **Username / Password:** użytkownik z punktu 2.
   - Prefiks `homeassistant` zostaw bez zmian i zapisz.
4. Urządzenia LSH pojawią się w HA same, w integracji **MQTT**, z aktualnym stanem i sterowaniem.

Do prostych przypadków jest jeszcze REST API: przykład `sensor:` / `switch:` do `configuration.yaml` jest w głównym README, w sekcji *Home Assistant integration example*. Token tworzysz w LSH: **Ustawienia → Ogólne → Bezpieczeństwo i uwierzytelnianie → Tokeny API**.

## 5. LSH w menu bocznym Home Assistant

Dodatek nie ma trybu Ingress, ale panel LSH można dodać do menu HA jako stronę:

1. **Ustawienia → Pulpity → Dodaj pulpit → Strona internetowa**.
2. Adres: `http://<adres-home-assistant>:3000`, tytuł np. „LSH”, ikona `mdi:home-lightning-bolt`.
3. LSH pojawi się w menu bocznym. Logujesz się raz, w ramce.

Działa, gdy Home Assistant jest otwierany przez `http://` w sieci domowej. Przy dostępie przez `https://`, np. Nabu Casa, przeglądarka zablokuje stronę `http://` w ramce. Wtedy otwieraj LSH bezpośrednio albo skonfiguruj w LSH HTTPS na porcie 3443.

## 6. MQTT: broker LSH czy Mosquitto

LSH ma własny, wbudowany broker MQTT (**Ustawienia → Ogólne → MQTT Broker**). W Home Assistant zwykle działa już dodatek **Mosquitto**, który zajmuje port **1883**, a w sieci hosta dwa brokery nie mogą mieć tego samego portu.

- **Masz Mosquitto (zalecane w HA):** nie włączaj brokera LSH.
  - W integracjach LSH korzystających z MQTT (Arduino / Button+, BoneIO, SmartBob) wpisz host `127.0.0.1`, port `1883` i użytkownika Home Assistant.
  - Twoje urządzenia (Tasmota, ESP, Zigbee2MQTT) też łączą się z Mosquitto.
- **Nie masz Mosquitto:** włącz broker LSH. Integracje LSH z pustym hostem MQTT użyją go same, a urządzenia ustawiasz na `<adres-home-assistant>:1883`.
- **Chcesz obu:** włącz broker LSH na innym porcie, np. **1884**.

Jeśli port jest zajęty, LSH nie zatrzymuje się. Karta brokera pokazuje komunikat „port 1883 is already in use”.

## 7. Porty

Dodatek działa w **sieci hosta** (`host_network`). Jest to konieczne, bo HomeKit, Tuya, Sonoff i AirPlay wykrywają urządzenia przez mDNS i rozgłoszenia UDP, które docierają tylko w sieci lokalnej. Porty są więc otwierane bezpośrednio na urządzeniu z Home Assistant:

| Port | Do czego | Kiedy |
|---|---|---|
| 3000 | panel WWW i API | zawsze |
| 3443 | HTTPS | gdy skonfigurowano TLS |
| 47128 | most HomeKit | gdy HomeKit włączony |
| 1883 | broker MQTT LSH | gdy włączony (patrz punkt 6) |
| 5540 | most Matter | gdy włączony |
| 8554 | proxy RTSP kamer | gdy włączony `ffmpegRtsp` |
| 6066 | prognoza pogody dla Loxone | gdy włączona |

Inny dodatek na tym samym porcie, np. drugi panel na 3000, będzie kolidował. Wtedy zatrzymaj go albo zmień jego port.

## 8. Dane, kopie zapasowe, aktualizacje

**Gdzie są dane.** Wszystko, co zapisujesz w LSH, trafia do katalogu `/data` dodatku:
- `config.json`, czyli ustawienia,
- `automations.json`, czyli flowy, reguły i sceny,
- `persist/`: konta, tokeny API, parowanie HomeKit, model 3D z przypisaniami urządzeń, historia,
- `certs/`.

Supervisor zachowuje ten katalog przy restartach i aktualizacjach.

**Kopie zapasowe.** Dodatek wchodzi w kopie zapasowe Home Assistant. Przed aktualizacją zrób kopię częściową: **Ustawienia → System → Kopie zapasowe → Utwórz kopię → Częściowa**, zaznacz tylko **LSH**.

**Aktualizacja do nowej wersji:**

1. **Ustawienia → Dodatki → Sklep z dodatkami** → ⋮ → **Sprawdź aktualizacje**.
2. **Ustawienia → Dodatki → LSH** → **Aktualizuj**. Obraz buduje się od nowa, tyle samo czasu co przy instalacji. Stara wersja działa, dopóki nowa się nie zbuduje.
3. W **Dzienniku** pierwsza linia pokazuje nową wersję i datę budowania.
4. Test: zmień coś drobnego w Ustawieniach LSH, kliknij **Uruchom ponownie** na stronie dodatku i po minucie odśwież LSH. Zmiana musi zostać.

Przycisk **Przebuduj** buduje obraz jeszcze raz z tą samą wersją, ale Docker może użyć zapamiętanej kopii kodu. Jeśli data budowania w dzienniku się nie zmieniła, nowy kod przyjdzie dopiero z następną wersją dodatku.

## 9. Rozwiązywanie problemów

**Dodatek nie pojawia się w sklepie.** ⋮ → **Sprawdź aktualizacje**. Potem sprawdź w ⋮ → **Repozytoria**, czy jest tam `https://github.com/dagoomax/lsh`. Błędy repozytorium widać w **Ustawienia → System → Logi → Supervisor**.

**Budowanie kończy się błędem.** Najczęściej to sieć: urządzenie musi mieć dostęp do `github.com` i `registry.npmjs.org`. Szczegóły są w logach Supervisora. Spróbuj ponownie przez **Zainstaluj** / **Aktualizuj**.

**LSH nie odpowiada na porcie 3000.** Sprawdź **Dziennik** dodatku. Start trwa 10–30 sekund. Jeśli w dzienniku jest `EADDRINUSE :3000`, port zajmuje inny dodatek.

**Integracja nie startuje.** Dziennik pokazuje powód, np. `Optional module unavailable: ./src/tuya-client (Cannot find module 'tuyapi')`. Pakiety są instalowane przy budowaniu obrazu, więc najczęściej pomaga **Aktualizuj** / **Przebuduj**.

**Home Assistant nie widzi mostu HomeKit LSH.** Sprawdź, czy w LSH most jest włączony i czy dodatek działa (port 47128). Jeśli LSH jest sparowany z aplikacją Dom na iPhonie, HA go nie sparuje — patrz [4b](#4b-urządzenia-lsh-w-home-assistant).

**Urządzenia LSH nie pojawiają się w HA przez MQTT.** W LSH, w karcie Home Assistant, status eksportu powinien pokazywać „broker connected”. Jeśli nie:
- Sprawdź użytkownika i hasło. Mosquitto przyjmuje tylko użytkowników Home Assistant.
- Sprawdź, czy integracja MQTT w HA jest dodana.

**Tuya / Sonoff nie są wykrywane lokalnie.** Urządzenia muszą być w tej samej sieci (VLAN) co Home Assistant. Tryb **Auto** i tak używa chmury dla urządzeń niewidocznych w sieci.

**Ustawienia znikają po restarcie.** Dotyczyło wersji do 1.0.7 i jest naprawione od 1.0.8. Zaktualizuj dodatek i zapisz ustawienia jeszcze raz.

---

*Ograniczenia:*
- *LSH konfiguruje się wyłącznie we własnych Ustawieniach (dodatek nie ma panelu opcji Supervisora).*
- *Brak Ingress.*
- *32-bitowy `armv7` nie jest wspierany.*

*Pełna dokumentacja integracji (po angielsku): [główny README](../README.md).*
