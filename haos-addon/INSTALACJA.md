# LSH — instalacja jako dodatek Home Assistant OS

Ten dokument opisuje instalację LSH na **Home Assistant OS (HAOS)** jako dodatku (add-on) zarządzanego przez Supervisora — zamiast na osobnym urządzeniu. Wersja angielska: [`lsh/DOCS.md`](lsh/DOCS.md), ogólne informacje o tym folderze: [`README.md`](README.md).

## Dlaczego nie po prostu `npm install` na HAOS?

HAOS to zamknięty, jednozadaniowy system operacyjny — nie daje dostępu do instalowania dowolnego oprogramowania bezpośrednio na hoście. Jedynym oficjalnym sposobem rozszerzania go są **dodatki Supervisora** (kontenery Docker zarządzane przez wbudowany mechanizm HA). Ten folder (`haos-addon/`) pakuje LSH właśnie w ten sposób.

## Wymagania

- Home Assistant OS (lub Home Assistant Supervised) w wersji obsługującej dodatki niestandardowe — praktycznie każda aktualna instalacja.
- Dostęp do **Ustawienia → Dodatki → Sklep z dodatkami** w interfejsie HA.
- Połączenie sieciowe hosta HA z internetem (pierwsze uruchomienie pobiera i buduje LSH z GitHuba — patrz niżej).

## Instalacja krok po kroku

1. W Home Assistant przejdź do **Ustawienia → Dodatki → Sklep z dodatkami**.
2. Kliknij ⋮ (trzy kropki, prawy górny róg) → **Repozytoria**.
3. Wklej **czysty** adres repozytorium (nie link `/tree/...` do podfolderu — Supervisor wymaga adresu, który da się sklonować przez `git clone`):
   ```
   https://github.com/dagoomax/lsh
   ```
4. Zatwierdź. Supervisor czyta `repository.yaml` z **głównego katalogu** repozytorium, a następnie przeszukuje je **rekursywnie** w poszukiwaniu pliku `config.yaml` — znajdzie `haos-addon/lsh/config.yaml` automatycznie, nie trzeba wskazywać podfolderu ręcznie.
5. Na liście dodatków pojawi się **LSH**. Otwórz go i kliknij **Zainstaluj**.
6. Pierwsza instalacja **klonuje i buduje LSH z GitHuba** (kompilacja natywnych modułów Node.js) — to potrwa kilka minut, w zależności od wydajności hosta. Kolejne starty są już natychmiastowe.
7. Po zbudowaniu kliknij **Uruchom**.

## Pierwsze uruchomienie

1. Otwórz `http://<adres-ip-home-assistant>:3000` w przeglądarce.
2. Zostaniesz przekierowany na `/setup.html` — tam zakładasz konto administratora.
3. Całą dalszą konfigurację integracji (Victron, Loxone, KNX, Shelly, UniFi, …) robi się z poziomu zakładki **Ustawienia** w samym LSH — to normalny sposób konfiguracji LSH, ręczna edycja `config.json` rzadko jest potrzebna. Pełny opis wszystkich integracji: [główny README projektu](../README.md).

## Porty (sieć hosta)

Dodatek działa z `host_network: true` — to wymagane, żeby HomeKit mógł ogłaszać się przez mDNS (dociera tylko w sieci lokalnej przy trybie hosta), dokładnie tak samo jak w zwykłym wdrożeniu Docker Compose. Wszystkie porty są więc wystawione bezpośrednio na hoście HA:

| Port | Przeznaczenie |
|---|---|
| 3000 | Panel WWW / API (HTTP) |
| 3443 | HTTPS (jeśli skonfigurowano TLS) |
| 47128 | Most HomeKit |
| 8554 | Proxy RTSP (jeśli włączono `ffmpegRtsp`) |

## Dane trwałe i kopie zapasowe

`config.json`, folder `persist/` (parowanie HomeKit, tokeny API, użytkownicy — **nigdy nie usuwać**) oraz `certs/` znajdują się w katalogu `/data` dodatku, który Supervisor zachowuje automatycznie między restartami, aktualizacjami **i uwzględnia w kopiach zapasowych Home Assistant**.

## Podłączenie do Home Assistant

Po uruchomieniu LSH można odczytywać/sterować urządzeniami z poziomu Home Assistant przez REST API LSH. Przykład (czujnik + przełącznik) w `configuration.yaml` znajduje się w sekcji **"Home Assistant integration example"** głównego README — potrzebny będzie token API wygenerowany w LSH (**Ustawienia → Tokeny API**).

## Ograniczenia

- Brak panelu opcji Supervisora (`options`/`schema`) — LSH konfiguruje się wyłącznie przez własny interfejs Ustawień, tak samo jak w każdym innym wdrożeniu.
- Brak trybu Ingress (osadzenia panelu w bocznym menu HA) — LSH otwiera się na swoim własnym porcie, z własnym logowaniem.
- Zadeklarowane architektury to `amd64` i `aarch64` — 32-bitowy `armv7` (starsze Raspberry Pi) nie jest testowany pod kątem kompilacji natywnych modułów LSH.

## Rozwiązywanie problemów

**Instalacja/build trwa bardzo długo albo kończy się błędem sieci.** Dockerfile dodatku pobiera źródła LSH z GitHuba (`git clone`) i instaluje zależności (`npm ci`) przy każdym budowaniu obrazu — wymaga to działającego dostępu hosta HA do internetu. Sprawdź połączenie sieciowe hosta i spróbuj **Odśwież → Zbuduj ponownie**.

**Po restarcie dodatku zniknęła konfiguracja.** Nie powinno się zdarzyć — `config.json`, `persist/` i `certs/` są symlinkami do `/data`, które Supervisor zachowuje niezależnie od cyklu życia kontenera. Jeśli mimo to dane znikają, sprawdź w logach dodatku, czy `/data` faktycznie się montuje (linia `mkdir -p /data/...` w `run.sh` nie powinna zgłaszać błędu uprawnień).

**Dodatek nie pojawia się po dodaniu repozytorium.** Supervisor wyszukuje `config.yaml` rekursywnie w całym repozytorium — jeśli mimo to dodatek się nie pojawia, sprawdź w logach Supervisora (**Ustawienia → System → Logi**, wybierz *Supervisor*) komunikat o błędnym repozytorium; zwykle oznacza to chwilowy problem z pobraniem repozytorium z GitHuba, nie błąd w samym dodatku.

**HomeKit / wykrywanie mDNS nie działa.** Upewnij się, że host HA rzeczywiście korzysta z sieci hosta (nie jest to możliwe do zmiany z poziomu tego dodatku — `host_network: true` jest ustawione na stałe w `config.yaml`, ponieważ bez tego HomeKit nie działa w ogóle).

---

*Ten plik dotyczy wyłącznie instalacji na HAOS jako dodatku Supervisora. Ogólna dokumentacja LSH (konfiguracja integracji, REST API, itd.) jest w języku angielskim — patrz [główny README](../README.md).*
