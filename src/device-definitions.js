/**
 * Victron device type definitions.
 * Each entry describes:
 *   - label        Human-readable name
 *   - color        CSS accent colour key
 *   - sensors[]    MQTT sub-paths to track, with display/HomeKit metadata
 *   - homekit[]    Which HomeKit service types to expose for this device
 */

const DEVICE_TYPES = {
  solarcharger: {
    label: 'Solar Charger',
    color: 'solar',
    icon: '☀️',
    sensors: [
      { path: 'State',                        name: 'State',            format: 'mppt-state' },
      { path: 'Pv/V',                         name: 'PV Voltage',       format: 'voltage',     unit: 'V' },
      { path: 'Pv/I',                         name: 'PV Current',       format: 'current',     unit: 'A' },
      { path: 'Pv/P',                         name: 'PV Power',         format: 'power',       unit: 'W' },
      { path: 'Yield/User',                   name: 'Daily Yield',      format: 'energy',      unit: 'kWh' },
      { path: 'Yield/Total',                  name: 'Total Yield',      format: 'energy',      unit: 'kWh' },
      { path: 'History/Daily/0/Yield',        name: 'Yield Today',      format: 'energy',      unit: 'kWh' },
      { path: 'History/Daily/0/MaxPower',     name: 'Max Power Today',  format: 'power',       unit: 'W' },
      { path: 'ErrorCode',                    name: 'Error Code',       format: 'mppt-error' },
      { path: 'Temperature',                  name: 'Temperature',      format: 'temperature', unit: '°C', homekit: 'temperature' },
      { path: 'Load/State',                   name: 'Load Output',      format: 'on-off' },
      { path: 'Load/I',                       name: 'Load Current',     format: 'current',     unit: 'A' },
    ],
    homekit: ['temperature'],
  },

  battery: {
    label: 'Battery',
    color: 'battery',
    icon: '🔋',
    sensors: [
      { path: 'Soc',                          name: 'State of Charge',  format: 'percent',     unit: '%',  homekit: 'battery-level' },
      { path: 'Voltage',                      name: 'Voltage',          format: 'voltage',     unit: 'V' },
      { path: 'Current',                      name: 'Current',          format: 'current',     unit: 'A' },
      { path: 'Power',                        name: 'Power',            format: 'power',       unit: 'W' },
      { path: 'Temperature',                  name: 'Temperature',      format: 'temperature', unit: '°C', homekit: 'temperature' },
      { path: 'TimeToGo',                     name: 'Time to Go',       format: 'duration' },
      { path: 'Capacity',                     name: 'Capacity',         format: 'capacity',    unit: 'Ah' },
      { path: 'ConsumedAmphours',             name: 'Consumed Ah',      format: 'capacity',    unit: 'Ah' },
      { path: 'State',                        name: 'State',            format: 'battery-state', homekit: 'charging-state' },
      { path: 'Alarms/LowSoc',               name: 'Low SOC Alarm',    format: 'alarm',       homekit: 'low-battery' },
      { path: 'Alarms/LowVoltage',           name: 'Low Voltage Alarm',format: 'alarm' },
      { path: 'Alarms/HighVoltage',          name: 'High Voltage Alarm',format: 'alarm' },
      { path: 'Alarms/LowTemperature',       name: 'Low Temp Alarm',   format: 'alarm' },
      { path: 'Alarms/HighTemperature',      name: 'High Temp Alarm',  format: 'alarm' },
      { path: 'System/MinCellVoltage',       name: 'Min Cell Voltage', format: 'voltage',     unit: 'V' },
      { path: 'System/MaxCellVoltage',       name: 'Max Cell Voltage', format: 'voltage',     unit: 'V' },
      { path: 'System/MinCellTemperature',   name: 'Min Cell Temp',    format: 'temperature', unit: '°C' },
      { path: 'System/MaxCellTemperature',   name: 'Max Cell Temp',    format: 'temperature', unit: '°C' },
    ],
    homekit: ['battery', 'temperature'],
  },

  vebus: {
    label: 'Multi/Quattro',
    color: 'blue',
    icon: '⚡',
    sensors: [
      { path: 'State',                        name: 'State',            format: 'vebus-state' },
      { path: 'Mode',                         name: 'Mode',             format: 'vebus-mode' },
      { path: 'Ac/ActiveIn/L1/V',            name: 'AC In L1 Voltage', format: 'voltage',     unit: 'V' },
      { path: 'Ac/ActiveIn/L1/I',            name: 'AC In L1 Current', format: 'current',     unit: 'A' },
      { path: 'Ac/ActiveIn/L1/P',            name: 'AC In L1 Power',   format: 'power',       unit: 'W' },
      { path: 'Ac/ActiveIn/L1/F',            name: 'AC In Frequency',  format: 'frequency',   unit: 'Hz' },
      { path: 'Ac/ActiveIn/L2/V',            name: 'AC In L2 Voltage', format: 'voltage',     unit: 'V' },
      { path: 'Ac/ActiveIn/L2/I',            name: 'AC In L2 Current', format: 'current',     unit: 'A' },
      { path: 'Ac/ActiveIn/L2/P',            name: 'AC In L2 Power',   format: 'power',       unit: 'W' },
      { path: 'Ac/ActiveIn/L3/V',            name: 'AC In L3 Voltage', format: 'voltage',     unit: 'V' },
      { path: 'Ac/ActiveIn/L3/I',            name: 'AC In L3 Current', format: 'current',     unit: 'A' },
      { path: 'Ac/ActiveIn/L3/P',            name: 'AC In L3 Power',   format: 'power',       unit: 'W' },
      { path: 'Ac/Out/L1/V',                 name: 'AC Out L1 Voltage',format: 'voltage',     unit: 'V' },
      { path: 'Ac/Out/L1/I',                 name: 'AC Out L1 Current',format: 'current',     unit: 'A' },
      { path: 'Ac/Out/L1/P',                 name: 'AC Out L1 Power',  format: 'power',       unit: 'W' },
      { path: 'Ac/Out/L1/F',                 name: 'AC Out Frequency', format: 'frequency',   unit: 'Hz' },
      { path: 'Ac/Out/L2/V',                 name: 'AC Out L2 Voltage',format: 'voltage',     unit: 'V' },
      { path: 'Ac/Out/L2/I',                 name: 'AC Out L2 Current',format: 'current',     unit: 'A' },
      { path: 'Ac/Out/L2/P',                 name: 'AC Out L2 Power',  format: 'power',       unit: 'W' },
      { path: 'Ac/Out/L3/V',                 name: 'AC Out L3 Voltage',format: 'voltage',     unit: 'V' },
      { path: 'Ac/Out/L3/I',                 name: 'AC Out L3 Current',format: 'current',     unit: 'A' },
      { path: 'Ac/Out/L3/P',                 name: 'AC Out L3 Power',  format: 'power',       unit: 'W' },
      { path: 'Dc/0/Voltage',                name: 'DC Voltage',       format: 'voltage',     unit: 'V' },
      { path: 'Dc/0/Current',                name: 'DC Current',       format: 'current',     unit: 'A' },
      { path: 'Dc/0/Temperature',            name: 'Temperature',      format: 'temperature', unit: '°C', homekit: 'temperature' },
      { path: 'VebusSoc',                    name: 'Battery SOC',      format: 'percent',     unit: '%' },
      { path: 'Alarms/HighTemperature',      name: 'High Temp Alarm',  format: 'alarm' },
      { path: 'Alarms/LowBattery',           name: 'Low Battery Alarm',format: 'alarm' },
      { path: 'Alarms/Overload',             name: 'Overload Alarm',   format: 'alarm' },
    ],
    homekit: ['temperature'],
  },

  tank: {
    label: 'Tank',
    color: 'blue',
    icon: '🪣',
    sensors: [
      { path: 'Level',                        name: 'Level',            format: 'percent',     unit: '%',  homekit: 'tank-level' },
      { path: 'Remaining',                    name: 'Remaining',        format: 'volume',      unit: 'L' },
      { path: 'Status',                       name: 'Status',           format: 'tank-status' },
      { path: 'FluidType',                    name: 'Fluid Type',       format: 'fluid-type' },
      { path: 'Capacity',                     name: 'Capacity',         format: 'volume',      unit: 'L' },
    ],
    homekit: ['tank'],
  },

  temperature: {
    label: 'Temperature Sensor',
    color: 'orange',
    icon: '🌡️',
    sensors: [
      { path: 'Temperature',                  name: 'Temperature',      format: 'temperature', unit: '°C', homekit: 'temperature' },
      { path: 'Humidity',                     name: 'Humidity',         format: 'percent',     unit: '%',  homekit: 'humidity' },
      { path: 'Pressure',                     name: 'Pressure',         format: 'pressure',    unit: 'hPa' },
      { path: 'TemperatureType',              name: 'Sensor Type',      format: 'temp-type' },
    ],
    homekit: ['temperature', 'humidity'],
  },

  gps: {
    label: 'GPS',
    color: 'blue',
    icon: '📡',
    sensors: [
      { path: 'Position/Latitude',            name: 'Latitude',         format: 'gps-coord' },
      { path: 'Position/Longitude',           name: 'Longitude',        format: 'gps-coord' },
      { path: 'Course',                       name: 'Course',           format: 'degrees',     unit: '°' },
      { path: 'Speed',                        name: 'Speed',            format: 'speed',       unit: 'km/h' },
      { path: 'Altitude',                     name: 'Altitude',         format: 'number',      unit: 'm' },
      { path: 'NrOfSatellites',              name: 'Satellites',       format: 'count' },
      { path: 'Fix',                          name: 'GPS Fix',          format: 'gps-fix' },
    ],
    homekit: [],
  },

  digitalinput: {
    label: 'Digital Input',
    color: 'yellow',
    icon: '🔌',
    sensors: [
      { path: 'State',                        name: 'State',            format: 'on-off',      homekit: 'contact' },
      { path: 'Type',                         name: 'Input Type',       format: 'dinput-type' },
      { path: 'Alarm',                        name: 'Alarm',            format: 'alarm' },
      { path: 'Count',                        name: 'Pulse Count',      format: 'count' },
    ],
    homekit: ['contact'],
  },

  pulsemeter: {
    label: 'Pulse Meter',
    color: 'blue',
    icon: '📊',
    sensors: [
      { path: 'Count',                        name: 'Pulse Count',      format: 'count' },
      { path: 'Aggregate',                    name: 'Aggregate',        format: 'number' },
    ],
    homekit: [],
  },

  generator: {
    label: 'Generator',
    color: 'yellow',
    icon: '⚙️',
    sensors: [
      { path: 'State',                        name: 'State',            format: 'generator-state', homekit: 'contact' },
      { path: 'Runtime',                      name: 'Total Runtime',    format: 'duration' },
      { path: 'Error',                        name: 'Error Code',       format: 'count' },
      { path: 'AutoStartEnabled',             name: 'Auto Start',       format: 'on-off' },
    ],
    homekit: ['contact'],
  },

  accharger: {
    label: 'AC Charger',
    color: 'blue',
    icon: '🔌',
    sensors: [
      { path: 'State',                        name: 'State',            format: 'charger-state' },
      { path: 'Dc/0/Current',                name: 'DC Current',       format: 'current',     unit: 'A' },
      { path: 'Dc/0/Voltage',                name: 'DC Voltage',       format: 'voltage',     unit: 'V' },
      { path: 'Ac/In/L1/V',                  name: 'AC Voltage',       format: 'voltage',     unit: 'V' },
      { path: 'Ac/In/L1/I',                  name: 'AC Current',       format: 'current',     unit: 'A' },
      { path: 'Temperature',                  name: 'Temperature',      format: 'temperature', unit: '°C', homekit: 'temperature' },
    ],
    homekit: ['temperature'],
  },

  inverter: {
    label: 'Inverter',
    color: 'blue',
    icon: '⚡',
    sensors: [
      { path: 'State',                        name: 'State',            format: 'vebus-state' },
      { path: 'Ac/Out/L1/V',                 name: 'AC Out Voltage',   format: 'voltage',     unit: 'V' },
      { path: 'Ac/Out/L1/I',                 name: 'AC Out Current',   format: 'current',     unit: 'A' },
      { path: 'Ac/Out/L1/P',                 name: 'AC Out Power',     format: 'power',       unit: 'W' },
      { path: 'Dc/0/Voltage',                name: 'DC Voltage',       format: 'voltage',     unit: 'V' },
      { path: 'Dc/0/Current',                name: 'DC Current',       format: 'current',     unit: 'A' },
      { path: 'Temperature',                  name: 'Temperature',      format: 'temperature', unit: '°C', homekit: 'temperature' },
    ],
    homekit: ['temperature'],
  },
};

