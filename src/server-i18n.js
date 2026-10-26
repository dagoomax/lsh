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
    'Pairing': 'Parowanie', 'Pairing time left': 'Pozostały czas parowania', 'Devices': 'Urządzenia', 'Channel': 'Kanał', 'Firmware': 'Oprogramowanie', 'Last joined': 'Ostatnio dołączone', 'Remove device': 'Usuń urządzenie', 'Devices in the network': 'Urządzenia w sieci', 'Link quality': 'Jakość łącza', 'Presence': 'Obecność', 'Leak': 'Zalanie', 'Carbon monoxide': 'Tlenek węgla', 'Vibration': 'Wibracje', 'Pressure': 'Ciśnienie', 'Soil moisture': 'Wilgotność gleby', 'Formaldehyde': 'Formaldehyd', 'Running': 'Praca', 'Color': 'Kolor',
    'Lock rule': 'Reguła zamka', 'Rule ends': 'Koniec reguły', 'Last access': 'Ostatnie wejście', 'Keep unlocked': 'Trzymaj odblokowane', 'Keep locked': 'Trzymaj zablokowane', 'Unlock for (min)': 'Odblokuj na (min)', 'Set lock rule': 'Ustaw regułę zamka', 'Lockdown': 'Blokada', 'Evacuation': 'Ewakuacja', 'Readers': 'Czytniki', 'Open doors': 'Otwarte drzwi', 'Doors': 'Drzwi', 'Doorbell': 'Dzwonek', 'Signal': 'Sygnał', 'Muted': 'Wyciszony', 'Service': 'Serwis', 'Title': 'Tytuł', 'Album': 'Album', 'Player': 'Odtwarzacz', 'Locate': 'Zlokalizuj',
    'Intrusion alarm': 'Alarm włamaniowy', 'Fire': 'Pożar', 'Water leak': 'Zalanie', 'Gas': 'Gaz', 'Panic': 'Napad', 'Mains power lost': 'Brak zasilania', 'Online': 'Połączony', 'Last event': 'Ostatnie zdarzenie', 'Armed': 'Uzbrojony',
    'Unlatch': 'Otwórz zatrzask', 'Ring to Open': 'Ring to Open', 'Battery low': 'Słaba bateria', 'Keypad battery low': 'Słaba bateria klawiatury', 'Lock codes': 'Kody na zamku', 'Door': 'Drzwi',
    'Guest access active': 'Dostęp gościa aktywny', 'Door PIN': 'PIN do drzwi', 'Guest portal opened': 'Portal gościa otwarty',
    'Occupied': 'Zajęte', 'Guest arriving soon': 'Gość wkrótce przyjeżdża', 'Check-in today': 'Zameldowanie dziś', 'Check-out today': 'Wymeldowanie dziś', 'Turnover day': 'Dzień zmiany gości', 'Guest': 'Gość', 'Next guest': 'Następny gość', 'Next check-in': 'Następne zameldowanie', 'Next check-out': 'Następne wymeldowanie', 'Days to next guest': 'Dni do następnego gościa', 'Booked nights (30 d)': 'Zarezerwowane noce (30 dni)', 'Occupancy (30 d)': 'Obłożenie (30 dni)',
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
    'Pairing': 'Anlernen', 'Pairing time left': 'Restzeit Anlernen', 'Devices': 'Geräte', 'Channel': 'Kanal', 'Firmware': 'Firmware', 'Last joined': 'Zuletzt beigetreten', 'Remove device': 'Gerät entfernen', 'Devices in the network': 'Geräte im Netz', 'Link quality': 'Verbindungsqualität', 'Presence': 'Anwesenheit', 'Leak': 'Leck', 'Carbon monoxide': 'Kohlenmonoxid', 'Vibration': 'Vibration', 'Pressure': 'Luftdruck', 'Soil moisture': 'Bodenfeuchte', 'Formaldehyde': 'Formaldehyd', 'Running': 'Betrieb', 'Color': 'Farbe',
    'Lock rule': 'Schlossregel', 'Rule ends': 'Regel endet', 'Last access': 'Letzter Zutritt', 'Keep unlocked': 'Dauerhaft entriegelt', 'Keep locked': 'Dauerhaft verriegelt', 'Unlock for (min)': 'Entriegeln für (min)', 'Set lock rule': 'Schlossregel setzen', 'Lockdown': 'Lockdown', 'Evacuation': 'Evakuierung', 'Readers': 'Leser', 'Open doors': 'Offene Türen', 'Doors': 'Türen', 'Doorbell': 'Klingel', 'Signal': 'Signal', 'Muted': 'Stumm', 'Service': 'Dienst', 'Title': 'Titel', 'Album': 'Album', 'Player': 'Player', 'Locate': 'Orten',
    'Intrusion alarm': 'Einbruchalarm', 'Fire': 'Feuer', 'Water leak': 'Wasserleck', 'Gas': 'Gas', 'Panic': 'Panik', 'Mains power lost': 'Netzausfall', 'Online': 'Online', 'Last event': 'Letztes Ereignis',
    'Unlatch': 'Falle öffnen', 'Battery low': 'Batterie schwach', 'Keypad battery low': 'Keypad-Batterie schwach', 'Lock codes': 'Schloss-Codes',
    'Guest access active': 'Gastzugang aktiv', 'Door PIN': 'Tür-PIN', 'Guest portal opened': 'Gastportal geöffnet',
    'Occupied': 'Belegt', 'Guest arriving soon': 'Gast kommt bald', 'Check-in today': 'Check-in heute', 'Check-out today': 'Check-out heute', 'Turnover day': 'Gästewechsel', 'Guest': 'Gast', 'Next guest': 'Nächster Gast', 'Next check-in': 'Nächster Check-in', 'Next check-out': 'Nächster Check-out', 'Days to next guest': 'Tage bis zum nächsten Gast', 'Booked nights (30 d)': 'Gebuchte Nächte (30 T.)', 'Occupancy (30 d)': 'Belegung (30 T.)',
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
    'Pairing': 'Appairage', 'Pairing time left': 'Temps d’appairage restant', 'Devices': 'Appareils', 'Channel': 'Canal', 'Firmware': 'Micrologiciel', 'Last joined': 'Dernier ajouté', 'Remove device': 'Retirer l’appareil', 'Devices in the network': 'Appareils du réseau', 'Link quality': 'Qualité du lien', 'Presence': 'Présence', 'Leak': 'Fuite', 'Carbon monoxide': 'Monoxyde de carbone', 'Vibration': 'Vibration', 'Pressure': 'Pression', 'Soil moisture': 'Humidité du sol', 'Formaldehyde': 'Formaldéhyde', 'Running': 'Fonctionnement', 'Color': 'Couleur',
    'Lock rule': 'Règle de serrure', 'Rule ends': 'Fin de la règle', 'Last access': 'Dernier accès', 'Keep unlocked': 'Garder déverrouillé', 'Keep locked': 'Garder verrouillé', 'Unlock for (min)': 'Déverrouiller (min)', 'Set lock rule': 'Définir la règle', 'Lockdown': 'Confinement', 'Evacuation': 'Évacuation', 'Readers': 'Lecteurs', 'Open doors': 'Portes ouvertes', 'Doors': 'Portes', 'Doorbell': 'Sonnette', 'Signal': 'Signal', 'Muted': 'Muet', 'Service': 'Service', 'Title': 'Titre', 'Album': 'Album', 'Player': 'Lecteur', 'Locate': 'Localiser',
    'Intrusion alarm': 'Alarme intrusion', 'Fire': 'Incendie', 'Water leak': 'Fuite d’eau', 'Gas': 'Gaz', 'Panic': 'Panique', 'Mains power lost': 'Coupure secteur', 'Online': 'En ligne', 'Last event': 'Dernier événement',
    'Unlatch': 'Ouvrir le pêne', 'Battery low': 'Batterie faible', 'Keypad battery low': 'Batterie du clavier faible', 'Lock codes': 'Codes de la serrure',
    'Guest access active': 'Accès voyageur actif', 'Door PIN': 'Code de la porte', 'Guest portal opened': 'Portail voyageur ouvert',
    'Occupied': 'Occupé', 'Guest arriving soon': 'Voyageur bientôt là', 'Check-in today': 'Arrivée aujourd’hui', 'Check-out today': 'Départ aujourd’hui', 'Turnover day': 'Jour de rotation', 'Guest': 'Voyageur', 'Next guest': 'Prochain voyageur', 'Next check-in': 'Prochaine arrivée', 'Next check-out': 'Prochain départ', 'Days to next guest': 'Jours avant le prochain voyageur', 'Booked nights (30 d)': 'Nuits réservées (30 j)', 'Occupancy (30 d)': 'Occupation (30 j)',
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
    'Pairing': 'Emparejamiento', 'Pairing time left': 'Tiempo de emparejamiento restante', 'Devices': 'Dispositivos', 'Channel': 'Canal', 'Firmware': 'Firmware', 'Last joined': 'Último unido', 'Remove device': 'Quitar dispositivo', 'Devices in the network': 'Dispositivos en la red', 'Link quality': 'Calidad del enlace', 'Presence': 'Presencia', 'Leak': 'Fuga', 'Carbon monoxide': 'Monóxido de carbono', 'Vibration': 'Vibración', 'Pressure': 'Presión', 'Soil moisture': 'Humedad del suelo', 'Formaldehyde': 'Formaldehído', 'Running': 'Funcionamiento', 'Color': 'Color',
    'Lock rule': 'Regla de cerradura', 'Rule ends': 'Fin de la regla', 'Last access': 'Último acceso', 'Keep unlocked': 'Mantener desbloqueada', 'Keep locked': 'Mantener bloqueada', 'Unlock for (min)': 'Desbloquear (min)', 'Set lock rule': 'Fijar regla', 'Lockdown': 'Bloqueo total', 'Evacuation': 'Evacuación', 'Readers': 'Lectores', 'Open doors': 'Puertas abiertas', 'Doors': 'Puertas', 'Doorbell': 'Timbre', 'Signal': 'Señal', 'Muted': 'Silenciado', 'Service': 'Servicio', 'Title': 'Título', 'Album': 'Álbum', 'Player': 'Reproductor', 'Locate': 'Localizar',
    'Intrusion alarm': 'Alarma de intrusión', 'Fire': 'Incendio', 'Water leak': 'Fuga de agua', 'Gas': 'Gas', 'Panic': 'Pánico', 'Mains power lost': 'Sin red eléctrica', 'Online': 'En línea', 'Last event': 'Último evento',
    'Unlatch': 'Abrir pestillo', 'Battery low': 'Batería baja', 'Keypad battery low': 'Batería del teclado baja', 'Lock codes': 'Códigos de la cerradura',
    'Guest access active': 'Acceso de huésped activo', 'Door PIN': 'PIN de la puerta', 'Guest portal opened': 'Portal de huésped abierto',
    'Occupied': 'Ocupado', 'Guest arriving soon': 'Huésped llega pronto', 'Check-in today': 'Entrada hoy', 'Check-out today': 'Salida hoy', 'Turnover day': 'Día de cambio', 'Guest': 'Huésped', 'Next guest': 'Próximo huésped', 'Next check-in': 'Próxima entrada', 'Next check-out': 'Próxima salida', 'Days to next guest': 'Días hasta el próximo huésped', 'Booked nights (30 d)': 'Noches reservadas (30 d)', 'Occupancy (30 d)': 'Ocupación (30 d)',
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
    'Pairing': 'Associazione', 'Pairing time left': 'Tempo di associazione rimasto', 'Devices': 'Dispositivi', 'Channel': 'Canale', 'Firmware': 'Firmware', 'Last joined': 'Ultimo aggiunto', 'Remove device': 'Rimuovi dispositivo', 'Devices in the network': 'Dispositivi nella rete', 'Link quality': 'Qualità del collegamento', 'Presence': 'Presenza', 'Leak': 'Perdita', 'Carbon monoxide': 'Monossido di carbonio', 'Vibration': 'Vibrazione', 'Pressure': 'Pressione', 'Soil moisture': 'Umidità del terreno', 'Formaldehyde': 'Formaldeide', 'Running': 'Funzionamento', 'Color': 'Colore',
    'Lock rule': 'Regola serratura', 'Rule ends': 'Fine regola', 'Last access': 'Ultimo accesso', 'Keep unlocked': 'Tieni sbloccata', 'Keep locked': 'Tieni bloccata', 'Unlock for (min)': 'Sblocca per (min)', 'Set lock rule': 'Imposta regola', 'Lockdown': 'Lockdown', 'Evacuation': 'Evacuazione', 'Readers': 'Lettori', 'Open doors': 'Porte aperte', 'Doors': 'Porte', 'Doorbell': 'Campanello', 'Signal': 'Segnale', 'Muted': 'Muto', 'Service': 'Servizio', 'Title': 'Titolo', 'Album': 'Album', 'Player': 'Lettore', 'Locate': 'Localizza',
    'Intrusion alarm': 'Allarme intrusione', 'Fire': 'Incendio', 'Water leak': 'Perdita d’acqua', 'Gas': 'Gas', 'Panic': 'Panico', 'Mains power lost': 'Mancanza rete', 'Online': 'Online', 'Last event': 'Ultimo evento',
    'Unlatch': 'Apri scrocco', 'Battery low': 'Batteria scarica', 'Keypad battery low': 'Batteria tastierino scarica', 'Lock codes': 'Codici della serratura',
    'Guest access active': 'Accesso ospite attivo', 'Door PIN': 'PIN della porta', 'Guest portal opened': 'Portale ospite aperto',
    'Occupied': 'Occupato', 'Guest arriving soon': 'Ospite in arrivo', 'Check-in today': 'Check-in oggi', 'Check-out today': 'Check-out oggi', 'Turnover day': 'Giorno di cambio', 'Guest': 'Ospite', 'Next guest': 'Prossimo ospite', 'Next check-in': 'Prossimo check-in', 'Next check-out': 'Prossimo check-out', 'Days to next guest': 'Giorni al prossimo ospite', 'Booked nights (30 d)': 'Notti prenotate (30 g)', 'Occupancy (30 d)': 'Occupazione (30 g)',
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
    'Pairing': 'Спарювання', 'Pairing time left': 'Залишок часу спарювання', 'Devices': 'Пристрої', 'Channel': 'Канал', 'Firmware': 'Прошивка', 'Last joined': 'Останній доданий', 'Remove device': 'Видалити пристрій', 'Devices in the network': 'Пристрої в мережі', 'Link quality': 'Якість зв’язку', 'Presence': 'Присутність', 'Leak': 'Протікання', 'Carbon monoxide': 'Чадний газ', 'Vibration': 'Вібрація', 'Pressure': 'Тиск', 'Soil moisture': 'Вологість ґрунту', 'Formaldehyde': 'Формальдегід', 'Running': 'Робота', 'Color': 'Колір',
    'Lock rule': 'Правило замка', 'Rule ends': 'Кінець правила', 'Last access': 'Останній вхід', 'Keep unlocked': 'Тримати відімкненими', 'Keep locked': 'Тримати замкненими', 'Unlock for (min)': 'Відімкнути на (хв)', 'Set lock rule': 'Задати правило', 'Lockdown': 'Блокування', 'Evacuation': 'Евакуація', 'Readers': 'Зчитувачі', 'Open doors': 'Відчинені двері', 'Doors': 'Двері', 'Doorbell': 'Дзвінок', 'Signal': 'Сигнал', 'Muted': 'Без звуку', 'Service': 'Сервіс', 'Title': 'Назва', 'Album': 'Альбом', 'Player': 'Плеєр', 'Locate': 'Знайти',
    'Intrusion alarm': 'Тривога проникнення', 'Fire': 'Пожежа', 'Water leak': 'Протікання', 'Gas': 'Газ', 'Panic': 'Паніка', 'Mains power lost': 'Немає живлення', 'Online': 'Онлайн', 'Last event': 'Остання подія',
    'Unlatch': 'Відкрити засувку', 'Battery low': 'Низький заряд', 'Keypad battery low': 'Низький заряд клавіатури', 'Lock codes': 'Коди замка',
    'Guest access active': 'Доступ гостя активний', 'Door PIN': 'PIN дверей', 'Guest portal opened': 'Портал гостя відкрито',
    'Occupied': 'Зайнято', 'Guest arriving soon': 'Гість скоро приїде', 'Check-in today': 'Заїзд сьогодні', 'Check-out today': 'Виїзд сьогодні', 'Turnover day': 'День зміни гостей', 'Guest': 'Гість', 'Next guest': 'Наступний гість', 'Next check-in': 'Наступний заїзд', 'Next check-out': 'Наступний виїзд', 'Days to next guest': 'Днів до наступного гостя', 'Booked nights (30 d)': 'Заброньовані ночі (30 дн.)', 'Occupancy (30 d)': 'Заповненість (30 дн.)',
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
