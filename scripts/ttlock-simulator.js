#!/usr/bin/env node
'use strict';

// TTLock Open Platform stand-in — enough for src/ttlock-client.js to log in,
// list locks, read state, lock/unlock and manage passcodes.
//
//   node scripts/ttlock-simulator.js [port]      (default 8090)
//   config.ttlock = { clientId: 'cid', clientSecret: 'csec', username: 'host@example.com',
//                     password: 'secret', apiBase: 'http://127.0.0.1:8090' }

const http = require('http');
const crypto = require('crypto');

function createSimulator({ clientId = 'cid', clientSecret = 'csec', username = 'host@example.com', password = 'secret' } = {}) {
  const md5 = crypto.createHash('md5').update(password).digest('hex');
  const locks = [
    { lockId: 3311, lockAlias: 'Apartament 4B', lockName: 'S31_c1a2', hasGateway: 1, electricQuantity: 76, state: 0, sensorState: 1 },
    { lockId: 3312, lockAlias: 'Komórka', lockName: 'S202_77aa', hasGateway: 0, electricQuantity: 55, state: 0 },
  ];
  const passcodes = { 3311: [], 3312: [] };
  const log = [];
  let token = null;
  let nextId = 900;
  const ok = (res, body = {}) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
  const err = (res, errcode, errmsg) => ok(res, { errcode, errmsg });

  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const url = new URL(req.url, 'http://x');
      const f = { ...Object.fromEntries(url.searchParams), ...Object.fromEntries(new URLSearchParams(body)) };
      if (url.pathname === '/oauth2/token') {
        if ((f.client_id || f.clientId) !== clientId || (f.client_secret || f.clientSecret) !== clientSecret) return err(res, 10001, 'invalid client');
        if (f.grant_type === 'refresh_token') {
          if (f.refresh_token !== token?.refresh_token) return err(res, 10003, 'invalid refresh token');
        } else if (f.username !== username || f.password !== md5) return err(res, 10007, 'invalid account or password');
        token = { access_token: crypto.randomBytes(8).toString('hex'), refresh_token: crypto.randomBytes(8).toString('hex'), uid: 1, expires_in: 7776000 };
        return ok(res, token);
      }
      if (f.clientId !== clientId || !token || f.accessToken !== token.access_token) return err(res, 10004, 'invalid token');
      if (!/^\d{12,}$/.test(f.date || '')) return err(res, -3, 'invalid date');
      const p = url.pathname.replace(/^\/v3\//, '');
      const lock = locks.find((l) => l.lockId === Number(f.lockId));
      const gw = () => { if (!lock?.hasGateway) { err(res, -2012, 'The Lock is not connected to any Gateway.'); return false; } return true; };
      switch (p) {
        case 'lock/list': return ok(res, { list: locks.map(({ state, sensorState, ...l }) => l), pageNo: 1, pageSize: 1000, pages: 1, total: locks.length });
        case 'lock/queryOpenState': if (!gw()) return; return ok(res, { state: lock.state, sensorState: lock.sensorState, electricQuantity: lock.electricQuantity });
        case 'lock/lock': if (!gw()) return; lock.state = 0; log.push(`lock:${lock.lockId}`); return ok(res, { errcode: 0, errmsg: 'none error message' });
        case 'lock/unlock': if (!gw()) return; lock.state = 1; log.push(`unlock:${lock.lockId}`); return ok(res, { errcode: 0, errmsg: 'none error message' });
        case 'lock/listKeyboardPwd': return ok(res, { list: passcodes[lock.lockId] || [] });
        case 'keyboardPwd/add': {
          if (!gw()) return;
          if (!/^\d{4,9}$/.test(f.keyboardPwd || '')) return err(res, -3008, 'invalid passcode');
          const pc = { keyboardPwdId: nextId++, keyboardPwd: f.keyboardPwd, keyboardPwdName: f.keyboardPwdName, keyboardPwdType: Number(f.keyboardPwdType), startDate: Number(f.startDate), endDate: Number(f.endDate), addType: Number(f.addType) };
          passcodes[lock.lockId].push(pc);
          return ok(res, { keyboardPwdId: pc.keyboardPwdId });
        }
        case 'keyboardPwd/delete': {
          if (!gw()) return;
          const list = passcodes[lock.lockId];
          const i = list.findIndex((x) => x.keyboardPwdId === Number(f.keyboardPwdId));
          if (i < 0) return err(res, -1, 'passcode not found');
          list.splice(i, 1);
          return ok(res, { errcode: 0, errmsg: 'none error message' });
        }
      }
      err(res, 404, 'unknown');
    });
  });
  return { server, locks, passcodes, log, expireToken: () => { if (token) token.access_token = 'expired'; } };
}

module.exports = { createSimulator };

if (require.main === module) {
  const port = Number(process.argv[2]) || 8090;
  createSimulator().server.listen(port, () => console.log(`TTLock simulator on http://127.0.0.1:${port} (client cid/csec, host@example.com / secret)`));
}
