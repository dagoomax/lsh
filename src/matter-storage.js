// Shared bootstrap for both matter-bridge.js and matter-client.js. Must be
// required before any other @matter/* module (matter.js locks its storage
// path and other environment config the first time its Node environment
// initializes — setting it twice, or setting it after ServerNode.create()/
// CommissioningController.start() has already run once, throws). Node's
// require() cache means this file's body only ever executes once even
// though both callers require it, so a bridge+controller setup sharing one
// process is safe.
//
// Both matter-bridge.js and matter-client.js pass their own `id` to
// ServerNode.create()/environment name, which matter.js uses as a
// subdirectory under this one shared base path — so they don't collide on
// disk despite sharing a base path.
const path = require('path');

require('@matter/nodejs/config').config.defaultStoragePath = path.join(__dirname, '..', 'persist', 'matter');

const { Logger, LogLevel } = require('@matter/main');
// matter.js's own logger is very chatty at its default DEBUG level and
// writes ANSI-colored multi-line output straight to stdout, which floods
// LSH's logs — lifecycle events LSH cares about are logged separately via
// plain console.log('[Matter] ...') calls in matter-bridge.js/matter-client.js.
Logger.level = LogLevel.WARN;

module.exports = {};