// ── State-code lookup tables ────────────────────────────────────────────────

const MPPT_STATES = {
  0: 'Off', 2: 'Fault', 3: 'Bulk', 4: 'Absorption',
  5: 'Float', 6: 'Storage', 7: 'Equalize', 11: 'External Control',
};

const VEBUS_STATES = {
  0: 'Off', 1: 'Low Power', 2: 'Fault', 3: 'Bulk', 4: 'Absorption',
  5: 'Float', 6: 'Storage', 7: 'Equalize', 8: 'Passthru',
  9: 'Inverting', 10: 'Power Assist', 11: 'Power Supply',
  244: 'Sustain', 252: 'External Control', 256: 'Discharging', 257: 'Sustain',
};

const VEBUS_MODES = { 1: 'Charger Only', 2: 'Inverter Only', 3: 'On', 4: 'Off' };

const BATTERY_STATES = { 0: 'Idle', 1: 'Charging', 2: 'Discharging' };

const TANK_STATUSES = {
  0: 'OK', 1: 'Disconnected', 2: 'Short Circuited', 3: 'Reverse Polarity', 4: 'Unknown',
};

const FLUID_TYPES = {
  0: 'Fuel', 1: 'Fresh Water', 2: 'Waste Water', 3: 'Live Well',
  4: 'Oil', 5: 'Black Water', 6: 'Gasoline',
};

