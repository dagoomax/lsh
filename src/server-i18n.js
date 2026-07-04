'use strict';

/**
 * Server-side translation of device and sensor labels.
 *
 * Applied once, centrally, in the sensor registry — so every consumer gets
 * translated names: REST API, Socket.IO, both dashboards, HomeKit (Siri!),
 * Loxone XML templates, Node-RED. Selected via `language` in config.json
 * ("en" or unset = pass-through). Unknown terms fall back to English.
 */

const DICT = {
  pl: {
    'Temperature': 'Temperatura', 'Temperature Sensor': 'Czujnik temperatury', 'State': 'Stan',
    'Power': 'Moc', 'Humidity': 'Wilgotność', 'Battery': 'Bateria', 'Battery Level': 'Poziom baterii',
    'Mode': 'Tryb', 'Alarm': 'Alarm', 'Fire Alarm': 'Alarm pożarowy', 'High Temp Alarm': 'Alarm wysokiej temp.',
    'Switch': 'Przełącznik', 'Motion': 'Ruch', 'Contact': 'Kontaktron', 'Volume': 'Głośność',
    'Target Temp': 'Temp. zadana', 'Set Temp': 'Temp. zadana', 'Set Temperature': 'Temp. zadana',
    'Setpoint': 'Wartość zadana', 'Smoke': 'Dym', 'Position': 'Pozycja', 'Mute': 'Wyciszenie',
    'Level': 'Poziom', 'Illuminance': 'Natężenie światła', 'Fan': 'Wentylator',
    'DC Voltage': 'Napięcie DC', 'DC Current': 'Prąd DC', 'Water': 'Woda', 'Water Sensor': 'Czujnik wody',
    'Voltage': 'Napięcie', 'Status': 'Status', 'Saturation': 'Nasycenie', 'Salt': 'Sól',
    'Pulse Count': 'Licznik impulsów', 'Pulse Meter': 'Licznik impulsów', 'Lock': 'Zamek',
    'Light': 'Światło', 'Hue': 'Odcień', 'Error Code': 'Kod błędu', 'Current': 'Prąd',
    'Color Temp': 'Temp. barwowa', 'Cleaning': 'Sprzątanie', 'Capacity': 'Pojemność',
    'Brightness': 'Jasność', 'Armed': 'Uzbrojenie', 'Yield Today': 'Uzysk dzisiaj',
    'Violation': 'Naruszenie', 'Value': 'Wartość', 'Up': 'Góra', 'Down': 'Dół', 'Track': 'Utwór',
    'Total Yield': 'Uzysk całkowity', 'Total Runtime': 'Czas pracy', 'Time to Go': 'Pozostały czas',
    'Thermostat Mode': 'Tryb termostatu', 'Text': 'Tekst', 'Tank': 'Zbiornik', 'Tamper': 'Sabotaż',
    'Stop': 'Stop', 'State of Charge': 'Poziom naładowania', 'Remaining': 'Pozostało',
    'Remaining (min)': 'Pozostało (min)', 'Room': 'Pomieszczenie', 'Satellites': 'Satelity',
    'Sensor Type': 'Typ czujnika', 'Shade': 'Roleta', 'Snapshot URL': 'URL zrzutu',
    'Solar Charger': 'Ładowarka solarna', 'Sound Detection': 'Detekcja dźwięku', 'Source': 'Źródło',
    'Speed': 'Prędkość', 'PV Power': 'Moc PV', 'PV Current': 'Prąd PV', 'PV Voltage': 'Napięcie PV',
    'pH Dosing': 'Dozowanie pH', 'Chlorine Dosing': 'Dozowanie chloru', 'Production': 'Produkcja',
    'Heater': 'Grzałka', 'Heat Mode': 'Tryb grzania', 'Online': 'Online', 'Jet Pump': 'Pompa dysz',
    'Playing': 'Odtwarzanie', 'Artist': 'Wykonawca', 'Input': 'Wejście', 'Door': 'Drzwi',
    'Window': 'Okno', 'Open': 'Otwarte', 'Closed': 'Zamknięte', 'Energy': 'Energia',
    'Grid': 'Sieć', 'Consumption': 'Zużycie', 'Dimmer': 'Ściemniacz', 'Pump': 'Pompa',
  },
  de: {
    'Temperature': 'Temperatur', 'State': 'Zustand', 'Power': 'Leistung', 'Humidity': 'Luftfeuchte',
    'Battery': 'Batterie', 'Mode': 'Modus', 'Alarm': 'Alarm', 'Fire Alarm': 'Feueralarm',
    'Switch': 'Schalter', 'Motion': 'Bewegung', 'Contact': 'Kontakt', 'Volume': 'Lautstärke',
    'Target Temp': 'Solltemperatur', 'Set Temp': 'Solltemperatur', 'Smoke': 'Rauch',
    'Position': 'Position', 'Mute': 'Stumm', 'Level': 'Stufe', 'Fan': 'Lüfter', 'Water': 'Wasser',
    'Voltage': 'Spannung', 'Current': 'Strom', 'Status': 'Status', 'Salt': 'Salz', 'Lock': 'Schloss',
    'Light': 'Licht', 'Brightness': 'Helligkeit', 'Armed': 'Scharf', 'Violation': 'Auslösung',
    'Tamper': 'Sabotage', 'Door': 'Tür', 'Window': 'Fenster', 'Heater': 'Heizung', 'Track': 'Titel',
    'Artist': 'Künstler', 'Input': 'Eingang', 'Room': 'Raum', 'State of Charge': 'Ladezustand',
    'Time to Go': 'Restzeit', 'Cleaning': 'Reinigung', 'Illuminance': 'Beleuchtungsstärke',
    'pH Dosing': 'pH-Dosierung', 'Chlorine Dosing': 'Chlor-Dosierung', 'Heat Mode': 'Heizmodus',
  },
  fr: {
    'Temperature': 'Température', 'State': 'État', 'Power': 'Puissance', 'Humidity': 'Humidité',
    'Battery': 'Batterie', 'Mode': 'Mode', 'Alarm': 'Alarme', 'Fire Alarm': 'Alarme incendie',
    'Switch': 'Interrupteur', 'Motion': 'Mouvement', 'Contact': 'Contact', 'Volume': 'Volume',
    'Target Temp': 'Temp. consigne', 'Set Temp': 'Temp. consigne', 'Smoke': 'Fumée',
    'Position': 'Position', 'Mute': 'Muet', 'Level': 'Niveau', 'Fan': 'Ventilateur', 'Water': 'Eau',
    'Voltage': 'Tension', 'Current': 'Courant', 'Status': 'Statut', 'Salt': 'Sel', 'Lock': 'Serrure',
    'Light': 'Lumière', 'Brightness': 'Luminosité', 'Armed': 'Armé', 'Violation': 'Déclenchement',
    'Tamper': 'Sabotage', 'Door': 'Porte', 'Window': 'Fenêtre', 'Heater': 'Chauffage', 'Track': 'Piste',
    'Artist': 'Artiste', 'Input': 'Entrée', 'Room': 'Pièce', 'State of Charge': 'Niveau de charge',
    'Time to Go': 'Temps restant', 'Cleaning': 'Nettoyage', 'pH Dosing': 'Dosage pH',
    'Chlorine Dosing': 'Dosage chlore', 'Heat Mode': 'Mode chauffage',
  },
  es: {
    'Temperature': 'Temperatura', 'State': 'Estado', 'Power': 'Potencia', 'Humidity': 'Humedad',
    'Battery': 'Batería', 'Mode': 'Modo', 'Alarm': 'Alarma', 'Fire Alarm': 'Alarma de incendio',
    'Switch': 'Interruptor', 'Motion': 'Movimiento', 'Contact': 'Contacto', 'Volume': 'Volumen',
    'Target Temp': 'Temp. objetivo', 'Set Temp': 'Temp. objetivo', 'Smoke': 'Humo',
    'Position': 'Posición', 'Mute': 'Silencio', 'Level': 'Nivel', 'Fan': 'Ventilador', 'Water': 'Agua',
    'Voltage': 'Voltaje', 'Current': 'Corriente', 'Status': 'Estado', 'Salt': 'Sal', 'Lock': 'Cerradura',
    'Light': 'Luz', 'Brightness': 'Brillo', 'Armed': 'Armado', 'Violation': 'Violación',
    'Tamper': 'Sabotaje', 'Door': 'Puerta', 'Window': 'Ventana', 'Heater': 'Calentador', 'Track': 'Pista',
    'Artist': 'Artista', 'Input': 'Entrada', 'Room': 'Habitación', 'State of Charge': 'Nivel de carga',
    'Time to Go': 'Tiempo restante', 'Cleaning': 'Limpieza', 'pH Dosing': 'Dosificación pH',
    'Chlorine Dosing': 'Dosificación cloro', 'Heat Mode': 'Modo calefacción',
  },
  it: {
    'Temperature': 'Temperatura', 'State': 'Stato', 'Power': 'Potenza', 'Humidity': 'Umidità',
    'Battery': 'Batteria', 'Mode': 'Modalità', 'Alarm': 'Allarme', 'Fire Alarm': 'Allarme incendio',
    'Switch': 'Interruttore', 'Motion': 'Movimento', 'Contact': 'Contatto', 'Volume': 'Volume',
    'Target Temp': 'Temp. impostata', 'Set Temp': 'Temp. impostata', 'Smoke': 'Fumo',
    'Position': 'Posizione', 'Mute': 'Muto', 'Level': 'Livello', 'Fan': 'Ventola', 'Water': 'Acqua',
    'Voltage': 'Tensione', 'Current': 'Corrente', 'Status': 'Stato', 'Salt': 'Sale', 'Lock': 'Serratura',
    'Light': 'Luce', 'Brightness': 'Luminosità', 'Armed': 'Armato', 'Violation': 'Violazione',
    'Tamper': 'Sabotaggio', 'Door': 'Porta', 'Window': 'Finestra', 'Heater': 'Riscaldatore',
    'Track': 'Traccia', 'Artist': 'Artista', 'Input': 'Ingresso', 'Room': 'Stanza',
    'State of Charge': 'Livello di carica', 'Time to Go': 'Tempo rimanente', 'Cleaning': 'Pulizia',
    'pH Dosing': 'Dosaggio pH', 'Chlorine Dosing': 'Dosaggio cloro', 'Heat Mode': 'Modo riscaldamento',
  },
  ua: {
    'Temperature': 'Температура', 'State': 'Стан', 'Power': 'Потужність', 'Humidity': 'Вологість',
    'Battery': 'Батарея', 'Mode': 'Режим', 'Alarm': 'Тривога', 'Fire Alarm': 'Пожежна тривога',
    'Switch': 'Вимикач', 'Motion': 'Рух', 'Contact': 'Контакт', 'Volume': 'Гучність',
    'Target Temp': 'Задана темп.', 'Set Temp': 'Задана темп.', 'Smoke': 'Дим',
    'Position': 'Позиція', 'Mute': 'Без звуку', 'Level': 'Рівень', 'Fan': 'Вентилятор', 'Water': 'Вода',
    'Voltage': 'Напруга', 'Current': 'Струм', 'Status': 'Статус', 'Salt': 'Сіль', 'Lock': 'Замок',
    'Light': 'Світло', 'Brightness': 'Яскравість', 'Armed': 'Озброєно', 'Violation': 'Порушення',
    'Tamper': 'Саботаж', 'Door': 'Двері', 'Window': 'Вікно', 'Heater': 'Нагрівач', 'Track': 'Трек',
    'Artist': 'Виконавець', 'Input': 'Вхід', 'Room': 'Кімната', 'State of Charge': 'Рівень заряду',
    'Time to Go': 'Залишилось часу', 'Cleaning': 'Прибирання', 'pH Dosing': 'Дозування pH',
    'Chlorine Dosing': 'Дозування хлору', 'Heat Mode': 'Режим нагріву',
  },
};

