# tuya-ipc-terminal patches

LSH's Tuya SD-card recordings (`src/routes/camera-sd.js`,
`scripts/tuya-sd-archive.js`) need these changes to
[seydx/tuya-ipc-terminal](https://github.com/seydx/tuya-ipc-terminal):
the `cameras recordings` command and RTSP `/<camera>/replay/<start>-<end>` paths.

Made against upstream `1dbb901`. To apply and build:

```bash
cd ~/tuya-ipc-terminal
git checkout -b replay-ptz 1dbb901
git am ~/lsh/docs/tuya-ipc-terminal/*.patch
go build -o tuya-ipc-terminal . && pm2 restart tuya-ipc
```
