const { Server } = require('socket.io');

function setupWebSocket(httpServer, store, sensorRegistry, connectionMgr) {
  const io = new Server(httpServer, { cors: { origin: '*' } });

  io.on('connection', (socket) => {
    console.log(`[WS] Client connected (${socket.id})`);

    // Send current state immediately
    socket.emit('snapshot', store.getAll());
    socket.emit('devices', sensorRegistry ? sensorRegistry.getAllReadings() : []);
    if (connectionMgr) {
      socket.emit('connection-status', connectionMgr.getStatus());
    }

    socket.on('disconnect', () => console.log(`[WS] Client disconnected (${socket.id})`));
  });

  // Batch data updates (debounce per tick)
  let pending = {};
  let scheduled = false;

  store.on('change', ({ key, value }) => {
    pending[key] = value;
    if (!scheduled) {
      scheduled = true;
      setImmediate(() => {
        io.emit('update', pending);
        pending = {};
        scheduled = false;
      });
    }
  });

  // Forward device discovery
  if (sensorRegistry) {
    sensorRegistry.on('device-discovered', (device) => {
      io.emit('device-discovered', device);
    });
  }

  // Forward connection source changes
  if (connectionMgr) {
    connectionMgr.on('source-changed', () => {
      io.emit('connection-status', connectionMgr.getStatus());
    });
  }

  return io;
}

module.exports = setupWebSocket;
