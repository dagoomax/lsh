'use strict';

// Katowice city guide for the dashboard's onboarding card (src/routes/guide.js).
// Checked October 2026:
//   transport   metropoliaztm.pl (Transport GZM: tickets, apps, no tickets from
//               drivers since 1 Jan 2026, contactless cards on board),
//               metropoliagzm.pl (airport line AP), Metrorower
//   restaurants MICHELIN Guide Poland 2026, Katowice: all four listed places,
//               then local favourites from Katowice food guides
//   places      the city's main sights; coordinates from OpenStreetMap
//   images      Wikimedia Commons (free licences — author and licence shown
//               on each photo, linked to its file page)
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
      name: { pl: 'Żurownia', en: 'Żurownia' },
      kind: { pl: 'śląski street food', en: 'Silesian street food' },
      text: {
        pl: 'Śląskie jedzenie w wersji ulicznej: żurek (także wegański), pizza na zakwasie żurkowym, kulebele i braty. Tanio i szybko.',
        en: 'Silesian food done as street food: żurek soup (vegan too), pizza on żur sourdough, kulebele and sausages. Cheap and quick.',
      },
    },
    {
      id: 'byfyj', lat: 50.24344, lon: 19.08121, address: 'ul. Krawczyka 5, Nikiszowiec', price: '€', tag: { pl: 'polecane lokalnie', en: 'local favourite' },
      name: { pl: 'Cafe Byfyj', en: 'Cafe Byfyj' },
      kind: { pl: 'kawiarnia i bistro, piekarnia Michalski', en: 'café and bistro, Michalski bakery' },
      text: {
        pl: 'Kawiarnia na Nikiszowcu: śniadania, chałka, jagodzianki i sezonowe tarty, w południe śląskie obiady.',
        en: 'A café in Nikiszowiec: breakfasts, challah, blueberry buns and seasonal tarts, with Silesian lunches at midday.',
      },
      url: 'https://piekarniamichalski.pl/',
    },
    {
      id: 'zloty-osiol', lat: 50.25726, lon: 19.02457, address: 'ul. Mariacka 1', price: '€', tag: { pl: 'polecane lokalnie', en: 'local favourite' },
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
      name: { pl: 'Kafej', en: 'Kafej' },
      kind: { pl: 'śniadania i kawa', en: 'breakfast and coffee' },
      text: {
        pl: 'Przy Spodku: kawa z polskich palarni, bajgle, omlety i pancakes — dobre miejsce na śniadanie przed Strefą Kultury.',
        en: 'By the Spodek: coffee from Polish roasters, bagels, omelettes and pancakes. A good breakfast before the Culture Zone.',
      },
      url: 'https://kafej.pl/',
    },
    {
      id: 'falla', lat: 50.25490, lon: 19.02128, address: 'ul. Plebiscytowa 10', price: '€', tag: { pl: 'polecane lokalnie', en: 'local favourite' },
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

  sources: [
    { name: 'Transport GZM (ZTM)', url: 'https://www.metropoliaztm.pl/en/s/' },
    { name: 'MICHELIN Guide — Katowice', url: 'https://guide.michelin.com/at/en/silesia/katowice_2377909/restaurants' },
    { name: 'katowice.eu', url: 'https://www.katowice.eu/en/' },
  ],
};
