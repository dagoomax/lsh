// Per-metric energy source selection.
//
// LSH can pull the same physical quantity (solar, battery, grid, loads) from
// more than one integration. This lets the user *mix brands* — e.g. show PV
// production from a Victron MPPT but the battery bank from a SolarEdge
// inverter. The selection is a pure client-side preference kept in
// localStorage; nothing is written back to the server.

export const ENERGY_METRICS = [
  { id: 'solar',   label: 'Solar' },
  { id: 'battery', label: 'Battery' },
  { id: 'grid',    label: 'Grid' },
  { id: 'loads',   label: 'Loads' },
]

// Brands that can feed a metric. `victron` maps to the grouped Victron
// readings; `solaredge` reshapes the flat SolarEdge overview.
export const ENERGY_SOURCES = [
  { id: 'victron',   label: 'Victron' },
  { id: 'solaredge', label: 'SolarEdge' },
]

const LS_KEY = 'lsh-energy-sources'
const DEFAULTS = { solar: 'victron', battery: 'victron', grid: 'victron', loads: 'victron' }

export function loadEnergySources() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(LS_KEY) || '{}') }
  } catch { return { ...DEFAULTS } }
}

export function saveEnergySources(sources) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(sources)) } catch { /* ignore */ }
}

// True when SolarEdge is reporting anything usable — used to decide whether to
// even offer it as an alternate source.
export function hasSolarEdge(energy) {
  const se = energy?.solaredge
  if (!se) return false
  return ['currentPower', 'gridPower', 'batteryPower', 'loadPower', 'batteryLevel', 'dailyEnergy']
    .some(k => se[k] != null)
}

// Reshape SolarEdge's flat overview into the Victron-group shapes EnergyFlow
// consumes, so either brand can transparently feed any metric. Fields Victron
// exposes but SolarEdge doesn't (per-phase power, voltage, frequency) stay
// null and the UI renders them as "—".
const seSolar   = se => ({ power: se.currentPower, dailyYield: se.dailyEnergy != null ? se.dailyEnergy / 1000 : null, current: null, panelVoltage: null })
// SolarEdge reports batteryPower with the opposite sign to Victron current
// (positive = discharging), so negate it to drive the charge indicator.
const seBattery = se => ({ soc: se.batteryLevel, power: se.batteryPower, current: se.batteryPower != null ? -se.batteryPower : null, voltage: null, state: null, timeToGo: null })
const seGrid    = se => ({ power: se.gridPower, powerL2: null, powerL3: null, voltage: null, frequency: null })
const seLoads   = se => ({ power: se.loadPower, powerL2: null, powerL3: null })

// Return a new energy object with each metric swapped to its selected source.
// Falls back to Victron whenever SolarEdge data is absent.
export function resolveEnergy(energy, sources) {
  if (!energy) return energy
  const se = energy.solaredge
  const use = metric => se && sources?.[metric] === 'solaredge'
  return {
    ...energy,
    solar:   use('solar')   ? seSolar(se)   : energy.solar,
    battery: use('battery') ? seBattery(se) : energy.battery,
    grid:    use('grid')    ? seGrid(se)    : energy.grid,
    loads:   use('loads')   ? seLoads(se)   : energy.loads,
  }
}
