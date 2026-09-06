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
// readings; `solaredge`/`solaraccelerator` reshape their own flat overviews.
export const ENERGY_SOURCES = [
  { id: 'victron',           label: 'Victron' },
  { id: 'solaredge',         label: 'SolarEdge' },
  { id: 'solaraccelerator',  label: 'Solar Accelerator' },
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

// Same idea for a Solar Accelerator Connect gateway (Deye-family hybrid
// inverters, see src/solaraccelerator-client.js).
export function hasSolarAccelerator(energy) {
  const sa = energy?.solaraccelerator
  if (!sa) return false
  return ['pvPower', 'gridPower', 'batteryPower', 'loadPower', 'batterySoc', 'dailyPvEnergy']
    .some(k => sa[k] != null)
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

// Same reshape, for a Solar Accelerator gateway's flat overview (see
// getGrouped() in src/data-store.js for where these fields come from).
const saSolar   = sa => ({ power: sa.pvPower, dailyYield: sa.dailyPvEnergy, current: null, panelVoltage: null })
const saBattery = sa => ({ soc: sa.batterySoc, power: sa.batteryPower, current: null, voltage: null, state: null, timeToGo: null })
const saGrid    = sa => ({ power: sa.gridPower, powerL2: null, powerL3: null, voltage: sa.gridVoltage, frequency: sa.gridFrequency })
const saLoads   = sa => ({ power: sa.loadPower, powerL2: null, powerL3: null })

// Return a new energy object with each metric swapped to its selected source.
// Falls back to Victron whenever the selected brand has no data.
export function resolveEnergy(energy, sources) {
  if (!energy) return energy
  const se = energy.solaredge
  const sa = energy.solaraccelerator
  const use = (metric, brand) => sources?.[metric] === brand
  const reshape = {
    solar:   { solaredge: () => seSolar(se),   solaraccelerator: () => saSolar(sa) },
    battery: { solaredge: () => seBattery(se), solaraccelerator: () => saBattery(sa) },
    grid:    { solaredge: () => seGrid(se),    solaraccelerator: () => saGrid(sa) },
    loads:   { solaredge: () => seLoads(se),   solaraccelerator: () => saLoads(sa) },
  }
  const pick = metric => {
    if (use(metric, 'solaredge') && se) return reshape[metric].solaredge()
    if (use(metric, 'solaraccelerator') && sa) return reshape[metric].solaraccelerator()
    return energy[metric]
  }
  return {
    ...energy,
    solar:   pick('solar'),
    battery: pick('battery'),
    grid:    pick('grid'),
    loads:   pick('loads'),
  }
}
