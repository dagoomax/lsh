const { Server }     = require('socket.io');
const platformStatus = require('./platform-status');
const cameraLog      = require('./camera-log');
const detectionBoxes = require('./detection-boxes');

function setupWebSocket(httpServer, store, sensorRegistry, connectionMgr, auth, sipServer, pagingManager) {
  const io = new Server(httpServer, { cors: { origin: '*' } });

  // Socket.io auth middleware
  if (auth) {
    io.use((socket, next) => {
      // First-run: no users configured yet — allow all connections
      if (!auth.hasUsers()) return next();

      // Bearer token in handshake auth
      const bearer = socket.handshake.auth?.token;
      if (bearer) {
        if (auth.verifyApiToken(bearer)) return next();
        if (auth.verifyToken(bearer)) return next();
      }

      // JWT from session cookie
      const cookieHeader = socket.handshake.headers.cookie || '';
      const payload = auth.verifyFromCookieHeader(cookieHeader);
      if (payload) { socket.user = payload; return next(); }

      next(new Error('Unauthorized'));
    });
  }

  io.on('connection', (socket) => {
    console.log(`[WS] Client connected (${socket.id})`);

    // Send current state immediately
    socket.emit('snapshot', store.getAll());
    socket.emit('devices', sensorRegistry ? sensorRegistry.getAllReadings() : []);
    socket.emit('rooms', sensorRegistry ? sensorRegistry.getRoomMeta() : {});
    if (connectionMgr) {
      socket.emit('connection-status', connectionMgr.getStatus());
    }
    socket.emit('platform-status', platformStatus.getAll());
    if (sipServer) socket.emit('sip-call', sipServer.getState());
    if (pagingManager) socket.emit('paging-rooms', pagingManager.getRoomsStatus());

    // Room-to-room paging (src/paging.js) — every endpoint is a browser, so
    // audio is relayed as plain MediaRecorder chunks over these events
    // rather than through any server-side media pipeline.
    if (pagingManager) {
      socket.on('paging:register', (roomId, cb) => {
        try { pagingManager.registerSocket(socket, roomId); cb?.({ success: true }); }
        catch (err) { cb?.({ success: false, error: err.message }); }
      });
      socket.on('paging:start', ({ from, to } = {}, cb) => {
        try { cb?.({ success: true, data: pagingManager.startPage(from, to) }); }
        catch (err) { cb?.({ success: false, error: err.message }); }
      });
      socket.on('paging:audio', ({ pageId, chunk } = {}) => {
        if (pageId && chunk) pagingManager.relayAudio(socket, pageId, chunk);
      });
      socket.on('paging:end', ({ pageId } = {}) => {
        if (pageId) pagingManager.endPage(pageId, 'ended-by-user');
      });
    }

    socket.on('disconnect', () => {
      console.log(`[WS] Client disconnected (${socket.id})`);
      if (pagingManager) pagingManager.unregisterSocket(socket);
    });
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
    sensorRegistry.on('devices-changed', () => {
      io.emit('devices', sensorRegistry.getAllReadings());
    });
    sensorRegistry.on('rooms-changed', () => {
      io.emit('rooms', sensorRegistry.getRoomMeta());
    });
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

  // Forward platform status changes
  platformStatus.on('change', (status) => {
    io.emit('platform-status', status);
  });

  // Forward camera events
  cameraLog.on('entry', (entry) => {
    io.emit('camera-event', entry);
  });

  // Forward object-detection bounding boxes for the camera modal's live overlay
  detectionBoxes.on('update', (entry) => {
    io.emit('detection-boxes', entry);
  });

  // Forward SIP doorbell call state to all browsers
  if (sipServer) {
    sipServer.on('call', (state) => io.emit('sip-call', state));
  }

  // Forward paging room online/offline status to all browsers
  if (pagingManager) {
    pagingManager.on('rooms-changed', (status) => io.emit('paging-rooms', status));
  }

  return io;
}

module.exports = setupWebSocket;
