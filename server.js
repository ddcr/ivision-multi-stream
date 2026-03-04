const express = require("express");
const fs = require("fs");
const path = require("path");
const { VideoStream } = require("rtsp-multi-stream");

const app = express();
const PORT = parseInt(process.env.PORT, 10) || 3000;
const BASE_WS_PORT = parseInt(process.env.BASE_WS_PORT, 10) || 10000;

const camerasPath = path.join(__dirname, "cameras.json");

let activeStreams = new Map();
let camerasMeta = [];

function loadCameras() {
  const raw = fs.readFileSync(camerasPath);
  const config = JSON.parse(raw);

  const newMeta = [];
  const newActive = new Map();

  config.forEach((cam, index) => {
    if (!cam.enabled) return;

    const wsPort = BASE_WS_PORT + index;

    if (!activeStreams.has(cam.name)) {
      console.log(`\n========================================`);
      console.log(`🎥 Starting ${cam.name}`);
      console.log(`   RTSP: ${cam.rtspUrl}`);
      console.log(`   WS Port: ${wsPort}`);
      console.log(`   FPS: ${cam.fps || 10}`);
      console.log(`========================================\n`);

      const stream = new VideoStream({
        debug: true,
        url: cam.rtspUrl,
        wsPort: wsPort,
        ffmpegPath: '/usr/bin/ffmpeg',
        ffmpegArgs: {
          "-r": cam.fps || 10,
        },
      });

      // Log all events emitted by the stream
      const originalEmit = stream.emit.bind(stream);
      stream.emit = function(event, ...args) {
        console.log(`[STREAM EVENT] ${cam.name} - ${event}:`, args);
        return originalEmit(event, ...args);
      };

      // Intercept all EventEmitter events
      const events = ['error', 'exit', 'liveErr', 'mpeg1data'];
      events.forEach(eventName => {
        stream.on(eventName, (...args) => {
          console.log(`[${cam.name}] Event: ${eventName}`,
            args.length > 0 ? args[0] : '(no data)');
        });
      });

      stream.start();

      // Detailed status check
      setTimeout(() => {
        console.log(`\n[STATUS CHECK] ${cam.name}:`);
        console.log(`  - WS Port: ${wsPort}`);
        console.log(`  - Live Muxers: ${stream.liveMuxers?.size || 0}`);
        console.log(`  - Muxer URLs: ${stream.liveMuxers ? 
          Array.from(stream.liveMuxers.keys()).join(', ') : 'none'}`);
        console.log(`  - WS Server exists: ${!!stream.wsServer}`);
        console.log(`  - WS Clients: ${stream.wsServer?.clients?.size || 0}\n`);
      }, 2000);

      newActive.set(cam.name, stream);
    } else {
      newActive.set(cam.name, activeStreams.get(cam.name));
    }

    newMeta.push({
      name: cam.name,
      wsPort: wsPort,
      location: cam.location
    });
  });

  // Stop removed streams
  activeStreams.forEach((stream, name) => {
    if (!newActive.has(name)) {
      console.log(`Stopping ${name}`);
      if (stream.stop) stream.stop();
    }
  });

  activeStreams = newActive;
  camerasMeta = newMeta;

  console.log("Active cameras:", camerasMeta.map(c => c.name));
}

// Initial load
loadCameras();

// Watch JSON file for changes
fs.watch(camerasPath, (eventType) => {
  if (eventType === "change") {
    console.log("cameras.json changed — reloading...");
    setTimeout(loadCameras, 500); // small delay to avoid partial read
  }
});

// API endpoint
app.get("/api/cameras", (req, res) => {
  res.json(camerasMeta);
});

app.use(express.static("public"));

app.listen(PORT, () => {
  console.log(`Web UI running at http://localhost:${PORT}`);
});
