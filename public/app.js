let players = [];
let cameraStates = new Map(); // Track which cameras are paused

const grid = document.getElementById("grid");
const layoutSelector = document.getElementById("layoutSelector");

function setLayout(size) {
  if (size === "auto") {
    grid.style.gridTemplateColumns = "repeat(auto-fit, minmax(300px, 1fr))";
  } else {
    grid.style.gridTemplateColumns = `repeat(${size}, 1fr)`;
  }
}

layoutSelector.addEventListener("change", (e) => {
  setLayout(e.target.value);
});

setLayout("auto");

function createPlayer(cam, canvas, status) {
  const wsUrl = `ws://${window.location.hostname}:${cam.wsPort}`;
  console.log(`Connecting to ${cam.name} at ${wsUrl}`);

  const player = new JSMpeg.Player(wsUrl, {
    canvas: canvas,
    autoplay: true,
    audio: false,
    onVideoDecode: () => {
      if (status.innerText !== "LIVE") {
        status.innerText = "LIVE";
        status.style.color = "#0f0";
        console.log(`${cam.name} is now streaming`);
      }
    },
    onSourceEstablished: () => {
      console.log(`${cam.name} WebSocket connected`);
    },
    onSourceCompleted: () => {
      console.log(`${cam.name} WebSocket closed`);
      status.innerText = "DISCONNECTED";
      status.style.color = "#f00";
    }
  });

  return player;
}

async function loadCameras() {
  const res = await fetch("/api/cameras");
  const cameras = await res.json();

  console.log("Loaded cameras:", cameras);

  grid.innerHTML = "";
  players.forEach(p => p.destroy && p.destroy());
  players = [];

  cameras.forEach(cam => {
    const wrapper = document.createElement("div");
    wrapper.className = "camera";

    const title = document.createElement("div");
    title.className = "camera-title";
    title.innerText = cam.name;

    const location = document.createElement("div");
    location.className = "camera-location";
    location.innerText = cam.location || "UNKNOWN";

    const status = document.createElement("div");
    status.className = "status";
    status.innerText = "CONNECTING...";

    const toggleBtn = document.createElement("button");
    toggleBtn.className = "toggle-btn";
    toggleBtn.innerText = "⏸ PAUSE";

    const canvas = document.createElement("canvas");

    wrapper.appendChild(title);
    wrapper.appendChild(location);
    wrapper.appendChild(status);
    wrapper.appendChild(toggleBtn);
    wrapper.appendChild(canvas);
    grid.appendChild(wrapper);

    // const wsUrl = `ws://${window.location.hostname}:${cam.wsPort}`;
    // console.log(`Connecting to ${cam.name} at ${wsUrl}`);
    //
    // const player = new JSMpeg.Player(wsUrl, {
    //   canvas: canvas,
    //   autoplay: true,
    //   audio: false,
    //   onVideoDecode: () => {
    //     if (status.innerText !== "LIVE") {
    //       status.innerText = "LIVE";
    //       status.style.color = "#0f0";
    //       console.log(`${cam.name} is now streaming`);
    //     }
    //   },
    //   onSourceEstablished: () => {
    //     console.log(`${cam.name} WebSocket connected`);
    //   },
    //   onSourceCompleted: () => {
    //     console.log(`${cam.name} WebSocket closed`);
    //     status.innerText = "DISCONNECTED";
    //     status.style.color = "#f00";
    //   }
    // });

    let player = null;

    // Check if this camera should start paused
    const isPaused = cameraStates.get(cam.name) === 'paused';

    if (!isPaused) {
      player = createPlayer(cam, canvas, status);
      players.push(player);
    } else {
      status.innerText = "PAUSED";
      status.style.color = "#ff8800";
      toggleBtn.innerText = "▶ PLAY";
      toggleBtn.classList.add("paused");
    }

    toggleBtn.onclick = () => {
      if (player) {
        // Currently playing - pause it
        console.log(`Pausing ${cam.name}`);
        player.pause();
        // player.destroy();
        player = null;
        players = players.filter(p => p !== player);

        status.innerText = "PAUSED";
        status.style.color = "#ff8800";
        toggleBtn.innerText = "▶ PLAY";
        toggleBtn.classList.add("paused");
        cameraStates.set(cam.name, 'paused');
      } else {
        // Currently paused - play it
        console.log(`Playing ${cam.name}`);
        player = createPlayer(cam, canvas, status);
        players.push(player);

        toggleBtn.innerText = "⏸ PAUSE";
        toggleBtn.classList.remove("paused");
        cameraStates.set(cam.name, 'playing');
      }
    };

    canvas.onclick = () => canvas.requestFullscreen();
  });
}

// Initial load
loadCameras();

// Poll every 60 seconds for changes
setInterval(loadCameras, 60000);