const TEMP_TYPES = { 0: 'Battery', 1: 'Fridge', 2: 'Generic', 3: 'Room', 4: 'Outdoor', 5: 'Water Heater' };

const DINPUT_TYPES = {
  0: 'Door', 1: 'Bilge Pump', 2: 'Bilge Alarm', 3: 'Burglar Alarm',
  4: 'Smoke Alarm', 5: 'Fire Alarm', 6: 'CO₂ Alarm', 7: 'Generator',
  8: 'None', 9: 'Pulsemeter', 10: 'Tank Pump', 11: 'Bilge Pump (auto)',
};

const MPPT_ERRORS = {
  0: 'No error', 1: 'Battery temp too high', 2: 'Battery voltage too high',
  17: 'Charger temp too high', 18: 'Charger over-current', 19: 'Current reversed',
  20: 'Bulk time limit exceeded', 21: 'Current sensor issue',
  26: 'Terminals overheated', 28: 'Converter issue',
  33: 'Input voltage too high', 34: 'Input current too high',
  38: 'Input shutdown (excess voltage)', 39: 'Input shutdown (current while off)',
  65: 'Lost communication', 67: 'BMS connection lost',
  116: 'Factory calibration lost', 119: 'Settings data lost',
};

const GENERATOR_STATES = { 0: 'Stopped', 1: 'Running', 10: 'Error' };

const KNOWN_SERVICES = new Set(Object.keys(DEVICE_TYPES));

module.exports = {
  DEVICE_TYPES,
  KNOWN_SERVICES,
  MPPT_STATES,
  VEBUS_STATES,
  VEBUS_MODES,
  BATTERY_STATES,
  TANK_STATUSES,
  FLUID_TYPES,
  TEMP_TYPES,
  DINPUT_TYPES,
  MPPT_ERRORS,
  GENERATOR_STATES,
};
