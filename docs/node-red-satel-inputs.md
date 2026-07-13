# Node-RED: Reading Satel INTEGRA Inputs

This guide shows how to read Satel INTEGRA system inputs (e.g., battery status, AC mains, GSM, temperature) in Node-RED using the TCP protocol.

## Option 1: Via LSH Dashboard API (Recommended)

Use the LSH dashboard as a gateway to Satel. This avoids duplicating protocol logic.

### Prerequisites
- LSH dashboard running at 192.168.1.229:3001
- Satel inputs configured in `config.json`

### Node-RED Flow

Import this flow into Node-RED:

```json
{
  "id": "satel-inputs-flow",
  "label": "Satel Inputs via LSH",
  "nodes": [
    {
      "id": "satel-poll",
      "type": "inject",
      "props": [{"p": "payload"}],
      "repeat": "2",
      "crontab": "",
      "once": false,
      "onceDelay": 0.1,
      "topic": "",
      "payload": "",
      "payloadType": "date",
      "x": 100,
      "y": 100,
      "wires": [["http-get"]]
    },
    {
      "id": "http-get",
      "type": "http request",
      "method": "GET",
      "ret": "obj",
      "paytoqs": "ignore",
      "url": "http://localhost:3001/api/store?filter=satel/input",
      "tls": "",
      "persist": false,
      "proxy": "",
      "authType": "",
      "senderr": false,
      "x": 300,
      "y": 100,
      "wires": [["parse-inputs"]]
    },
    {
      "id": "parse-inputs",
      "type": "function",
      "func": "// Extract input states from store\nconst store = msg.payload;\nconst inputs = {};\n\nfor (const [key, value] of Object.entries(store)) {\n  if (key.startsWith('satel/input/')) {\n    const parts = key.split('/');\n    const inputNum = parts[2];\n    const inputProp = parts[3]; // 'state'\n    \n    if (!inputs[inputNum]) inputs[inputNum] = {};\n    inputs[inputNum][inputProp] = value;\n  }\n}\n\nmsg.payload = inputs;\nreturn msg;",
      "outputs": 1,
      "x": 500,
      "y": 100,
      "wires": [["debug"]]
    },
    {
      "id": "debug",
      "type": "debug",
      "active": true,
      "tosidebar": true,
      "console": false,
      "tostatus": false,
      "complete": "payload",
      "targetType": "msg",
      "statusVal": "",
      "statusType": "auto",
      "x": 700,
      "y": 100,
      "wires": []
    }
  ]
}
```

## Option 2: Direct TCP Connection to Satel Panel

Connect directly to Satel INTEGRA using TCP protocol.

### Configuration
- **Host**: 192.168.1.179
- **Port**: 7096
- **Command**: 0x15 (CMD_INPUTS_STATE)

### Node-RED Function Node

Create a function node with this code to read inputs:

```javascript
// Satel INTEGRA input reader
const net = require('net');

const HOST = '192.168.1.179';
const PORT = 7096;
const CMD_INPUTS_STATE = 0x15;

function crc16(data) {
  let crc = 0x147A;
  for (const b of data) {
    crc = ((crc << 1) & 0xFFFF) | (crc >> 15);
    crc ^= 0xFFFF;
    crc = (crc + (crc >> 8) + b) & 0xFFFF;
  }
  return crc;
}

function escapeFE(buf) {
  const out = [];
  for (const b of buf) {
    out.push(b);
    if (b === 0xFE) out.push(0xFD);
  }
  return Buffer.from(out);
}

function buildFrame(payload) {
  const c = crc16(payload);
  const full = Buffer.concat([payload, Buffer.from([c >> 8, c & 0xFF])]);
  return Buffer.concat([Buffer.from([0xFE, 0xFE]), escapeFE(full), Buffer.from([0xFE, 0x0D])]);
}

function unescapeFE(buf) {
  const out = [];
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0xFE && i + 1 < buf.length && buf[i + 1] === 0xFD) {
      out.push(0xFE);
      i++;
    } else {
      out.push(buf[i]);
    }
  }
  return Buffer.from(out);
}

function getBit(data, num) {
  if (!data) return false;
  const b = Math.floor((num - 1) / 8);
  const bit = (num - 1) % 8;
  return data[b] != null && !!(data[b] & (1 << bit));
}

const socket = net.createConnection(PORT, HOST);
let rxBuf = Buffer.alloc(0);
let inputData = null;

socket.on('data', (chunk) => {
  rxBuf = Buffer.concat([rxBuf, chunk]);
  
  let i = 0;
  while (i < rxBuf.length - 1) {
    if (rxBuf[i] !== 0xFE || rxBuf[i + 1] !== 0xFE) {
      i++;
      continue;
    }
    
    let j = i + 2;
    while (j < rxBuf.length - 1) {
      if (rxBuf[j] === 0xFE && rxBuf[j + 1] === 0x0D) break;
      if (rxBuf[j] === 0xFE && j + 1 < rxBuf.length) j += 2;
      else j++;
    }
    
    if (j >= rxBuf.length - 1) break;
    
    const raw = unescapeFE(rxBuf.slice(i + 2, j));
    if (raw.length >= 3) {
      const payload = raw.slice(0, -2);
      const recv = (raw[raw.length - 2] << 8) | raw[raw.length - 1];
      
      if (crc16(payload) === recv && payload[0] === CMD_INPUTS_STATE) {
        inputData = payload.slice(1);
      }
    }
    i = j + 2;
  }
  rxBuf = rxBuf.slice(i);
});

socket.on('connect', () => {
  const frame = buildFrame(Buffer.from([CMD_INPUTS_STATE]));
  socket.write(frame);
});

socket.on('error', (err) => {
  node.error(`Satel connection error: ${err.message}`);
  socket.destroy();
});

setTimeout(() => {
  if (inputData) {
    const inputs = {};
    for (let n = 1; n <= 128; n++) {
      inputs[n] = getBit(inputData, n) ? 1 : 0;
    }
    msg.payload = inputs;
    node.send(msg);
  } else {
    node.error('No input data received');
  }
  socket.destroy();
}, 1000);
```

## Input Numbers Reference

Typical Satel INTEGRA system inputs:

| Input | Purpose |
|-------|---------|
| 1-7 | System inputs (varies by configuration) |
| 8 | Battery status |
| 9 | AC mains power |
| 12 | GSM module status |
| 13 | Temperature sensor |

Check your Satel panel configuration for exact input mapping.

## Testing

1. **Via LSH**: http://192.168.1.229:3001/api/store?filter=satel/input
2. **Via Node-RED**: Deploy the flow and check the debug output
3. **Via Dashboard**: Check the Satel inputs section

## Data Format

Inputs return 0 (inactive) or 1 (active):

```json
{
  "8": 1,    // Battery OK
  "9": 1,    // AC power OK
  "12": 1,   // GSM connected
  "13": 0    // Temperature below threshold
}
```

## Troubleshooting

- **Connection refused**: Satel panel not accessible at 192.168.1.179:7096
- **No data**: Check if inputs are configured in Satel panel
- **Intermittent reads**: Network timeout (increase timeout in code)

See `src/satel-client.js` for protocol details.
