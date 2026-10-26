'use strict';

// Katowice city guide for the dashboard's onboarding card (src/routes/guide.js).
// Checked October 2026:
//   transport   metropoliaztm.pl (Transport GZM: tickets, apps, no tickets from
//               drivers since 1 Jan 2026, contactless cards on board),
//               metropoliagzm.pl (airport line AP), Metrorower
//   restaurants MICHELIN Guide Poland 2026, Katowice: all four listed places
//   places      the city's main sights; coordinates from OpenStreetMap
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
      name: { pl: 'Lotnisko Katowice (Pyrzowice)', en: 'Katowice Airport (Pyrzowice)' },
      text: {
        pl: 'Linia AP jedzie z Katowic Dworca (stanowisko AP) na lotnisko w ok. 45–60 min, co godzinę od rana do wieczora. Wystarczy zwykły bilet ZTM — najbezpieczniej 120-minutowy.',
        en: 'Line AP runs from Katowice Dworzec (the AP stop) to the airport in about 45–60 min, hourly from morning to evening. A regular ZTM ticket is enough; a 120-minute one is safest.',
      },
      url: 'https://metropoliagzm.pl/tag/linie-lotniskowe/',
    },
    {
      id: 'train', icon: 'train', lat: 50.25961, lon: 19.01753,
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

  // MICHELIN Guide Poland 2026 — Katowice (all four listed restaurants)
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
  ],

  places: [
    {
      id: 'strefa', lat: 50.26401, lon: 19.03398, tag: { pl: 'muzeum', en: 'museum' },
      name: { pl: 'Muzeum Śląskie (Strefa Kultury)', en: 'Silesian Museum (Culture Zone)' },
      text: {
        pl: 'Nowoczesne muzeum w dawnej kopalni Katowice, w dużej części pod ziemią: historia Górnego Śląska i polskie malarstwo. Wieża szybowa z punktem widokowym.',
        en: 'A modern museum on the former Katowice coal mine, largely underground: Upper Silesian history and Polish painting. The mine shaft tower has a viewpoint.',
      },
      url: 'https://muzeumslaskie.pl/en/',
    },
    {
      id: 'nospr', lat: 50.2639, lon: 19.02867, tag: { pl: 'koncerty', en: 'concerts' },
      name: { pl: 'NOSPR', en: 'NOSPR concert hall' },
      text: {
        pl: 'Siedziba Narodowej Orkiestry Symfonicznej Polskiego Radia, słynąca z akustyki. Bilety na weekend warto kupić wcześniej.',
        en: 'Home of the Polish National Radio Symphony Orchestra, known for its acoustics. Book weekend concerts ahead.',
      },
      url: 'https://www.nospr.org.pl/en',
    },
    {
      id: 'spodek', lat: 50.26611, lon: 19.02533, tag: { pl: 'architektura', en: 'architecture' },
      name: { pl: 'Spodek i MCK', en: 'Spodek and the ICC' },
      text: {
        pl: 'Ikona miasta z lat 70. — hala w kształcie latającego spodka — obok Międzynarodowego Centrum Kongresowego z zielonym dachem, po którym można spacerować.',
        en: 'The city’s 1970s icon, an arena shaped like a flying saucer, next to the International Congress Centre with a green roof you can walk on.',
      },
      url: 'https://spodekkatowice.pl/',
    },
    {
      id: 'nikiszowiec', lat: 50.24349, lon: 19.08169, tag: { pl: 'zabytek', en: 'heritage' },
      name: { pl: 'Nikiszowiec', en: 'Nikiszowiec' },
      text: {
        pl: 'Osiedle górnicze z początku XX w. z czerwonej cegły — zabytek historii. Obok Galeria Szyb Wilson w dawnej łaźni kopalnianej.',
        en: 'An early-20th-century red-brick miners’ estate, a national heritage site. The Szyb Wilson gallery in a former pithead bath house is next door.',
      },
      url: 'https://www.katowice.eu/en/',
    },
    {
      id: 'mariacka', lat: 50.25739, lon: 19.02711, tag: { pl: 'wieczorem', en: 'evenings' },
      name: { pl: 'Ulica Mariacka i Rynek', en: 'Mariacka Street and the Market Square' },
      text: {
        pl: 'Deptak z kawiarniami i barami, najżywszy wieczorem, kilka minut od Rynku z fontanną i tramwajami.',
        en: 'A pedestrian street of cafés and bars, liveliest in the evening, a few minutes from the Market Square with its fountain and trams.',
      },
    },
    {
      id: 'dolina', lat: 50.24775, lon: 19.04722, tag: { pl: 'natura', en: 'outdoors' },
      name: { pl: 'Dolina Trzech Stawów', en: 'Valley of Three Ponds' },
      text: {
        pl: 'Duży park ze stawami, ścieżkami rowerowymi i rolkowymi, latem miejsce koncertów i festiwali.',
        en: 'A large park with ponds and cycling and skating paths; summer concerts and festivals.',
      },
    },
    {
      id: 'parkslaski', lat: 50.28657, lon: 18.98707, tag: { pl: 'park', en: 'park' },
      name: { pl: 'Park Śląski (Chorzów)', en: 'Silesian Park (Chorzów)' },
      text: {
        pl: 'Jeden z największych parków miejskich w Europie: kolejka linowa Elka, Śląski Ogród Zoologiczny, Planetarium Śląskie i Stadion Śląski. Tramwajem z centrum.',
        en: 'One of Europe’s largest city parks: the Elka cable car, the Silesian Zoo, the Silesian Planetarium and the Silesian Stadium. A tram ride from the centre.',
      },
      url: 'https://parkslaski.pl/',
    },
    {
      id: 'planetarium', lat: 50.29073, lon: 18.993, tag: { pl: 'nauka', en: 'science' },
      name: { pl: 'Planetarium Śląskie', en: 'Silesian Planetarium' },
      text: {
        pl: 'Największe planetarium w Polsce, po modernizacji — seanse pod kopułą i obserwatorium. W Parku Śląskim.',
        en: 'Poland’s largest planetarium, recently modernised: dome shows and an observatory. In Silesian Park.',
      },
      url: 'https://planetarium.edu.pl/',
    },
    {
      id: 'katedra', lat: 50.25161, lon: 19.01911, tag: { pl: 'architektura', en: 'architecture' },
      name: { pl: 'Archikatedra Chrystusa Króla', en: 'Cathedral of Christ the King' },
      text: {
        pl: 'Jedna z największych katedr w Polsce, z monumentalną kopułą, kilka przystanków od centrum.',
        en: 'One of Poland’s largest cathedrals, with a monumental dome, a few stops from the centre.',
      },
    },
    {
      id: 'michal', lat: 50.24096, lon: 19.0048, tag: { pl: 'zabytek', en: 'heritage' },
      name: { pl: 'Drewniany kościół św. Michała', en: 'Wooden Church of St Michael' },
      text: {
        pl: 'XVI-wieczny drewniany kościółek przeniesiony do Parku Kościuszki — dobry cel spaceru po parku.',
        en: 'A 16th-century wooden church moved to Kościuszko Park, a good goal for a walk in the park.',
      },
    },
    {
      id: 'giszowiec', lat: 50.22167, lon: 19.06547, tag: { pl: 'zabytek', en: 'heritage' },
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
