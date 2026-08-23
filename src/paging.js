'use strict';

const { EventEmitter } = require('events');

/**
 * Room-to-room paging (intercom). Unlike sip-server.js (which bridges to a
 * real external SIP doorbell over RTP/ffmpeg), every paging endpoint here is
 * a browser — a Wall Dashboard tablet or the regular dashboard — so no SIP
 * protocol or ffmpeg bridging is needed. Audio is plain MediaRecorder chunks
 * relayed browser-to-browser through Socket.IO (see src/websocket.js and
 * react-dashboard/src/hooks/usePaging.js); this module only tracks which
 * room each connected socket represents and brokers page sessions between
 * two of them.
 *
 * Rooms come from config.paging.rooms ({id, label}) — a fixed, config-driven
 * list, not auto-discovered, since a "room" here means a physical tablet
 * someone deliberately registered, not a device grouping.
 */

const PAGE_TIMEOUT_MS = 5 * 60 * 1000; // safety auto-end for a channel left open

class PagingManager extends EventEmitter {
  constructor(config) {
    super();
    this._rooms       = (config.paging?.rooms || []).filter((r) => r && r.id);
    this._roomSockets = new Map(); // roomId -> Set<socket>
    this._socketRoom  = new Map(); // socket.id -> roomId
    this._sessions    = new Map(); // pageId -> { from, to, sockets: Set<socket>, timer }
    this._io          = null;
  }

  setIo(io) { this._io = io; }

  roomExists(id) { return this._rooms.some((r) => r.id === id); }

  _label(id) { return this._rooms.find((r) => r.id === id)?.label || id; }

  getRoomsStatus() {
    return this._rooms.map((r) => ({
      id: r.id,
      label: r.label || r.id,
      online: (this._roomSockets.get(r.id)?.size || 0) > 0,
    }));
  }

  registerSocket(socket, roomId) {
    if (!this.roomExists(roomId)) throw new Error(`Unknown paging room "${roomId}"`);
    this.unregisterSocket(socket); // a socket only ever represents one room at a time
    if (!this._roomSockets.has(roomId)) this._roomSockets.set(roomId, new Set());
    this._roomSockets.get(roomId).add(socket);
    this._socketRoom.set(socket.id, roomId);
    this.emit('rooms-changed', this.getRoomsStatus());
  }

  unregisterSocket(socket) {
    const roomId = this._socketRoom.get(socket.id);
    if (roomId == null) return;
    this._roomSockets.get(roomId)?.delete(socket);
    this._socketRoom.delete(socket.id);
    for (const pageId of [...this._sessions.keys()]) {
      const session = this._sessions.get(pageId);
      if (session?.sockets.has(socket)) this.endPage(pageId, 'disconnected');
    }
    this.emit('rooms-changed', this.getRoomsStatus());
  }

  /** Open a live two-way channel between two configured rooms. Both need an online (registered) device. */
  startPage(fromRoomId, toRoomId) {
    if (!this._io) throw new Error('Paging not ready — server still starting');
    if (!fromRoomId || !toRoomId) throw new Error('Both a "from" and "to" room are required');
    if (fromRoomId === toRoomId) throw new Error('Cannot page a room from itself');
    if (!this.roomExists(fromRoomId)) throw new Error(`Unknown paging room "${fromRoomId}"`);
    if (!this.roomExists(toRoomId))   throw new Error(`Unknown paging room "${toRoomId}"`);

    const fromSockets = this._roomSockets.get(fromRoomId);
    const toSockets   = this._roomSockets.get(toRoomId);
    if (!fromSockets?.size) throw new Error(`"${this._label(fromRoomId)}" has no device connected`);
    if (!toSockets?.size)   throw new Error(`"${this._label(toRoomId)}" has no device connected`);

    const pageId  = `pg${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const ioRoom  = `page:${pageId}`;
    const sockets = new Set([...fromSockets, ...toSockets]);
    for (const s of sockets) s.join(ioRoom);

    const timer = setTimeout(() => this.endPage(pageId, 'timeout'), PAGE_TIMEOUT_MS);
    this._sessions.set(pageId, { from: fromRoomId, to: toRoomId, sockets, timer });

    this._io.to(ioRoom).emit('paging:incoming', {
      pageId, from: fromRoomId, to: toRoomId,
      fromLabel: this._label(fromRoomId), toLabel: this._label(toRoomId),
    });
    console.log(`[Paging] ${fromRoomId} → ${toRoomId} (${pageId})`);
    return { pageId, from: fromRoomId, to: toRoomId };
  }

  endPage(pageId, reason = 'ended') {
    const session = this._sessions.get(pageId);
    if (!session) return false;
    clearTimeout(session.timer);
    const ioRoom = `page:${pageId}`;
    this._io?.to(ioRoom).emit('paging:ended', { pageId, reason });
    for (const s of session.sockets) { try { s.leave(ioRoom); } catch { /* already gone */ } }
    this._sessions.delete(pageId);
    return true;
  }

  /** Relay one audio chunk to the other participant(s) of a session — sender excluded. */
  relayAudio(socket, pageId, chunk) {
    const session = this._sessions.get(pageId);
    if (!session || !session.sockets.has(socket)) return;
    socket.to(`page:${pageId}`).emit('paging:audio', { pageId, chunk });
  }
}

module.exports = PagingManager;
