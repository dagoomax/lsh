// PM2 process manager configuration for Lightweight Smart Home.
//
//   npm install -g pm2            # one-time, installs PM2 globally
//   pm2 start ecosystem.config.js # start (or: npm run pm2:start)
//   pm2 save                      # persist the process list across reboots
//   pm2 startup                   # generate the boot-time service (run once)
//
// Single fork-mode instance on purpose: the server binds fixed HTTP(S),
// HomeKit, and RTSP ports and holds long-lived MQTT / WebSocket connections,
// so cluster mode would spawn rivals fighting over the same ports.
module.exports = {
  apps: [
    {
      name: 'lsh',
      script: 'server.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      // Raised from 300M: the optional object-detection module (TensorFlow.js
      // + COCO-SSD, CPU backend) adds a large fixed memory floor on top of
      // LSH's baseline — 300M was tripping constant restarts once it loaded.
      max_memory_restart: '1G',
      kill_timeout: 5000,
      env: {
        NODE_ENV: 'production',
      },
      // Capture PM2's own stdout/stderr alongside the app's category logs.
      // (The server also writes structured logs to logs/*.log via src/logger.js.)
      time: true,
      merge_logs: true,
      out_file: 'logs/pm2-out.log',
      error_file: 'logs/pm2-error.log',
    },
  ],
};
