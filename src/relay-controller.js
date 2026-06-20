class RelayController {
  constructor(config, store) {
    this.config = config;
    this.store = store;
    this.client = null;
  }

  setClient(client) {
    this.client = client;
  }

  getState(index) {
    return this.store.get(`system/0/Relay/${index}/State`) === 1;
  }

  getAll() {
    return this.config.relays.map((relay) => ({
      index: relay.index,
      name: relay.name,
      on: this.getState(relay.index),
    }));
  }

  async setState(index, on) {
    if (!this.client) {
      throw new Error('No data client connected');
    }
    await this.client.writeRelay(index, on);
  }
}

module.exports = RelayController;
