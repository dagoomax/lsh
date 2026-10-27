'use strict';

// Katowice city guide for the dashboard's onboarding card (src/routes/guide.js).
// Checked October 2026:
//   transport   metropoliaztm.pl (Transport GZM: tickets, apps, no tickets from
//               drivers since 1 Jan 2026, contactless cards on board),
//               metropoliagzm.pl (airport line AP), Metrorower
//   restaurants MICHELIN Guide Poland 2026, Katowice: all four listed places,
//               then local favourites from Katowice food guides
//   places      the city's main sights; coordinates from OpenStreetMap
//   activities  things to do nearby (theme park, zoo, cable car, mines, a match)
//   shopping    malls, independent shops, tourist information, the Sunday trading rule
//   images      Wikimedia Commons (free licences — author and licence shown
//               on each photo, linked to its file page); where Commons has no
//               photo of a restaurant itself, its street, with a caption saying so
// Fares, timetables and opening hours change — the card links to the sources
// instead of quoting prices.
//
// Each text is { pl, en }; anything else falls back to en.

module.exports = {
  id: 'katowice',
  name: { pl: 'Katowice', en: 'Katowice' },
  center: [50.2597, 19.0217], // Rynek
  title: { pl: 'Witaj w Katowicach', en: 'Welcome to Katowice' },
  skyline: 'katowice', // the hero's drawn skyline (CityGuide.jsx)
  welcome: {
    pl: 'Witaj w Katowicach — stolicy Górnośląsko-Zagłębiowskiej Metropolii. Poniżej: jak się poruszać, gdzie zjeść i co zobaczyć w pobliżu.',
    en: 'Welcome to Katowice, the heart of the Upper Silesian–Zagłębie Metropolis. Below: getting around, where to eat and what to see nearby.',
  },

  transport: [
    {
      id: 'ztm', icon: 'tram',
      name: { pl: 'Tramwaje i autobusy — Transport GZM', en: 'Trams and buses — Transport GZM' },
      text: {
        pl: 'Jedna sieć dla całej metropolii (ZTM). Bilety czasowe kupisz w aplikacji Transport GZM, w Jakdojade, SkyCash, moBILET i zBiletem albo w biletomacie. Od 2026 r. kierowcy nie sprzedają biletów — w każdym pojeździe zapłacisz kartą zbliżeniową.',
        en: 'One network for the whole metropolis (ZTM). Time tickets are in the Transport GZM app, Jakdojade, SkyCash, moBILET and zBiletem, or at ticket machines. Since 2026 drivers sell no tickets; every vehicle takes contactless cards.',
      },
      url: 'https://www.metropoliaztm.pl/en/s/bilety-2020/',
    },
    {
      id: 'planner', icon: 'route',
      name: { pl: 'Planowanie trasy', en: 'Journey planner' },
      text: {
        pl: 'Jakdojade pokazuje połączenia na żywo i sprzedaje bilety. Bilet 24-godzinny opłaca się przy kilku przejazdach dziennie.',
        en: 'Jakdojade shows live connections and sells tickets. A 24-hour ticket pays off with several rides a day.',
      },
      url: 'https://jakdojade.pl/katowice',
    },
    {
      id: 'airport', icon: 'plane', lat: 50.46999, lon: 19.0713,
      image: { src: 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/2f/Pyrzowice_Katowice_Airport_noc.JPG/960px-Pyrzowice_Katowice_Airport_noc.JPG', page: 'https://commons.wikimedia.org/wiki/File:Pyrzowice_Katowice_Airport_noc.JPG', author: 'Frees', license: 'CC BY-SA 3.0' },
      name: { pl: 'Lotnisko Katowice (Pyrzowice)', en: 'Katowice Airport (Pyrzowice)' },
      text: {
        pl: 'Linia AP jedzie z Katowic Dworca (stanowisko AP) na lotnisko w ok. 45–60 min, co godzinę od rana do wieczora. Wystarczy zwykły bilet ZTM — najbezpieczniej 120-minutowy.',
        en: 'Line AP runs from Katowice Dworzec (the AP stop) to the airport in about 45–60 min, hourly from morning to evening. A regular ZTM ticket is enough; a 120-minute one is safest.',
      },
      url: 'https://metropoliagzm.pl/tag/linie-lotniskowe/',
    },
    {
      id: 'train', icon: 'train', lat: 50.25961, lon: 19.01753,
      image: { src: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/4b/Katowice_stacja_bud._dworcowy.JPG/960px-Katowice_stacja_bud._dworcowy.JPG', page: 'https://commons.wikimedia.org/wiki/File:Katowice_stacja_bud._dworcowy.JPG', author: 'Marek Mróz', license: 'CC BY-SA 4.0' },
      name: { pl: 'Dworzec Katowice (pociągi)', en: 'Katowice station (trains)' },
      text: {
        pl: 'Koleje Śląskie po regionie, PKP Intercity do Krakowa (~1 h), Warszawy i Wrocławia. Dworzec jest w samym centrum, przy Galerii Katowickiej.',
        en: 'Koleje Śląskie around the region, PKP Intercity to Kraków (~1 h), Warsaw and Wrocław. The station is right in the centre, in the Galeria Katowicka mall.',
      },
      url: 'https://www.kolejeslaskie.pl/',
    },
    {
      id: 'bike', icon: 'bike',
      name: { pl: 'Rowery Metrorower', en: 'Metrorower bikes' },
      text: {
        pl: 'Rower miejski w całej metropolii, także elektryczny — stacje w centrum, Strefie Kultury i w parkach. Wypożyczysz w aplikacji Metrorower.',
        en: 'City bikes across the metropolis, electric ones too, with stations in the centre, the Culture Zone and the parks. Rent them in the Metrorower app.',
      },
      url: 'https://metrorower.pl/',
    },
    {
      id: 'taxi', icon: 'car',
      name: { pl: 'Taksówki i przejazdy', en: 'Taxis and rides' },
      text: {
        pl: 'Bolt, Uber i FreeNow działają w całym mieście; przejazd z centrum na lotnisko trwa ok. 30–40 min autostradą A1.',
        en: 'Bolt, Uber and FreeNow cover the whole city; the centre to the airport takes about 30–40 min on the A1 motorway.',
      },
    },
  ],

  // MICHELIN Guide Poland 2026 — Katowice (all four listed restaurants), then local favourites
  restaurants: [
    {
      id: 'krzywa', lat: 50.25545, lon: 19.01574, address: 'ul. Krzywa 9', price: '€', tag: 'Bib Gourmand',
      image: { src: 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e3/Katowice-%C5%9Ar%C3%B3dmie%C5%9Bcie_S_-_ul._Krzywa_%282%29.jpg/960px-Katowice-%C5%9Ar%C3%B3dmie%C5%9Bcie_S_-_ul._Krzywa_%282%29.jpg', page: 'https://commons.wikimedia.org/wiki/File:Katowice-%C5%9Ar%C3%B3dmie%C5%9Bcie_S_-_ul._Krzywa_(2).jpg', author: 'Marek Mróz', license: 'CC BY-SA 4.0', caption: { pl: 'ul. Krzywa', en: 'Krzywa Street' } },
      name: { pl: 'KRZYWA Sztuka Wina', en: 'KRZYWA Sztuka Wina' },
      kind: { pl: 'kuchnia regionalna, bar winny', en: 'regional cuisine, wine bar' },
      text: {
        pl: 'Bar winny, sklep z winem i restauracja: domowe jedzenie i szeroka karta win w przystępnych cenach. Wędliny z własnej wędzarni.',
        en: 'Wine bar, wine shop and restaurant: comfort food and a long wine list at friendly prices. House-cured meats.',
      },
      url: 'https://guide.michelin.com/at/en/silesia/katowice_2377909/restaurant/krzywa-sztuka-wina',
    },
    {
      id: 'amfora', lat: 50.25793, lon: 19.02828, address: 'ul. Francuska 1a', price: '€', tag: 'MICHELIN',
      image: { src: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5a/Katowice_Francuska_1_wej%C5%9Bcie_2026.jpg/960px-Katowice_Francuska_1_wej%C5%9Bcie_2026.jpg', page: 'https://commons.wikimedia.org/wiki/File:Katowice_Francuska_1_wej%C5%9Bcie_2026.jpg', author: 'Adrian Tync', license: 'CC BY-SA 4.0', caption: { pl: 'ul. Francuska', en: 'Francuska Street' } },
      name: { pl: 'Amfora', en: 'Amfora' },
      kind: { pl: 'kuchnia bliskowschodnia i śródziemnomorska', en: 'Middle Eastern, Mediterranean' },
      text: {
        pl: 'Surowe, klimatyczne wnętrze i hojne porcje z bliskowschodnimi smakami. Zamknięte w poniedziałki.',
        en: 'A stripped-back, moody room and generous plates with Middle Eastern flavours. Closed on Mondays.',
      },
      url: 'https://guide.michelin.com/at/en/silesia/katowice_2377909/restaurant/amfora-1249441',
    },
    {
      id: 'prohibicja', lat: 50.24358, lon: 19.08017, address: 'ul. Krawczyka 1, Nikiszowiec', price: '€€', tag: 'MICHELIN',
      image: { src: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0b/Jan%C3%B3w-Nikiszowiec_II_078.jpg/960px-Jan%C3%B3w-Nikiszowiec_II_078.jpg', page: 'https://commons.wikimedia.org/wiki/File:Jan%C3%B3w-Nikiszowiec_II_078.jpg', author: 'Marek Mróz', license: 'CC BY-SA 4.0' },
      name: { pl: 'Śląska Prohibicja', en: 'Śląska Prohibicja' },
      kind: { pl: 'kuchnia śląska i polska', en: 'Silesian and Polish' },
      text: {
        pl: 'W dawnej stołówce górniczej na Nikiszowcu: rolada, kluski śląskie i inne klasyki. Dobre połączenie ze zwiedzaniem osiedla.',
        en: 'In a former miners’ canteen in Nikiszowiec: rolada, Silesian dumplings and other classics. Pairs well with a walk around the estate.',
      },
      url: 'https://guide.michelin.com/at/en/silesia/katowice_2377909/restaurant/slaska-prohibicja',
    },
    {
      id: 'mlodnik', lat: 50.23049, lon: 18.94138, address: 'ul. Panewnicka 224', price: '€€', tag: 'MICHELIN',
      name: { pl: 'Młodnik', en: 'Młodnik' },
      kind: { pl: 'brasserie: śródziemnomorska i polska', en: 'brasserie: Mediterranean and Polish' },
      text: {
        pl: 'Rodzinna brasserie z tarasem w Panewnikach: czyste smaki, śródziemnomorskie akcenty i lokalne dania, np. śledź.',
        en: 'A family-run brasserie with a terrace in Panewniki: clean flavours, Mediterranean touches and local dishes such as herring.',
      },
      url: 'https://guide.michelin.com/at/en/silesia/katowice_2377909/restaurant/mlodnik',
    },

    // Local favourites: places that recur in Katowice food guides (Kukbuk,
    // Twój Styl, Tripadvisor 2026); OSM coordinates, websites checked Oct 2026
    {
      id: 'tatiana', lat: 50.25849, lon: 19.02256, address: 'ul. Staromiejska 5', price: '€€', tag: { pl: 'polecane lokalnie', en: 'local favourite' },
      image: { src: 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d8/Katowice%2C_ul._Staromiejska_6_%28kamienica%29.jpg/960px-Katowice%2C_ul._Staromiejska_6_%28kamienica%29.jpg', page: 'https://commons.wikimedia.org/wiki/File:Katowice,_ul._Staromiejska_6_(kamienica).jpg', author: 'Piotrus', license: 'CC BY-SA 3.0', caption: { pl: 'ul. Staromiejska', en: 'Staromiejska Street' } },
      name: { pl: 'Tatiana', en: 'Tatiana' },
      kind: { pl: 'kuchnia śląska i polska', en: 'Silesian and Polish' },
      text: {
        pl: 'Kameralna restauracja tuż przy Rynku, ulubiona przez mieszkańców na śląską roladę, żur i domowe pierogi.',
        en: 'A small restaurant just off the Rynek, a local go-to for Silesian beef roulade, żur soup and home-made pierogi.',
      },
      url: 'https://www.restauracjatatiana.pl/',
    },
    {
      id: 'zurownia', lat: 50.25350, lon: 19.01905, address: 'ul. Ligonia 16', price: '€', tag: { pl: 'polecane lokalnie', en: 'local favourite' },
      image: { src: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8d/Katowice-%C5%9Ar%C3%B3dmie%C5%9Bcie_S_-_ul._Lompy_%2816%29.jpg/960px-Katowice-%C5%9Ar%C3%B3dmie%C5%9Bcie_S_-_ul._Lompy_%2816%29.jpg', page: 'https://commons.wikimedia.org/wiki/File:Katowice-%C5%9Ar%C3%B3dmie%C5%9Bcie_S_-_ul._Lompy_(16).jpg', author: 'Marek Mróz', license: 'CC BY-SA 4.0', caption: { pl: 'ul. Ligonia', en: 'Ligonia Street' } },
      name: { pl: 'Żurownia', en: 'Żurownia' },
      kind: { pl: 'śląski street food', en: 'Silesian street food' },
      text: {
        pl: 'Śląskie jedzenie w wersji ulicznej: żurek (także wegański), pizza na zakwasie żurkowym, kulebele i braty. Tanio i szybko.',
        en: 'Silesian food done as street food: żurek soup (vegan too), pizza on żur sourdough, kulebele and sausages. Cheap and quick.',
      },
    },
    {
      id: 'byfyj', lat: 50.24344, lon: 19.08121, address: 'ul. Krawczyka 5, Nikiszowiec', price: '€', tag: { pl: 'polecane lokalnie', en: 'local favourite' },
      image: { src: 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e9/2024-06_Katowice_bebok_Michalino_%282%29.jpg/960px-2024-06_Katowice_bebok_Michalino_%282%29.jpg', page: 'https://commons.wikimedia.org/wiki/File:2024-06_Katowice_bebok_Michalino_(2).jpg', author: 'Marek Mróz', license: 'CC BY 4.0', caption: { pl: 'ul. Krawczyka, Nikiszowiec — beboczka Michalino', en: 'Krawczyka Street, Nikiszowiec — the Michalino bebok' } },
      name: { pl: 'Cafe Byfyj', en: 'Cafe Byfyj' },
      kind: { pl: 'kawiarnia i bistro, piekarnia Michalski', en: 'café and bistro, Michalski bakery' },
      text: {
        pl: 'Kawiarnia na Nikiszowcu: śniadania, chałka, jagodzianki i sezonowe tarty, w południe śląskie obiady.',
        en: 'A café in Nikiszowiec: breakfasts, challah, blueberry buns and seasonal tarts, with Silesian lunches at midday.',
      },
      url: 'https://piekarniamichalski.pl/',
    },
    {
      id: 'zloty-osiol', veg: true, lat: 50.25726, lon: 19.02457, address: 'ul. Mariacka 1', price: '€', tag: { pl: 'polecane lokalnie', en: 'local favourite' },
      image: { src: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/31/Fa%C3%A7ade_of_7_Mariacka%2C_Katowice_%282024%29-L1005796.jpg/960px-Fa%C3%A7ade_of_7_Mariacka%2C_Katowice_%282024%29-L1005796.jpg', page: 'https://commons.wikimedia.org/wiki/File:Fa%C3%A7ade_of_7_Mariacka,_Katowice_(2024)-L1005796.jpg', author: 'Frank Schulenburg', license: 'CC BY-SA 4.0', caption: { pl: 'ul. Mariacka', en: 'Mariacka Street' } },
      name: { pl: 'Złoty Osioł', en: 'Złoty Osioł' },
      kind: { pl: 'wegańska jadłodajnia', en: 'vegan canteen' },
      text: {
        pl: 'Kultowy wegebar na Mariackiej: lasagne, curry, pierogi ruskie i wegańskie śniadania. Dużo opcji bezglutenowych.',
        en: 'A cult vegan bar on Mariacka: lasagne, curry, pierogi ruskie and vegan breakfasts. Plenty of gluten-free options.',
      },
      url: 'https://www.wegebar.com/',
    },
    {
      id: 'kafej', lat: 50.26537, lon: 19.02178, address: 'ul. Chorzowska 5', price: '€', tag: { pl: 'polecane lokalnie', en: 'local favourite' },
      image: { src: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/58/Chorzowska_Katowice_2024-08-08_05.jpg/960px-Chorzowska_Katowice_2024-08-08_05.jpg', page: 'https://commons.wikimedia.org/wiki/File:Chorzowska_Katowice_2024-08-08_05.jpg', author: 'Leonhard Lenz', license: 'CC0', caption: { pl: 'ul. Chorzowska', en: 'Chorzowska Street' } },
      name: { pl: 'Kafej', en: 'Kafej' },
      kind: { pl: 'śniadania i kawa', en: 'breakfast and coffee' },
      text: {
        pl: 'Przy Spodku: kawa z polskich palarni, bajgle, omlety i pancakes — dobre miejsce na śniadanie przed Strefą Kultury.',
        en: 'By the Spodek: coffee from Polish roasters, bagels, omelettes and pancakes. A good breakfast before the Culture Zone.',
      },
      url: 'https://kafej.pl/',
    },
    {
      id: 'falla', veg: true, lat: 50.25490, lon: 19.02128, address: 'ul. Plebiscytowa 10', price: '€', tag: { pl: 'polecane lokalnie', en: 'local favourite' },
      image: { src: 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/2d/Katowice-%C5%9Ar%C3%B3dmie%C5%9Bcie_S_-_ul._Plebiscytowa_%281%29.jpg/960px-Katowice-%C5%9Ar%C3%B3dmie%C5%9Bcie_S_-_ul._Plebiscytowa_%281%29.jpg', page: 'https://commons.wikimedia.org/wiki/File:Katowice-%C5%9Ar%C3%B3dmie%C5%9Bcie_S_-_ul._Plebiscytowa_(1).jpg', author: 'Marek Mróz', license: 'CC BY-SA 4.0', caption: { pl: 'ul. Plebiscytowa', en: 'Plebiscytowa Street' } },
      name: { pl: 'Falla', en: 'Falla' },
      kind: { pl: 'wegetariańska, bliskowschodnia', en: 'vegetarian, Middle Eastern' },
      text: {
        pl: 'W pełni wegetariańska: hummus, falafel, pikle i pita na wspólnym talerzu, a do tego burgery i shake’i.',
        en: 'Fully vegetarian: hummus, falafel, pickles and pita on a sharing platter, plus burgers and milkshakes.',
      },
      url: 'https://fallakatowice.pl/',
    },
    {
      id: 'madara', lat: 50.26072, lon: 19.02445, address: 'ul. Moniuszki 12', price: '€', tag: { pl: 'polecane lokalnie', en: 'local favourite' },
      image: { src: 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/fb/Katowice_Moniuszki_4_2024.jpg/960px-Katowice_Moniuszki_4_2024.jpg', page: 'https://commons.wikimedia.org/wiki/File:Katowice_Moniuszki_4_2024.jpg', author: 'Adrian Tync', license: 'CC BY-SA 4.0', caption: { pl: 'ul. Moniuszki', en: 'Moniuszki Street' } },
      name: { pl: 'Madara Ramen', en: 'Madara Ramen' },
      kind: { pl: 'ramen', en: 'ramen' },
      text: {
        pl: 'Ramen na lekkich i gęstych bulionach; chwalony za yuzu shio.',
        en: 'Ramen on light and rich broths; the yuzu shio gets the praise.',
      },
      url: 'https://www.madararamen.pl/',
    },
    {
      id: 'kalimera', lat: 50.25711, lon: 19.02621, address: 'ul. Tylna Mariacka 13a', price: '€', tag: { pl: 'polecane lokalnie', en: 'local favourite' },
      image: { src: 'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b2/Katowice_Tylna_Mariacka_murpentra%C4%B5o_hompartoj.jpg/960px-Katowice_Tylna_Mariacka_murpentra%C4%B5o_hompartoj.jpg', page: 'https://commons.wikimedia.org/wiki/File:Katowice_Tylna_Mariacka_murpentra%C4%B5o_hompartoj.jpg', author: 'Kastanoto', license: 'CC0', caption: { pl: 'Tylna Mariacka — mural', en: 'Tylna Mariacka — a mural' } },
      name: { pl: 'Kalimera Street Food', en: 'Kalimera Street Food' },
      kind: { pl: 'grecki street food', en: 'Greek street food' },
      text: {
        pl: 'Budka za Mariacką: pita z gyrosem i souvlaki z jagnięciny — na szybko, wieczorem przed lub po barach.',
        en: 'A kiosk behind Mariacka: chicken gyros pita and lamb souvlaki. Quick food before or after the bars.',
      },
      url: 'https://www.kalimerastreetfood.pl/',
    },
    {
      id: 'taj', lat: 50.25732, lon: 19.02359, address: 'ul. Dworcowa 4', price: '€', tag: { pl: 'polecane lokalnie', en: 'local favourite' },
      image: { src: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a0/2023-07_Katowice_ul._Dworcowa_%284%29.jpg/960px-2023-07_Katowice_ul._Dworcowa_%284%29.jpg', page: 'https://commons.wikimedia.org/wiki/File:2023-07_Katowice_ul._Dworcowa_(4).jpg', author: 'Marek Mróz', license: 'CC BY-SA 4.0', caption: { pl: 'ul. Dworcowa — stary dworzec', en: 'Dworcowa Street — the old station' } },
      name: { pl: 'Taj', en: 'Taj' },
      kind: { pl: 'kuchnia tajska', en: 'Thai' },
      text: {
        pl: 'Tajskie jedzenie uliczne blisko dworca: curry w trzech kolorach, morning glory, sałatka z kiełbaską naem.',
        en: 'Thai street food near the station: curries in three colours, morning glory and naem sausage salad.',
      },
    },
  ],

  places: [
    {
      id: 'strefa', lat: 50.26401, lon: 19.03398, tag: { pl: 'muzeum', en: 'museum' },
      image: { src: 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/dc/Muzeum_%C5%9Al%C4%85skie_-_szyb_Warszawa.jpg/960px-Muzeum_%C5%9Al%C4%85skie_-_szyb_Warszawa.jpg', page: 'https://commons.wikimedia.org/wiki/File:Muzeum_%C5%9Al%C4%85skie_-_szyb_Warszawa.jpg', author: 'EwkaC', license: 'CC BY-SA 4.0' },
      name: { pl: 'Muzeum Śląskie (Strefa Kultury)', en: 'Silesian Museum (Culture Zone)' },
      text: {
        pl: 'Nowoczesne muzeum w dawnej kopalni Katowice, w dużej części pod ziemią: historia Górnego Śląska i polskie malarstwo. Wieża szybowa z punktem widokowym.',
        en: 'A modern museum on the former Katowice coal mine, largely underground: Upper Silesian history and Polish painting. The mine shaft tower has a viewpoint.',
      },
      url: 'https://muzeumslaskie.pl/en/',
    },
    {
      id: 'nospr', lat: 50.2639, lon: 19.02867, tag: { pl: 'koncerty', en: 'concerts' },
      image: { src: 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d3/010_NOSPR_Narodowa_Orkiestra_Symfoniczna_Polskiego_Radia_-_koncert_w_Katowicach.jpg/960px-010_NOSPR_Narodowa_Orkiestra_Symfoniczna_Polskiego_Radia_-_koncert_w_Katowicach.jpg', page: 'https://commons.wikimedia.org/wiki/File:010_NOSPR_Narodowa_Orkiestra_Symfoniczna_Polskiego_Radia_-_koncert_w_Katowicach.jpg', author: 'Marek Ślusarczyk (Tupungato)', license: 'CC BY 3.0' },
      name: { pl: 'NOSPR', en: 'NOSPR concert hall' },
      text: {
        pl: 'Siedziba Narodowej Orkiestry Symfonicznej Polskiego Radia, słynąca z akustyki. Bilety na weekend warto kupić wcześniej.',
        en: 'Home of the Polish National Radio Symphony Orchestra, known for its acoustics. Book weekend concerts ahead.',
      },
      url: 'https://www.nospr.org.pl/en',
    },
    {
      id: 'spodek', lat: 50.26611, lon: 19.02533, tag: { pl: 'architektura', en: 'architecture' },
      image: { src: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a5/Exterior_of_Spodek%2C_20240808.jpg/960px-Exterior_of_Spodek%2C_20240808.jpg', page: 'https://commons.wikimedia.org/wiki/File:Exterior_of_Spodek,_20240808.jpg', author: 'Abzeronow', license: 'CC BY 4.0' },
      name: { pl: 'Spodek i MCK', en: 'Spodek and the ICC' },
      text: {
        pl: 'Ikona miasta z lat 70. — hala w kształcie latającego spodka — obok Międzynarodowego Centrum Kongresowego z zielonym dachem, po którym można spacerować.',
        en: 'The city’s 1970s icon, an arena shaped like a flying saucer, next to the International Congress Centre with a green roof you can walk on.',
      },
      url: 'https://spodekkatowice.pl/',
    },
    {
      id: 'nikiszowiec', lat: 50.24349, lon: 19.08169, tag: { pl: 'zabytek', en: 'heritage' },
      image: { src: 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/22/Nikiszowiec_Katowice_Danieluk.jpg/960px-Nikiszowiec_Katowice_Danieluk.jpg', page: 'https://commons.wikimedia.org/wiki/File:Nikiszowiec_Katowice_Danieluk.jpg', author: 'Robert Danieluk', license: 'CC BY-SA 4.0' },
      name: { pl: 'Nikiszowiec', en: 'Nikiszowiec' },
      text: {
        pl: 'Osiedle górnicze z początku XX w. z czerwonej cegły — zabytek historii. Obok Galeria Szyb Wilson w dawnej łaźni kopalnianej.',
        en: 'An early-20th-century red-brick miners’ estate, a national heritage site. The Szyb Wilson gallery in a former pithead bath house is next door.',
      },
      url: 'https://www.katowice.eu/en/',
    },
    {
      id: 'mariacka', lat: 50.25739, lon: 19.02711, tag: { pl: 'wieczorem', en: 'evenings' },
      image: { src: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/76/At_Katowice_2024_078.jpg/960px-At_Katowice_2024_078.jpg', page: 'https://commons.wikimedia.org/wiki/File:At_Katowice_2024_078.jpg', author: 'Mike Peel (mikepeel.net)', license: 'CC BY-SA 4.0' },
      name: { pl: 'Ulica Mariacka i Rynek', en: 'Mariacka Street and the Market Square' },
      text: {
        pl: 'Deptak z kawiarniami i barami, najżywszy wieczorem, kilka minut od Rynku z fontanną i tramwajami.',
        en: 'A pedestrian street of cafés and bars, liveliest in the evening, a few minutes from the Market Square with its fountain and trams.',
      },
    },
    {
      id: 'dolina', lat: 50.24775, lon: 19.04722, tag: { pl: 'natura', en: 'outdoors' },
      image: { src: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/aa/KATOWICE%2C_AB._286.JPG/960px-KATOWICE%2C_AB._286.JPG', page: 'https://commons.wikimedia.org/wiki/File:KATOWICE,_AB._286.JPG', author: 'Antekbojar', license: 'CC0' },
      name: { pl: 'Dolina Trzech Stawów', en: 'Valley of Three Ponds' },
      text: {
        pl: 'Duży park ze stawami, ścieżkami rowerowymi i rolkowymi, latem miejsce koncertów i festiwali.',
        en: 'A large park with ponds and cycling and skating paths; summer concerts and festivals.',
      },
    },
    {
      id: 'parkslaski', lat: 50.28657, lon: 18.98707, tag: { pl: 'park', en: 'park' },
      image: { src: 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/99/Park_%C5%9Al%C4%85ski_-_Elka_-_09.08.2024_14-17-18.jpg/960px-Park_%C5%9Al%C4%85ski_-_Elka_-_09.08.2024_14-17-18.jpg', page: 'https://commons.wikimedia.org/wiki/File:Park_%C5%9Al%C4%85ski_-_Elka_-_09.08.2024_14-17-18.jpg', author: 'Zwiadowca21', license: 'CC BY-SA 4.0' },
      name: { pl: 'Park Śląski (Chorzów)', en: 'Silesian Park (Chorzów)' },
      text: {
        pl: 'Jeden z największych parków miejskich w Europie: kolejka linowa Elka, Śląski Ogród Zoologiczny, Planetarium Śląskie i Stadion Śląski. Tramwajem z centrum.',
        en: 'One of Europe’s largest city parks: the Elka cable car, the Silesian Zoo, the Silesian Planetarium and the Silesian Stadium. A tram ride from the centre.',
      },
      url: 'https://parkslaski.pl/',
    },
    {
      id: 'planetarium', lat: 50.29073, lon: 18.993, tag: { pl: 'nauka', en: 'science' },
      image: { src: 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/cf/Planetarium_%C5%9Alaski_Park_Nauki.jpg/960px-Planetarium_%C5%9Alaski_Park_Nauki.jpg', page: 'https://commons.wikimedia.org/wiki/File:Planetarium_%C5%9Alaski_Park_Nauki.jpg', author: 'Fotoomnia', license: 'CC BY-SA 4.0' },
      name: { pl: 'Planetarium Śląskie', en: 'Silesian Planetarium' },
      text: {
        pl: 'Największe planetarium w Polsce, po modernizacji — seanse pod kopułą i obserwatorium. W Parku Śląskim.',
        en: 'Poland’s largest planetarium, recently modernised: dome shows and an observatory. In Silesian Park.',
      },
      url: 'https://planetarium.edu.pl/',
    },
    {
      id: 'katedra', lat: 50.25161, lon: 19.01911, tag: { pl: 'architektura', en: 'architecture' },
      image: { src: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/af/Katowice_Archikatedra_Chrystusa_Kr%C3%B3la_fasada_2026.jpg/960px-Katowice_Archikatedra_Chrystusa_Kr%C3%B3la_fasada_2026.jpg', page: 'https://commons.wikimedia.org/wiki/File:Katowice_Archikatedra_Chrystusa_Kr%C3%B3la_fasada_2026.jpg', author: 'Adrian Tync', license: 'CC BY-SA 4.0' },
      name: { pl: 'Archikatedra Chrystusa Króla', en: 'Cathedral of Christ the King' },
      text: {
        pl: 'Jedna z największych katedr w Polsce, z monumentalną kopułą, kilka przystanków od centrum.',
        en: 'One of Poland’s largest cathedrals, with a monumental dome, a few stops from the centre.',
      },
    },
    {
      id: 'michal', lat: 50.24096, lon: 19.0048, tag: { pl: 'zabytek', en: 'heritage' },
      image: { src: 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/f5/Katowice_ko%C5%9Bci%C3%B3%C5%82_%C5%9Bw._Micha%C5%82a_Archanio%C5%82a_2026_%282%29.jpg/960px-Katowice_ko%C5%9Bci%C3%B3%C5%82_%C5%9Bw._Micha%C5%82a_Archanio%C5%82a_2026_%282%29.jpg', page: 'https://commons.wikimedia.org/wiki/File:Katowice_ko%C5%9Bci%C3%B3%C5%82_%C5%9Bw._Micha%C5%82a_Archanio%C5%82a_2026_(2).jpg', author: 'Adrian Tync', license: 'CC BY-SA 4.0' },
      name: { pl: 'Drewniany kościół św. Michała', en: 'Wooden Church of St Michael' },
      text: {
        pl: 'XVI-wieczny drewniany kościółek przeniesiony do Parku Kościuszki — dobry cel spaceru po parku.',
        en: 'A 16th-century wooden church moved to Kościuszko Park, a good goal for a walk in the park.',
      },
    },
    {
      id: 'giszowiec', lat: 50.22167, lon: 19.06547, tag: { pl: 'zabytek', en: 'heritage' },
      image: { src: 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/1d/Giszowiec_collage.jpg/960px-Giszowiec_collage.jpg', page: 'https://commons.wikimedia.org/wiki/File:Giszowiec_collage.jpg', author: 'Marek Mróz, Christophorus ex Silesia, Durski, Klaumich49', license: 'CC BY-SA 4.0' },
      name: { pl: 'Giszowiec', en: 'Giszowiec' },
      text: {
        pl: 'Osiedle-ogród dla górników z 1906–1910 r., z domkami wśród zieleni — spokojniejszy brat Nikiszowca.',
        en: 'A 1906–1910 garden village for miners, with cottages among the trees: Nikiszowiec’s quieter sibling.',
      },
    },
  ],

  // Things to do: what you book or join, not just look at — OSM coordinates,
  // websites checked Oct 2026; seasons and timetables are on their pages
  activities: [
    {
      id: 'legendia', lat: 50.27602, lon: 18.99200, address: 'ul. Złota, Chorzów', tag: { pl: 'park rozrywki', en: 'theme park' },
      name: { pl: 'Legendia — Śląskie Wesołe Miasteczko', en: 'Legendia theme park' },
      text: {
        pl: 'Park rozrywki w Parku Śląskim: rollercoastery (m.in. Lech Coaster) i strefa dla dzieci. Działa sezonowo — terminy w kalendarzu na stronie.',
        en: 'A theme park in Silesian Park: rollercoasters (Lech Coaster among them) and a kids’ area. Open seasonally; dates are in the calendar on its site.',
      },
      url: 'https://www.legendia.pl/',
    },
    {
      id: 'zoo', lat: 50.28225, lon: 18.99415, address: 'ul. Promenada gen. J. Ziętka 7, Chorzów', tag: { pl: 'z dziećmi', en: 'with kids' },
      name: { pl: 'Śląski Ogród Zoologiczny', en: 'Silesian Zoo' },
      text: {
        pl: 'Duże zoo w Parku Śląskim, z Kotliną Dinozaurów — naturalnej wielkości modelami w lesie.',
        en: 'A large zoo in Silesian Park, with the Dinosaur Valley: life-size models among the trees.',
      },
      url: 'https://slaskiezoo.pl/',
    },
    {
      id: 'elka', lat: 50.28269, lon: 18.98564, address: 'Park Śląski, Chorzów', tag: { pl: 'widoki', en: 'views' },
      name: { pl: 'Kolej linowa Elka', en: 'Elka cable car' },
      text: {
        pl: 'Gondole i krzesełka nad Parkiem Śląskim, między Stadionem Śląskim, Legendią i Planetarium. Widok na cały park i miasto.',
        en: 'Gondolas and chairs over Silesian Park, linking the Silesian Stadium, Legendia and the Planetarium. Views over the park and the city.',
      },
      url: 'https://elka.parkslaski.pl/',
    },
    {
      id: 'guido', lat: 50.28959, lon: 18.79178, address: 'ul. 3 Maja 93, Zabrze', tag: { pl: 'pod ziemią', en: 'underground' },
      name: { pl: 'Zabytkowa Kopalnia Guido (Zabrze)', en: 'Guido historic coal mine (Zabrze)' },
      text: {
        pl: 'Zjazd klatką szybową pod ziemię i trasa z przewodnikiem po dawnej kopalni węgla. Zabrze: ok. 30 min pociągiem lub autem.',
        en: 'Ride the cage down the shaft and follow a guide through a former coal mine. Zabrze is about 30 min by train or car.',
      },
      url: 'https://kopalniaguido.pl/',
    },
    {
      id: 'luiza', lat: 50.29631, lon: 18.80706, address: 'ul. Wolności 410, Zabrze', tag: { pl: 'pod ziemią', en: 'underground' },
      name: { pl: 'Sztolnia Królowa Luiza (Zabrze)', en: 'Queen Louise Adit (Zabrze)' },
      text: {
        pl: 'XIX-wieczna kopalnia i sztolnia odwadniająca: podziemna trasa pieszo, kolejką i łodziami elektrycznymi. Dłuższe warianty trwają kilka godzin.',
        en: 'A 19th-century mine and drainage adit: an underground route on foot, by mine train and in electric boats. The longer tours take several hours.',
      },
      url: 'https://muzeumgornictwa.pl/',
    },
    {
      id: 'wilson', lat: 50.25060, lon: 19.08350, address: 'ul. Oswobodzenia 1', tag: { pl: 'sztuka', en: 'art' },
      name: { pl: 'Galeria Szyb Wilson', en: 'Szyb Wilson gallery' },
      text: {
        pl: 'Sztuka współczesna w dawnej łaźni górniczej, kilka minut od Nikiszowca — dobre uzupełnienie spaceru po osiedlu.',
        en: 'Contemporary art in a former miners’ bathhouse a few minutes from Nikiszowiec. Pairs well with a walk around the estate.',
      },
      url: 'https://www.szybwilson.org/',
    },
    {
      id: 'gks', lat: 50.25134, lon: 18.97418, address: 'ul. Nowa Bukowa 1', tag: { pl: 'sport', en: 'sport' },
      name: { pl: 'Mecz GKS Katowice (Arena Katowice)', en: 'A GKS Katowice match (Arena Katowice)' },
      text: {
        pl: 'Piłkarski GKS gra na nowej Arenie Katowice (otwartej w 2025 r., ok. 15 tys. miejsc). Terminarz i bilety na stronie klubu.',
        en: 'GKS’s footballers play at the new Arena Katowice (opened in 2025, about 15,000 seats). Fixtures and tickets are on the club’s site.',
      },
      url: 'https://www.gkskatowice.eu/',
    },
  ],

  // Shopping: malls, the station gallery, tourist information — OSM coordinates,
  // websites checked Oct 2026; the first item is a tip, not a place
  shopping: [
    {
      id: 'sundays', icon: 'clock', tip: true,
      name: { pl: 'Niedziele i drobne zakupy', en: 'Sundays and small shopping' },
      text: {
        pl: 'W Polsce większość sklepów i galerii jest zamknięta w niedziele, poza kilkoma niedzielami handlowymi w roku. Żabki i stacje benzynowe działają codziennie — Żabki zwykle do późna.',
        en: 'In Poland most shops and malls are closed on Sundays, apart from a few trading Sundays a year. Żabka convenience stores and petrol stations open every day; Żabkas usually until late.',
      },
    },
    {
      id: 'galeria', lat: 50.25887, lon: 19.01691, address: 'ul. 3 Maja 30', tag: { pl: 'galeria handlowa', en: 'mall' },
      image: { src: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/78/Galeria_Katowicka%2C_kielichy.jpg/960px-Galeria_Katowicka%2C_kielichy.jpg', page: 'https://commons.wikimedia.org/wiki/File:Galeria_Katowicka,_kielichy.jpg', author: 'Kamil Czaiński', license: 'CC BY-SA 4.0' },
      name: { pl: 'Galeria Katowicka', en: 'Galeria Katowicka' },
      text: {
        pl: 'Galeria połączona z dworcem kolejowym i autobusowym, w samym centrum — sklepy, restauracje i supermarket.',
        en: 'A mall joined to the railway and bus station, right in the centre: shops, places to eat and a supermarket.',
      },
      url: 'https://galeriakatowicka.eu/',
    },
    {
      id: 'supersam', lat: 50.26212, lon: 19.01904, address: 'ul. ks. P. Skargi 6', tag: { pl: 'galeria handlowa', en: 'mall' },
      image: { src: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/59/Supersam_in_Katowice%2C_Silesian_Voivodeship%2C_Poland%2C_May_2022.jpg/960px-Supersam_in_Katowice%2C_Silesian_Voivodeship%2C_Poland%2C_May_2022.jpg', page: 'https://commons.wikimedia.org/wiki/File:Supersam_in_Katowice,_Silesian_Voivodeship,_Poland,_May_2022.jpg', author: 'MichalPL', license: 'CC BY-SA 4.0' },
      name: { pl: 'Supersam', en: 'Supersam' },
      text: {
        pl: 'Kameralna galeria w centrum, na miejscu dawnego modernistycznego Supersamu — supermarket, drogeria i kawiarnie.',
        en: 'A small mall in the centre, on the site of the old modernist Supersam: a supermarket, a chemist’s and cafés.',
      },
      url: 'https://supersam-katowice.pl/',
    },
    {
      id: 'scc', lat: 50.27072, lon: 19.00387, address: 'ul. Chorzowska 107', tag: { pl: 'galeria handlowa', en: 'mall' },
      image: { src: 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/ea/Katowice_-_Silesia_City_Center_%282%29.jpg/960px-Katowice_-_Silesia_City_Center_%282%29.jpg', page: 'https://commons.wikimedia.org/wiki/File:Katowice_-_Silesia_City_Center_(2).jpg', author: 'Lestat (Jan Mehlich)', license: 'CC BY-SA 3.0' },
      name: { pl: 'Silesia City Center', en: 'Silesia City Center' },
      text: {
        pl: 'Jedna z największych galerii w regionie, na terenie dawnej kopalni — kino, setki sklepów. Tramwajem z centrum w kilka minut.',
        en: 'One of the region’s biggest malls, on a former coal-mine site: a cinema and hundreds of shops. A few minutes by tram from the centre.',
      },
      url: 'https://www.silesiacitycenter.com.pl/',
    },
    {
      id: '3stawy', lat: 50.24312, lon: 19.03782, address: 'ul. gen. K. Pułaskiego 60', tag: { pl: 'galeria handlowa', en: 'mall' },
      image: { src: 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/63/Katowice_-_3_Stawy_%281%29.jpg/960px-Katowice_-_3_Stawy_%281%29.jpg', page: 'https://commons.wikimedia.org/wiki/File:Katowice_-_3_Stawy_(1).jpg', author: 'Michał Bulsa', license: 'CC0' },
      name: { pl: 'Centrum Handlowe 3 Stawy', en: '3 Stawy shopping centre' },
      text: {
        pl: 'Centrum handlowe z dużym hipermarketem przy Dolinie Trzech Stawów — wygodne na większe zakupy autem.',
        en: 'A shopping centre with a large hypermarket by the Valley of Three Ponds; handy for a bigger shop by car.',
      },
      url: 'https://3stawy.pl/',
    },
    {
      id: 'libero', lat: 50.22416, lon: 18.98685, address: 'ul. T. Kościuszki 229', tag: { pl: 'galeria handlowa', en: 'mall' },
      image: { src: 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/9c/Galeria_Libero.jpg/960px-Galeria_Libero.jpg', page: 'https://commons.wikimedia.org/wiki/File:Galeria_Libero.jpg', author: 'KamilSikoora', license: 'CC BY-SA 4.0' },
      name: { pl: 'Libero Katowice', en: 'Libero Katowice' },
      text: {
        pl: 'Nowoczesna galeria na południu miasta, z kinem i strefą restauracji.',
        en: 'A modern mall in the south of the city, with a cinema and a food court.',
      },
      url: 'https://liberokatowice.pl/',
    },
    // independent shops: OSM coordinates; checked Oct 2026
    {
      id: 'lepshe', lat: 50.25795, lon: 19.02167, address: 'ul. Świętego Jana 14', tag: { pl: 'niezależny', en: 'independent' },
      name: { pl: 'Lepshe Concept Store', en: 'Lepshe Concept Store' },
      kind: { pl: 'concept store, polskie marki', en: 'concept store, Polish brands' },
      text: {
        pl: 'Przy Rynku: wybrane polskie marki — torebki, biżuteria, kosmetyki, świece i ceramika. Dobre miejsce na prezent.',
        en: 'Just off the Rynek: hand-picked Polish brands, from bags and jewellery to cosmetics, candles and ceramics. A good place for a gift.',
      },
      url: 'https://lepshe.pl/',
    },
    {
      id: 'listopad51', lat: 50.25579, lon: 19.02640, address: 'ul. Wojewódzka 25', tag: { pl: 'niezależny', en: 'independent' },
      name: { pl: 'Listopad51', en: 'Listopad51' },
      kind: { pl: 'sklep płytowy', en: 'record shop' },
      text: {
        pl: 'Rodzinny sklep z płytami: głównie winyle i CD, są też kasety. Właściciele organizują giełdy płytowe w całej Polsce.',
        en: 'A family-run record shop: mostly vinyl and CDs, cassettes too. The owners run record fairs across Poland.',
      },
      url: 'https://portalwinylowy.pl/sklepy-plytowe/listopad51',
    },
    {
      id: 'komis-plytowy', lat: 50.26029, lon: 19.01728, address: 'ul. 3 Maja 19', tag: { pl: 'niezależny', en: 'independent' },
      name: { pl: 'Komis Płytowy', en: 'Komis Płytowy' },
      kind: { pl: 'płyty z drugiej ręki', en: 'second-hand records' },
      text: {
        pl: 'Tysiące używanych winyli i trochę nowych, single i pocztówki dźwiękowe — sklep do przekopania na spokojnie.',
        en: 'Thousands of used records and some new ones, singles and flexi-disc postcards: a shop for a long dig.',
      },
    },
    {
      id: 'lumpiary', lat: 50.25539, lon: 19.01946, address: 'ul. Kochanowskiego 11', tag: { pl: 'niezależny', en: 'independent' },
      name: { pl: 'Śląskie Lumpiary', en: 'Śląskie Lumpiary' },
      kind: { pl: 'vintage i second hand', en: 'vintage and second-hand' },
      text: {
        pl: 'Odzież vintage i z drugiej ręki, kilka minut od Rynku.',
        en: 'Vintage and second-hand clothes, a few minutes from the Rynek.',
      },
    },
    {
      id: 'cit', lat: 50.25865, lon: 19.02129, address: 'Rynek 11', tag: { pl: 'informacja', en: 'information' },
      image: { src: 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/26/Rynek_Katowice_2024-08-11.jpg/960px-Rynek_Katowice_2024-08-11.jpg', page: 'https://commons.wikimedia.org/wiki/File:Rynek_Katowice_2024-08-11.jpg', author: 'Z thomas', license: 'CC BY 4.0', caption: { pl: 'Rynek', en: 'Rynek (market square)' } },
      name: { pl: 'Centrum Informacji Turystycznej', en: 'Tourist Information Centre' },
      text: {
        pl: 'Na Rynku: mapy, informacje o wydarzeniach i pamiątki z Katowic.',
        en: 'On the Rynek: maps, what’s on, and souvenirs from Katowice.',
      },
    },
  ],

  // Ready-made walks: one tap loads the stops into the trip (keys: section:id)
  walks: [
    {
      id: 'centre', mode: 'walking', icon: '🏛️',
      name: { pl: 'Od Spodka do Mariackiej', en: 'From the Spodek to Mariacka' },
      text: {
        pl: 'Modernizm i Strefa Kultury, na koniec ulica barów i gyros. Ok. 2,5 km, 2–3 godziny ze zwiedzaniem.',
        en: 'Modernism and the Culture Zone, ending on the bar street with a gyros. About 2.5 km, 2–3 hours with visits.',
      },
      stops: ['places:spodek', 'places:nospr', 'places:strefa', 'places:mariacka', 'restaurants:kalimera'],
    },
    {
      id: 'mining', mode: 'transit', icon: '⛏️',
      name: { pl: 'Śląskie osiedla górnicze', en: 'Silesian mining estates' },
      text: {
        pl: 'Czerwone familoki Nikiszowca, kawa w Byfyju, obiad w Prohibicji, potem leśny Giszowiec. Pół dnia; autobusy z centrum.',
        en: 'Nikiszowiec’s red-brick familoki, coffee at Byfyj, lunch at Prohibicja, then the garden town of Giszowiec. Half a day; buses from the centre.',
      },
      stops: ['places:nikiszowiec', 'restaurants:byfyj', 'restaurants:prohibicja', 'places:giszowiec'],
    },
    {
      id: 'parkslaski', mode: 'walking', icon: '🎢',
      name: { pl: 'Dzień w Parku Śląskim', en: 'A day in Silesian Park' },
      text: {
        pl: 'Zoo z dinozaurami, Elką nad parkiem do Legendii, na koniec gwiazdy w Planetarium. Cały dzień, świetny z dziećmi.',
        en: 'The zoo and its dinosaurs, the Elka cable car over the park to Legendia, then the stars at the Planetarium. A full day, great with kids.',
      },
      stops: ['activities:zoo', 'activities:elka', 'activities:legendia', 'places:planetarium'],
    },
    {
      id: 'churches', mode: 'walking', icon: '⛪',
      name: { pl: 'Wino, katedra i drewniany kościół', en: 'Wine, a cathedral and a wooden church' },
      text: {
        pl: 'Lunch w KRZYWEJ, największa katedra w Polsce i XVI-wieczny drewniany kościół w Parku Kościuszki. Ok. 2,5 km.',
        en: 'Lunch at KRZYWA, Poland’s largest cathedral and a 16th-century wooden church in Kościuszko Park. About 2.5 km.',
      },
      stops: ['restaurants:krzywa', 'places:katedra', 'places:michal'],
    },
  ],

  // Po śląsku: a few words guests will hear (Silesian → Polish / English)
  phrases: [
    { sl: 'Pyrsk!', pl: 'Cześć!', en: 'Hi!' },
    { sl: 'Jak sie mosz?', pl: 'Jak się masz?', en: 'How are you?' },
    { sl: 'Jo', pl: 'Tak', en: 'Yes' },
    { sl: 'Kaj?', pl: 'Gdzie?', en: 'Where?' },
    { sl: 'Gryfnie', pl: 'Ładnie, fajnie', en: 'Nice, lovely' },
    { sl: 'Fest', pl: 'Bardzo, mocno', en: 'Very, a lot' },
    { sl: 'Szpacyr', pl: 'Spacer', en: 'A walk' },
    { sl: 'Gruba', pl: 'Kopalnia', en: 'Coal mine' },
    { sl: 'Hajer', pl: 'Górnik', en: 'Miner' },
    { sl: 'Familok', pl: 'Robotniczy dom wielorodzinny', en: 'Miners’ tenement house' },
    { sl: 'Bajtel', pl: 'Dziecko', en: 'Kid' },
    { sl: 'Szolka', pl: 'Filiżanka', en: 'Cup' },
    { sl: 'Kołocz', pl: 'Śląskie ciasto drożdżowe', en: 'Silesian yeast cake' },
    { sl: 'Modro kapusta', pl: 'Czerwona kapusta', en: 'Red cabbage' },
    { sl: 'Gyszynk', pl: 'Prezent', en: 'Gift' },
    { sl: 'Wihajster', pl: 'To coś, ustrojstwo', en: 'Thingamajig' },
  ],

  sources: [
    { name: 'Transport GZM (ZTM)', url: 'https://www.metropoliaztm.pl/en/s/' },
    { name: 'MICHELIN Guide — Katowice', url: 'https://guide.michelin.com/at/en/silesia/katowice_2377909/restaurants' },
    { name: 'katowice.eu', url: 'https://www.katowice.eu/en/' },
  ],
};
