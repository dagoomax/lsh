// Minimal i18n for the React dashboard — shares the vanilla dashboard's
// language choice (localStorage 'lsh-lang') so both UIs switch together.
const DICT = {
  pl: { tab: 'Wykresy', devices: 'Urządzenia', active: 'Aktywne teraz', series: 'Śledzone serie',
        avg_temp: 'Śr. temperatura', battery: 'Bateria', solar: 'Solar',
        filter_all: 'Wszystkie', filter_temp: 'Temperatura', filter_power: 'Moc i energia',
        filter_humid: 'Wilgotność', filter_other: 'Inne',
        empty: 'Brak czujników liczbowych — historia gromadzi się podczas pracy serwera.',
        collecting: 'Zbieranie danych — sprawdź za kilka minut', showing: 'Pokazano pierwsze 30 z {n} serii — użyj filtrów.' },
  de: { tab: 'Diagramme', devices: 'Geräte', active: 'Aktiv jetzt', series: 'Erfasste Reihen',
        avg_temp: 'Ø Temperatur', battery: 'Batterie', solar: 'Solar',
        filter_all: 'Alle', filter_temp: 'Temperatur', filter_power: 'Leistung & Energie',
        filter_humid: 'Luftfeuchte', filter_other: 'Sonstige',
        empty: 'Noch keine numerischen Sensoren — die Historie baut sich im Betrieb auf.',
        collecting: 'Sammeln — in ein paar Minuten wiederkommen', showing: 'Erste 30 von {n} Reihen — Filter nutzen.' },
  fr: { tab: 'Graphiques', devices: 'Appareils', active: 'Actifs', series: 'Séries suivies',
        avg_temp: 'Temp. moyenne', battery: 'Batterie', solar: 'Solaire',
        filter_all: 'Tous', filter_temp: 'Température', filter_power: 'Puissance & énergie',
        filter_humid: 'Humidité', filter_other: 'Autres',
        empty: 'Aucun capteur numérique — l’historique se construit pendant le fonctionnement.',
        collecting: 'Collecte — revenez dans quelques minutes', showing: '30 premières séries sur {n} — utilisez les filtres.' },
  es: { tab: 'Gráficos', devices: 'Dispositivos', active: 'Activos ahora', series: 'Series registradas',
        avg_temp: 'Temp. media', battery: 'Batería', solar: 'Solar',
        filter_all: 'Todos', filter_temp: 'Temperatura', filter_power: 'Potencia y energía',
        filter_humid: 'Humedad', filter_other: 'Otros',
        empty: 'Sin sensores numéricos aún — el historial se acumula con el servidor en marcha.',
        collecting: 'Recopilando — vuelve en unos minutos', showing: 'Primeras 30 de {n} series — usa los filtros.' },
  it: { tab: 'Grafici', devices: 'Dispositivi', active: 'Attivi ora', series: 'Serie tracciate',
        avg_temp: 'Temp. media', battery: 'Batteria', solar: 'Solare',
        filter_all: 'Tutti', filter_temp: 'Temperatura', filter_power: 'Potenza ed energia',
        filter_humid: 'Umidità', filter_other: 'Altri',
        empty: 'Nessun sensore numerico — lo storico si accumula durante il funzionamento.',
        collecting: 'Raccolta — torna tra qualche minuto', showing: 'Prime 30 di {n} serie — usa i filtri.' },
  uk: { tab: 'Графіки', devices: 'Пристрої', active: 'Активні зараз', series: 'Відстежувані серії',
        avg_temp: 'Сер. температура', battery: 'Батарея', solar: 'Сонячна',
        filter_all: 'Усі', filter_temp: 'Температура', filter_power: 'Потужність та енергія',
        filter_humid: 'Вологість', filter_other: 'Інше',
        empty: 'Немає числових датчиків — історія накопичується під час роботи сервера.',
        collecting: 'Збирання — перевірте за кілька хвилин', showing: 'Перші 30 із {n} серій — скористайтеся фільтрами.' },
}

function lang() {
  try {
    const stored = localStorage.getItem('lsh-lang')
    if (stored) return stored
  } catch { /* ignore */ }
  return (navigator.language || 'en').slice(0, 2).toLowerCase()
}

export function gt(key, fallback, vars) {
  let s = DICT[lang()]?.[key] || fallback
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, v)
  return s
}