// Fallback labels like "Zone 33" that carry a number
const PATTERNS = [
  [/^Zone (\d+)$/,      { pl: 'Wejście $1',     de: 'Zone $1',      fr: 'Zone $1',    es: 'Zona $1',    it: 'Zona $1',    ua: 'Зона $1' }],
  [/^Partition (\d+)$/, { pl: 'Strefa $1',      de: 'Bereich $1',   fr: 'Partition $1', es: 'Partición $1', it: 'Partizione $1', ua: 'Розділ $1' }],
  [/^Output (\d+)$/,    { pl: 'Wyjście $1',     de: 'Ausgang $1',   fr: 'Sortie $1',  es: 'Salida $1',  it: 'Uscita $1',  ua: 'Вихід $1' }],
  [/^Relay (\d+)$/,     { pl: 'Przekaźnik $1',  de: 'Relais $1',    fr: 'Relais $1',  es: 'Relé $1',    it: 'Relè $1',    ua: 'Реле $1' }],
  [/^Pool (\d+)$/,      { pl: 'Basen $1',       de: 'Pool $1',      fr: 'Piscine $1', es: 'Piscina $1', it: 'Piscina $1', ua: 'Басейн $1' }],
  [/^Light (\d+|\w+)$/, { pl: 'Światło $1',     de: 'Licht $1',     fr: 'Lumière $1', es: 'Luz $1',     it: 'Luce $1',    ua: 'Світло $1' }],
];

function translate(str, lang) {
  if (!str || !lang || lang === 'en') return str;
  const dict = DICT[lang];
  if (!dict) return str;
  if (dict[str]) return dict[str];
  for (const [re, repl] of PATTERNS) {
    const m = re.exec(str);
    if (m && repl[lang]) return repl[lang].replace('$1', m[1]);
  }
  return str;
}

// Mutates a device descriptor in place: label + sensor labels/names.
function translateDevice(device, lang) {
  if (!lang || lang === 'en' || !DICT[lang]) return device;
  if (device.label) device.label = translate(device.label, lang);
  for (const s of device.sensors || []) {
    if (s.label) s.label = translate(s.label, lang);
    if (s.name)  s.name  = translate(s.name, lang);
  }
  return device;
}

module.exports = { translate, translateDevice, LANGUAGES: Object.keys(DICT) };
