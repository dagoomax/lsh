/**
 * SolarEdge Monitoring API client.
 * Polls /overview (energy totals) and /powerFlow (real-time power) every 30 seconds.
 *
 * Store paths written:
 *   solaredge/currentPower   — current PV output (W)
 *   solaredge/gridPower      — grid power: positive = import, negative = export (W)
 *   solaredge/batteryPower   — battery power: positive = charging, negative = discharging (W)
 *   solaredge/loadPower      — current consumption (W)
 *   solaredge/dailyEnergy    — energy produced today (Wh)
 *   solaredge/lifetimeEnergy — total lifetime energy (Wh)
 *   solaredge/batteryLevel   — battery SOC % (0-100, if storage present)
 */

const platformStatus = require('./platform-status');

const BASE_URL = 'https://monitoringapi.solaredge.com';
const POLL_INTERVAL_MS = 30000;

class SolarEdgeClient {
  constructor(config, store) {
    this.config    = config;
    this.store     = store;
    this.pollTimer = null;
    this.connected = false;
  }

  async start() {
    const { siteId, apiKey } = this.config.solaredge;
    if (!siteId || !apiKey) throw new Error('SolarEdge siteId and apiKey are required');

    // Verify connectivity with an initial poll
    await this._poll();
    this.connected = true;
    platformStatus.set('solaredge', true);
    this.pollTimer = setInterval(() => this._poll(), POLL_INTERVAL_MS);
    console.log(`[SolarEdge] Started polling site ${siteId} every ${POLL_INTERVAL_MS / 1000}s`);
  }

  stop() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.connected = false;
    console.log('[SolarEdge] Stopped');
  }

  async _poll() {
    const { siteId, apiKey } = this.config.solaredge;

    await Promise.allSettled([
      this._fetchOverview(siteId, apiKey),
      this._fetchPowerFlow(siteId, apiKey),
    ]);
  }

  async _fetchOverview(siteId, apiKey) {
    const res = await fetch(`${BASE_URL}/site/${siteId}/overview?api_key=${apiKey}`);
    if (!res.ok) {
      console.error(`[SolarEdge] overview HTTP ${res.status}`);
      return;
    }

    const { overview } = await res.json();
    if (!overview) return;

    if (overview.currentPower?.power != null)
      this.store.update('solaredge/currentPower', overview.currentPower.power);
    if (overview.lastDayData?.energy != null)
      this.store.update('solaredge/dailyEnergy', overview.lastDayData.energy);
    if (overview.lifeTimeData?.energy != null)
      this.store.update('solaredge/lifetimeEnergy', overview.lifeTimeData.energy);
  }

  async _fetchPowerFlow(siteId, apiKey) {
    const res = await fetch(`${BASE_URL}/site/${siteId}/powerFlow?api_key=${apiKey}`);
    if (!res.ok) {
      // powerFlow requires certain subscription tiers — not a hard error
      if (res.status !== 403) console.error(`[SolarEdge] powerFlow HTTP ${res.status}`);
      return;
    }

    const json = await res.json();
    const flow = json?.siteCurrentPowerFlow;
    if (!flow) return;

    // unit is 'kW' — convert to watts
    const kw = (val) => (val ?? 0) * 1000;

    if (flow.PV?.currentPower != null)
      this.store.update('solaredge/currentPower', kw(flow.PV.currentPower));

    if (flow.LOAD?.currentPower != null)
      this.store.update('solaredge/loadPower', kw(flow.LOAD.currentPower));

    if (flow.GRID?.currentPower != null) {
      const gridW = kw(flow.GRID.currentPower);
      // Determine direction from connections array
      const connections = flow.connections ?? [];
      const exporting = connections.some(
        (c) => (c.from === 'PV' || c.from === 'STORAGE' || c.from === 'Load') && c.to === 'Grid'
      );
      this.store.update('solaredge/gridPower', exporting ? -gridW : gridW);
    }

    if (flow.STORAGE?.currentPower != null) {
      const storageW = kw(flow.STORAGE.currentPower);
      const connections = flow.connections ?? [];
      const discharging = connections.some((c) => c.from === 'STORAGE');
      this.store.update('solaredge/batteryPower', discharging ? -storageW : storageW);

      if (flow.STORAGE.chargeLevel != null)
        this.store.update('solaredge/batteryLevel', flow.STORAGE.chargeLevel);
    }

    console.log('[SolarEdge] Poll OK');
  }
}

module.exports = SolarEdgeClient;
