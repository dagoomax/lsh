// OpenWeatherMap condition descriptions → the dashboard's selected language.
// The server stores OpenWeather's English text (one fetch serves every
// viewer); each browser translates it into its own language here. Keyed by
// the exact English description for every OpenWeather condition code
// (https://openweathermap.org/weather-conditions). Unknown text — or text
// already localised via config.openweather.lang — passes through unchanged.
import { getLang } from './i18n'

// [en, pl, de, fr, es, it, uk]
const ROWS = [
  ['thunderstorm with light rain', 'burza z lekkim deszczem', 'Gewitter mit leichtem Regen', 'orage avec pluie légère', 'tormenta con lluvia ligera', 'temporale con pioggia leggera', 'гроза з легким дощем'],
  ['thunderstorm with rain', 'burza z deszczem', 'Gewitter mit Regen', 'orage avec pluie', 'tormenta con lluvia', 'temporale con pioggia', 'гроза з дощем'],
  ['thunderstorm with heavy rain', 'burza z ulewą', 'Gewitter mit Starkregen', 'orage avec forte pluie', 'tormenta con lluvia intensa', 'temporale con pioggia forte', 'гроза зі зливою'],
  ['light thunderstorm', 'lekka burza', 'leichtes Gewitter', 'orage léger', 'tormenta ligera', 'temporale leggero', 'слабка гроза'],
  ['thunderstorm', 'burza', 'Gewitter', 'orage', 'tormenta', 'temporale', 'гроза'],
  ['heavy thunderstorm', 'silna burza', 'schweres Gewitter', 'violent orage', 'tormenta fuerte', 'temporale forte', 'сильна гроза'],
  ['ragged thunderstorm', 'przelotna burza', 'vereinzelte Gewitter', 'orages épars', 'tormentas dispersas', 'temporali sparsi', 'місцями грози'],
  ['thunderstorm with light drizzle', 'burza z lekką mżawką', 'Gewitter mit leichtem Nieselregen', 'orage avec bruine légère', 'tormenta con llovizna ligera', 'temporale con pioggerella leggera', 'гроза з легкою мрякою'],
  ['thunderstorm with drizzle', 'burza z mżawką', 'Gewitter mit Nieselregen', 'orage avec bruine', 'tormenta con llovizna', 'temporale con pioggerella', 'гроза з мрякою'],
  ['thunderstorm with heavy drizzle', 'burza z silną mżawką', 'Gewitter mit starkem Nieselregen', 'orage avec forte bruine', 'tormenta con llovizna intensa', 'temporale con pioggerella forte', 'гроза з сильною мрякою'],
  ['light intensity drizzle', 'lekka mżawka', 'leichter Nieselregen', 'bruine légère', 'llovizna ligera', 'pioggerella leggera', 'легка мряка'],
  ['drizzle', 'mżawka', 'Nieselregen', 'bruine', 'llovizna', 'pioggerella', 'мряка'],
  ['heavy intensity drizzle', 'silna mżawka', 'starker Nieselregen', 'forte bruine', 'llovizna intensa', 'pioggerella intensa', 'сильна мряка'],
  ['light intensity drizzle rain', 'lekka mżawka z deszczem', 'leichter Nieselregen', 'bruine et pluie légères', 'llovizna y lluvia ligera', 'pioggerella e pioggia leggera', 'легка мряка з дощем'],
  ['drizzle rain', 'mżawka z deszczem', 'Nieselregen', 'bruine et pluie', 'llovizna y lluvia', 'pioggerella e pioggia', 'мряка з дощем'],
  ['heavy intensity drizzle rain', 'silna mżawka z deszczem', 'starker Nieselregen', 'forte bruine et pluie', 'llovizna y lluvia intensa', 'pioggerella e pioggia intensa', 'сильна мряка з дощем'],
  ['shower rain and drizzle', 'przelotny deszcz z mżawką', 'Regenschauer und Nieselregen', 'averses et bruine', 'chubascos y llovizna', 'rovesci e pioggerella', 'злива з мрякою'],
  ['heavy shower rain and drizzle', 'silny przelotny deszcz z mżawką', 'starke Regenschauer und Nieselregen', 'fortes averses et bruine', 'chubascos fuertes y llovizna', 'forti rovesci e pioggerella', 'сильна злива з мрякою'],
  ['shower drizzle', 'przelotna mżawka', 'Nieselschauer', 'averses de bruine', 'chubascos de llovizna', 'rovesci di pioggerella', 'короткочасна мряка'],
  ['light rain', 'lekki deszcz', 'leichter Regen', 'pluie légère', 'lluvia ligera', 'pioggia leggera', 'легкий дощ'],
  ['moderate rain', 'umiarkowany deszcz', 'mäßiger Regen', 'pluie modérée', 'lluvia moderada', 'pioggia moderata', 'помірний дощ'],
  ['heavy intensity rain', 'intensywny deszcz', 'starker Regen', 'forte pluie', 'lluvia intensa', 'pioggia intensa', 'сильний дощ'],
  ['very heavy rain', 'bardzo silny deszcz', 'sehr starker Regen', 'très forte pluie', 'lluvia muy intensa', 'pioggia molto forte', 'дуже сильний дощ'],
  ['extreme rain', 'ulewa', 'extremer Regen', 'pluie extrême', 'lluvia extrema', 'pioggia estrema', 'надзвичайно сильний дощ'],
  ['freezing rain', 'marznący deszcz', 'gefrierender Regen', 'pluie verglaçante', 'lluvia helada', 'pioggia gelata', 'крижаний дощ'],
  ['light intensity shower rain', 'lekki przelotny deszcz', 'leichte Regenschauer', 'averses légères', 'chubascos ligeros', 'rovesci leggeri', 'легка злива'],
  ['shower rain', 'przelotny deszcz', 'Regenschauer', 'averses', 'chubascos', 'rovesci', 'злива'],
  ['heavy intensity shower rain', 'silny przelotny deszcz', 'starke Regenschauer', 'fortes averses', 'chubascos fuertes', 'forti rovesci', 'сильна злива'],
  ['ragged shower rain', 'przelotne opady deszczu', 'vereinzelte Regenschauer', 'averses éparses', 'chubascos dispersos', 'rovesci sparsi', 'місцями зливи'],
  ['light snow', 'lekki śnieg', 'leichter Schneefall', 'neige légère', 'nevada ligera', 'neve leggera', 'невеликий сніг'],
  ['snow', 'śnieg', 'Schnee', 'neige', 'nieve', 'neve', 'сніг'],
  ['heavy snow', 'intensywne opady śniegu', 'starker Schneefall', 'fortes chutes de neige', 'nevada intensa', 'neve abbondante', 'сильний сніг'],
  ['sleet', 'deszcz ze śniegiem', 'Schneeregen', 'neige fondue', 'aguanieve', 'nevischio', 'мокрий сніг'],
  ['light shower sleet', 'lekki przelotny deszcz ze śniegiem', 'leichte Schneeregenschauer', 'légères averses de neige fondue', 'chubascos ligeros de aguanieve', 'rovesci leggeri di nevischio', 'легкий мокрий сніг'],
  ['shower sleet', 'przelotny deszcz ze śniegiem', 'Schneeregenschauer', 'averses de neige fondue', 'chubascos de aguanieve', 'rovesci di nevischio', 'короткочасний мокрий сніг'],
  ['light rain and snow', 'lekki deszcz ze śniegiem', 'leichter Regen und Schnee', 'pluie et neige légères', 'lluvia y nieve ligeras', 'pioggia e neve leggere', 'легкий дощ зі снігом'],
  ['rain and snow', 'deszcz ze śniegiem', 'Regen und Schnee', 'pluie et neige', 'lluvia y nieve', 'pioggia e neve', 'дощ зі снігом'],
  ['light shower snow', 'lekki przelotny śnieg', 'leichte Schneeschauer', 'légères averses de neige', 'chubascos ligeros de nieve', 'rovesci leggeri di neve', 'легкий снігопад'],
  ['shower snow', 'przelotny śnieg', 'Schneeschauer', 'averses de neige', 'chubascos de nieve', 'rovesci di neve', 'снігопад'],
  ['heavy shower snow', 'silny przelotny śnieg', 'starke Schneeschauer', 'fortes averses de neige', 'chubascos fuertes de nieve', 'forti rovesci di neve', 'сильний снігопад'],
  ['mist', 'mgiełka', 'Dunst', 'brume', 'neblina', 'foschia', 'серпанок'],
  ['smoke', 'dym', 'Rauch', 'fumée', 'humo', 'fumo', 'дим'],
  ['haze', 'zamglenie', 'Dunst', 'brume sèche', 'calima', 'foschia', 'імла'],
  ['sand/dust whirls', 'wiry piasku i pyłu', 'Sand- und Staubwirbel', 'tourbillons de sable et de poussière', 'remolinos de arena y polvo', 'mulinelli di sabbia e polvere', 'піщані та пилові вихори'],
  ['fog', 'mgła', 'Nebel', 'brouillard', 'niebla', 'nebbia', 'туман'],
  ['sand', 'piasek', 'Sand', 'sable', 'arena', 'sabbia', 'пісок'],
  ['dust', 'pył', 'Staub', 'poussière', 'polvo', 'polvere', 'пил'],
  ['volcanic ash', 'pył wulkaniczny', 'Vulkanasche', 'cendres volcaniques', 'ceniza volcánica', 'cenere vulcanica', 'вулканічний попіл'],
  ['squalls', 'szkwały', 'Sturmböen', 'grains', 'chubascos de viento', 'burrasche', 'шквали'],
  ['tornado', 'tornado', 'Tornado', 'tornade', 'tornado', 'tornado', 'торнадо'],
  ['clear sky', 'bezchmurnie', 'klarer Himmel', 'ciel dégagé', 'cielo despejado', 'cielo sereno', 'ясне небо'],
  ['few clouds', 'niewielkie zachmurzenie', 'ein paar Wolken', 'peu nuageux', 'algunas nubes', 'poche nuvole', 'невелика хмарність'],
  ['scattered clouds', 'rozproszone chmury', 'aufgelockerte Bewölkung', 'nuages épars', 'nubes dispersas', 'nubi sparse', 'розсіяні хмари'],
  ['broken clouds', 'zachmurzenie umiarkowane', 'überwiegend bewölkt', 'nuageux', 'nubes rotas', 'nubi irregolari', 'хмарно з проясненнями'],
  ['overcast clouds', 'zachmurzenie całkowite', 'bedeckt', 'couvert', 'nubes cubiertas', 'cielo coperto', 'суцільна хмарність'],
]

const LANG_COL = { pl: 1, de: 2, fr: 3, es: 4, it: 5, uk: 6 }
const BY_EN = new Map(ROWS.map((r) => [r[0], r]))

export function weatherText(text, lang = getLang()) {
  if (!text || typeof text !== 'string') return text
  const col = LANG_COL[lang]
  if (!col) return text
  return BY_EN.get(text.trim().toLowerCase())?.[col] || text
}
