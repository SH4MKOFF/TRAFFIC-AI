"use strict";

/* =====================================================
   GHOST // AI EVENT CAMERA
===================================================== */


/* =========================
   DOM
========================= */

const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

const startBtn = document.getElementById("startBtn");

const zoomSlider =
  document.getElementById("zoomSlider");

const zoomValue =
  document.getElementById("zoomValue");

const statusDot =
  document.getElementById("statusDot");

const statusText =
  document.getElementById("statusText");

const recIndicator =
  document.getElementById("recIndicator");

const cameraMessage =
  document.getElementById("cameraMessage");

const cameraEvent =
  document.getElementById("cameraEvent");

const cameraEventText =
  document.getElementById("cameraEventText");

const cameraResolution =
  document.getElementById("cameraResolution");

const fpsLabel =
  document.getElementById("fpsLabel");

const visibleCount =
  document.getElementById("visibleCount");

const uniqueCount =
  document.getElementById("uniqueCount");

const movedCount =
  document.getElementById("movedCount");

const eventCount =
  document.getElementById("eventCount");

const lastEventTitle =
  document.getElementById("lastEventTitle");

const lastEventBody =
  document.getElementById("lastEventBody");

const eventTime =
  document.getElementById("eventTime");

const summaryText =
  document.getElementById("summaryText");

const sessionTime =
  document.getElementById("sessionTime");

const timelineCount =
  document.getElementById("timelineCount");

const eventLog =
  document.getElementById("eventLog");

const objectList =
  document.getElementById("objectList");

const objectCountLabel =
  document.getElementById("objectCountLabel");

const archiveGrid =
  document.getElementById("archiveGrid");

const archiveCount =
  document.getElementById("archiveCount");

const activityBars =
  document.getElementById("activityBars");

const saveSession =
  document.getElementById("saveSession");

const clearArchive =
  document.getElementById("clearArchive");

const rulePerson =
  document.getElementById("rulePerson");

const ruleVehicle =
  document.getElementById("ruleVehicle");

const ruleMovement =
  document.getElementById("ruleMovement");

const ruleAlert =
  document.getElementById("ruleAlert");


/* =========================
   CONFIG
========================= */

const INTEREST_CLASSES = [
  "person",
  "car",
  "truck",
  "bus",
  "motorcycle",
  "bicycle",
  "dog",
  "cat",
  "backpack",
  "handbag",
  "suitcase",
  "cell phone",
  "laptop",
  "bottle",
  "cup"
];

const VEHICLES = [
  "car",
  "truck",
  "bus",
  "motorcycle",
  "bicycle"
];

const MATCH_DISTANCE = 95;
const MOVEMENT_DISTANCE = 25;
const MAX_TRACK_AGE = 1200;

let model = null;
let stream = null;
let videoTrack = null;

let running = false;
let detecting = false;

let tracks = [];
let nextTrackId = 1;

let events = [];
let archive = [];

let currentFilter = "all";

let sessionStarted = null;
let sessionTimer = null;

let activity = [];

let lastDetectionTime = 0;
let detectionFrames = 0;


/* =========================
   HELPERS
========================= */

function timeNow() {

  return new Date().toLocaleTimeString(
    "uk-UA",
    {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    }
  );
}


function duration(seconds) {

  const h =
    Math.floor(seconds / 3600);

  const m =
    Math.floor(
      (seconds % 3600) / 60
    );

  const s =
    seconds % 60;

  if (h) {

    return (
      String(h).padStart(2, "0") +
      ":" +
      String(m).padStart(2, "0") +
      ":" +
      String(s).padStart(2, "0")
    );
  }

  return (
    String(m).padStart(2, "0") +
    ":" +
    String(s).padStart(2, "0")
  );
}


function icon(type) {

  if (type === "person") return "👤";

  if (VEHICLES.includes(type))
    return "🚗";

  if (type === "dog")
    return "🐕";

  if (type === "cat")
    return "🐈";

  if (type === "bicycle")
    return "🚲";

  return "◈";
}


function category(type) {

  if (type === "person")
    return "person";

  if (VEHICLES.includes(type))
    return "vehicle";

  return "other";
}


function typeName(type) {

  const names = {

    person: "PERSON",

    car: "VEHICLE",

    truck: "TRUCK",

    bus: "BUS",

    motorcycle: "MOTORCYCLE",

    bicycle: "BICYCLE",

    dog: "DOG",

    cat: "CAT",

    backpack: "BACKPACK",

    handbag: "BAG",

    suitcase: "SUITCASE",

    "cell phone": "PHONE",

    laptop: "LAPTOP",

    bottle: "BOTTLE",

    cup: "CUP"

  };

  return names[type] || type.toUpperCase();
}


function center(box) {

  return {

    x: box[0] + box[2] / 2,

    y: box[1] + box[3] / 2

  };
}


function distance(a, b) {

  return Math.sqrt(
    Math.pow(a.x - b.x, 2) +
    Math.pow(a.y - b.y, 2)
  );
}


function direction(dx, dy) {

  if (
    Math.abs(dx) < 8 &&
    Math.abs(dy) < 8
  ) {
    return "—";
  }

  if (
    Math.abs(dx) >= Math.abs(dy)
  ) {
    return dx > 0 ? "→" : "←";
  }

  return dy > 0 ? "↓" : "↑";
}


/* =========================
   START
========================= */

startBtn.addEventListener(
  "click",
  async () => {

    if (running) {

      stopMonitoring();

    } else {

      await startMonitoring();

    }

  }
);


async function startMonitoring() {

  try {

    resetSession();

    startBtn.disabled = true;

    statusText.textContent =
      "STARTING";

    cameraMessage.classList.remove(
      "hidden"
    );

    cameraMessage.querySelector(
      "strong"
    ).textContent =
      "STARTING CAMERA";

    cameraMessage.querySelector(
      "span"
    ).textContent =
      "Надання доступу до камери...";


    stream =
      await navigator.mediaDevices.getUserMedia(
        {
          video: {

            facingMode: {
              ideal: "environment"
            },

            width: {
              ideal: 1920
            },

            height: {
              ideal: 1080
            }

          },

          audio: false
        }
      );


    video.srcObject = stream;

    await video.play();


    videoTrack =
      stream.getVideoTracks()[0];


    canvas.width =
      video.videoWidth;

    canvas.height =
      video.videoHeight;


    cameraResolution.textContent =
      `${video.videoWidth}×${video.videoHeight}`;


    await setupZoom();


    if (!model) {

      cameraMessage.querySelector(
        "strong"
      ).textContent =
        "LOADING AI";

      cameraMessage.querySelector(
        "span"
      ).textContent =
        "Завантаження моделі...";


      model =
        await cocoSsd.load(
          {
            base: "mobilenet_v2"
          }
        );
    }


    running = true;
    detecting = true;

    sessionStarted =
      Date.now();


    sessionTimer =
      setInterval(
        updateTimer,
        1000
      );


    statusText.textContent =
      "MONITORING";

    statusDot.className =
      "status-dot online";


    recIndicator.classList.remove(
      "hidden"
    );


    cameraMessage.classList.add(
      "hidden"
    );


    startBtn.disabled = false;

    startBtn.classList.add(
      "running"
    );

    startBtn.innerHTML = `
      <span class="start-icon">■</span>
      <span>STOP MONITORING</span>
    `;


    fpsLabel.textContent =
      "AI ACTIVE";


    detectLoop();

  } catch (error) {

    console.error(error);

    stopMonitoring();

    statusText.textContent =
      "CAMERA ERROR";

    statusDot.className =
      "status-dot alert";

    cameraMessage.classList.remove(
      "hidden"
    );

    cameraMessage.querySelector(
      "strong"
    ).textContent =
      "CAMERA ERROR";

    cameraMessage.querySelector(
      "span"
    ).textContent =
      "Перевірте дозвіл на використання камери.";

  }

}


/* =========================
   STOP
========================= */

function stopMonitoring() {

  running = false;
  detecting = false;

  if (sessionTimer) {

    clearInterval(
      sessionTimer
    );

    sessionTimer = null;
  }


  if (stream) {

    stream
      .getTracks()
      .forEach(
        track => track.stop()
      );
  }


  stream = null;
  videoTrack = null;

  video.srcObject = null;


  ctx.clearRect(
    0,
    0,
    canvas.width,
    canvas.height
  );


  statusText.textContent =
    "READY";

  statusDot.className =
    "status-dot";


  recIndicator.classList.add(
    "hidden"
  );


  cameraEvent.classList.add(
    "hidden"
  );


  cameraMessage.classList.remove(
    "hidden"
  );


  cameraMessage.querySelector(
    "strong"
  ).textContent =
    "GHOST READY";


  cameraMessage.querySelector(
    "span"
  ).textContent =
    "Натисніть START MONITORING";


  startBtn.classList.remove(
    "running"
  );


  startBtn.innerHTML = `
    <span class="start-icon">▶</span>
    <span>START MONITORING</span>
  `;


  zoomSlider.disabled = true;

  fpsLabel.textContent =
    "AI READY";

}


/* =========================
   RESET
========================= */

function resetSession() {

  tracks = [];

  nextTrackId = 1;

  events = [];

  archive = [];

  activity = [];

  eventCount.textContent = "0";
  visibleCount.textContent = "0";
  uniqueCount.textContent = "0";
  movedCount.textContent = "0";

  timelineCount.textContent = "0";
  objectCountLabel.textContent = "0";
  archiveCount.textContent = "0";

  sessionTime.textContent =
    "00:00";


  lastEventTitle.textContent =
    "Waiting for activity";

  lastEventBody.textContent =
    "GHOST очікує на першу подію.";

  eventTime.textContent =
    "--:--:--";


  summaryText.textContent =
    "Запустіть моніторинг — GHOST почне збирати події та активність.";


  eventLog.innerHTML = `
    <div class="empty-state">
      <div>◌</div>
      Подій ще немає
    </div>
  `;


  objectList.innerHTML = `
    <div class="empty-state">
      Об'єкти не виявлені
    </div>
  `;


  archiveGrid.innerHTML = "";

  activityBars.innerHTML = "";

}


/* =========================
   ZOOM
========================= */

async function setupZoom() {

  if (!videoTrack)
    return;


  try {

    const capabilities =
      videoTrack.getCapabilities();


    if (!capabilities.zoom) {

      zoomSlider.disabled = true;

      return;
    }


    zoomSlider.min =
      capabilities.zoom.min;

    zoomSlider.max =
      capabilities.zoom.max;

    zoomSlider.step =
      capabilities.zoom.step || 0.1;


    const settings =
      videoTrack.getSettings();


    const current =
      settings.zoom ||
      capabilities.zoom.min;


    zoomSlider.value =
      current;


    zoomValue.textContent =
      `${Number(current).toFixed(1)}×`;


    zoomSlider.disabled =
      false;

  } catch (error) {

    console.warn(
      "Zoom unavailable",
      error
    );

  }

}


zoomSlider.addEventListener(
  "input",
  async () => {

    if (!videoTrack)
      return;


    const value =
      Number(zoomSlider.value);


    zoomValue.textContent =
      `${value.toFixed(1)}×`;


    try {

      await videoTrack.applyConstraints(
        {
          advanced: [
            {
              zoom: value
            }
          ]
        }
      );

    } catch (error) {

      console.warn(
        "Zoom failed",
        error
      );

    }

  }
);


/* =========================
   AI LOOP
========================= */

async function detectLoop() {

  if (
    !running ||
    !detecting ||
    !model
  ) {
    return;
  }


  const start =
    performance.now();


  try {

    const predictions =
      await model.detect(
        video,
        20,
        0.35
      );


    const visible =
      predictions.filter(
        prediction =>
          INTEREST_CLASSES.includes(
            prediction.class
          )
      );


    processObjects(
      visible
    );


    const elapsed =
      performance.now() - start;


    if (elapsed > 0) {

      const fps =
        1000 / elapsed;

      fpsLabel.textContent =
        `AI ${Math.min(
          30,
          Math.round(fps)
        )} FPS`;

    }

  } catch (error) {

    console.error(
      "Detection error:",
      error
    );

  }


  if (running) {

    setTimeout(
      detectLoop,
      160
    );

  }

}


/* =========================
   PROCESS
========================= */

function processObjects(predictions) {

  const now =
    Date.now();

  const updated =
    [];

  const used =
    new Set();


  predictions.forEach(
    prediction => {

      const c =
        center(
          prediction.bbox
        );


      let best = null;
      let bestDistance =
        Infinity;


      tracks.forEach(
        track => {

          if (
            used.has(track.id)
          ) {
            return;
          }

          if (
            track.type !==
            prediction.class
          ) {
            return;
          }


          const d =
            distance(
              c,
              track.center
            );


          if (
            d <
            bestDistance &&
            d <=
            MATCH_DISTANCE
          ) {

            bestDistance =
              d;

            best =
              track;

          }

        }
      );


      if (best) {

        used.add(
          best.id
        );


        const dx =
          c.x -
          best.center.x;


        const dy =
          c.y -
          best.center.y;


        const moved =
          Math.sqrt(
            dx * dx +
            dy * dy
          ) >=
          MOVEMENT_DISTANCE;


        best.direction =
          direction(
            dx,
            dy
          );


        best.center =
          c;

        best.bbox =
          prediction.bbox;

        best.score =
          prediction.score;

        best.lastSeen =
          now;


        if (moved) {

          best.moved =
            true;


          if (
            ruleMovement.checked &&
            now -
            best.lastMovementEvent >
            2000
          ) {

            best.lastMovementEvent =
              now;


            createEvent(
              best,
              "MOVING"
            );

          }

        }


        updated.push(
          best
        );


      } else {

        const track = {

          id:
            nextTrackId++,

          type:
            prediction.class,

          bbox:
            prediction.bbox,

          center:
            c,

          score:
            prediction.score,

          firstSeen:
            now,

          lastSeen:
            now,

          moved:
            false,

          crossed:
            false,

          direction:
            "—",

          previousX:
            c.x,

          lastMovementEvent:
            0,

          image:
            null

        };


        updated.push(
          track
        );


        createEvent(
          track,
          "DETECTED"
        );


        captureSnapshot(
          track
        );

      }

    }
  );


  tracks =
    updated.concat(
      tracks.filter(
        old => {

          return (
            !updated.some(
              x =>
                x.id === old.id
            ) &&
            now -
            old.lastSeen <
            MAX_TRACK_AGE
          );

        }
      )
    );


  checkCrossings(
    updated
  );


  draw(
    updated
  );


  visibleCount.textContent =
    updated.length;


  uniqueCount.textContent =
    nextTrackId - 1;


  movedCount.textContent =
    archive.filter(
      a => a.moved
    ).length;


  renderObjects(
    updated
  );


  detectionFrames++;


  if (
    detectionFrames % 8 === 0
  ) {

    activity.push(
      {
        count:
          updated.length,

        time:
          now
      }
    );


    if (
      activity.length > 45
    ) {

      activity.shift();

    }


    renderActivity();

  }


  updateSummary();

}


/* =========================
   CROSSING
========================= */

function checkCrossings(objects) {

  const lineX =
    canvas.width * 0.5;


  objects.forEach(
    track => {

      if (
        typeof track.previousX !==
        "number"
      ) {

        track.previousX =
          track.center.x;

        return;

      }


      const previous =
        track.previousX;

      const current =
        track.center.x;


      const leftToRight =
        previous <
          lineX &&
        current >=
          lineX;


      const rightToLeft =
        previous >
          lineX &&
        current <=
          lineX;


      if (
        (
          leftToRight ||
          rightToLeft
        ) &&
        !track.crossed
      ) {

        track.crossed =
          true;


        track.direction =
          leftToRight
            ? "→"
            : "←";


        const cat =
          category(
            track.type
          );


        const allowed =
          cat === "person"
            ? rulePerson.checked
            : cat === "vehicle"
              ? ruleVehicle.checked
              : true;


        if (allowed) {

          createEvent(
            track,
            "ENTER",
            {
              direction:
                track.direction
            }
          );

        }

      }


      track.previousX =
        current;

    }
  );

}


/* =========================
   EVENT
========================= */

function createEvent(
  track,
  eventType,
  extra = {}
) {

  const event = {

    id:
      Date.now() +
      Math.random(),

    type:
      eventType,

    objectType:
      track.type,

    trackId:
      track.id,

    confidence:
      track.score,

    time:
      timeNow(),

    timestamp:
      Date.now(),

    direction:
      extra.direction ||
      track.direction ||
      "—",

    image:
      track.image

  };


  events.unshift(
    event
  );


  if (
    events.length > 120
  ) {

    events.pop();

  }


  eventCount.textContent =
    events.length;


  renderEvents();

  showLastEvent(
    event
  );


  if (
    eventType !==
      "DETECTED" &&
    ruleAlert.checked
  ) {

    alertEvent();

  }


  updateArchive(
    track
  );

}


/* =========================
   ALERT
========================= */

function alertEvent() {

  statusDot.className =
    "status-dot alert";


  cameraEvent.classList.remove(
    "hidden"
  );


  if (
    navigator.vibrate
  ) {

    navigator.vibrate(
      [
        100,
        70,
        100
      ]
    );

  }


  setTimeout(
    () => {

      if (running) {

        statusDot.className =
          "status-dot online";

      }

    },
    1300
  );

}


/* =========================
   LAST EVENT
========================= */

function showLastEvent(
  event
) {

  const ico =
    icon(
      event.objectType
    );


  const name =
    typeName(
      event.objectType
    );


  const directionText =
    event.direction !== "—"
      ? ` ${event.direction}`
      : "";


  lastEventTitle.textContent =
    `${ico} ${name} ${event.type}${directionText}`;


  lastEventBody.innerHTML = `
    Object #${event.trackId}
    · confidence
    ${(event.confidence * 100).toFixed(0)}%
    <br>
    ${
      event.type === "DETECTED"
        ? "Новий об'єкт з'явився у кадрі."
        : "GHOST зафіксував активність об'єкта."
    }
  `;


  eventTime.textContent =
    event.time;


  cameraEventText.textContent =
    `${ico} ${name} ${event.type}`;


  cameraEvent.classList.remove(
    "hidden"
  );


  clearTimeout(
    cameraEvent._timer
  );


  cameraEvent._timer =
    setTimeout(
      () => {

        cameraEvent.classList.add(
          "hidden"
        );

      },
      4000
    );

}


/* =========================
   EVENTS RENDER
========================= */

function renderEvents() {

  const filtered =
    events.filter(
      event => {

        if (
          currentFilter ===
          "all"
        ) {
          return true;
        }


        return (
          category(
            event.objectType
          ) ===
          currentFilter
        );

      }
    );


  timelineCount.textContent =
    filtered.length;


  if (!filtered.length) {

    eventLog.innerHTML = `
      <div class="empty-state">
        <div>◌</div>
        Подій ще немає
      </div>
    `;

    return;

  }


  eventLog.innerHTML =
    filtered
      .slice(0, 60)
      .map(
        event => {

          return `
            <div class="event-row">

              <span class="event-time">
                ${event.time}
              </span>

              <span class="event-icon">
                ${icon(event.objectType)}
              </span>

              <span class="event-main">

                ${event.type}
                ${
                  event.direction !== "—"
                    ? ` ${event.direction}`
                    : ""
                }

                <span class="event-sub">
                  ${typeName(
                    event.objectType
                  )}
                  · OBJECT #${event.trackId}
                  · ${(
                    event.confidence * 100
                  ).toFixed(0)}%
                </span>

              </span>

            </div>
          `;

        }
      )
      .join("");

}


/* =========================
   FILTERS
========================= */

document
  .querySelectorAll(
    ".filter"
  )
  .forEach(
    button => {

      button.addEventListener(
        "click",
        () => {

          document
            .querySelectorAll(
              ".filter"
            )
            .forEach(
              b =>
                b.classList.remove(
                  "active"
                )
            );


          button.classList.add(
            "active"
          );


          currentFilter =
            button.dataset.filter;


          renderEvents();

        }
      );

    }
  );


/* =========================
   SECTION NAV
========================= */

document
  .querySelectorAll(
    ".nav-button"
  )
  .forEach(
    button => {

      button.addEventListener(
        "click",
        () => {

          document
            .querySelectorAll(
              ".nav-button"
            )
            .forEach(
              b =>
                b.classList.remove(
                  "active"
                )
            );


          document
            .querySelectorAll(
              ".content-section"
            )
            .forEach(
              section =>
                section.classList.remove(
                  "active-section"
                )
            );


          button.classList.add(
            "active"
          );


          const target =
            document.getElementById(
              `section-${button.dataset.section}`
            );


          if (target) {

            target.classList.add(
              "active-section"
            );

          }

        }
      );

    }
  );


/* =========================
   DRAW
========================= */

function draw(objects) {

  ctx.clearRect(
    0,
    0,
    canvas.width,
    canvas.height
  );


  objects.forEach(
    track => {

      const [
        x,
        y,
        w,
        h
      ] =
        track.bbox;


      ctx.strokeStyle =
        track.moved
          ? "#ff6565"
          : "#9effb1";


      ctx.lineWidth = 2;


      ctx.strokeRect(
        x,
        y,
        w,
        h
      );


      const label =
        `${typeName(
          track.type
        )} ${(
          track.score * 100
        ).toFixed(0)}%`;


      ctx.font =
        "bold 12px Arial";


      const width =
        ctx.measureText(
          label
        ).width;


      ctx.fillStyle =
        track.moved
          ? "#ff6565"
          : "#9effb1";


      ctx.fillRect(
        x,
        Math.max(
          0,
          y - 21
        ),
        width + 12,
        21
      );


      ctx.fillStyle =
        "#061008";


      ctx.fillText(
        label,
        x + 6,
        Math.max(
          14,
          y - 7
        )
      );


      if (
        track.direction !==
        "—"
      ) {

        ctx.fillStyle =
          track.moved
            ? "#ff6565"
            : "#9effb1";


        ctx.font =
          "bold 23px Arial";


        ctx.fillText(
          track.direction,
          x + w / 2 - 8,
          y + h / 2
        );

      }

    }
  );


  /* CENTER LINE */

  const lineX =
    canvas.width * 0.5;


  ctx.beginPath();

  ctx.setLineDash(
    [
      8,
      8
    ]
  );

  ctx.moveTo(
    lineX,
    0
  );

  ctx.lineTo(
    lineX,
    canvas.height
  );


  ctx.strokeStyle =
    "rgba(158,255,177,.42)";


  ctx.lineWidth = 1;

  ctx.stroke();

  ctx.setLineDash([]);

}


/* =========================
   OBJECT LIST
========================= */

function renderObjects(
  objects
) {

  objectCountLabel.textContent =
    objects.length;


  if (!objects.length) {

    objectList.innerHTML = `
      <div class="empty-state">
        Об'єкти не виявлені
      </div>
    `;

    return;

  }


  objectList.innerHTML =
    objects
      .map(
        track => {

          return `
            <div class="object-row">

              <div>

                <div class="object-name">
                  ${icon(track.type)}
                  ${typeName(
                    track.type
                  )}
                </div>

                <div class="object-meta">
                  OBJECT #${track.id}
                  · ${track.direction}
                  ${
                    track.moved
                      ? " · MOVING"
                      : ""
                  }
                </div>

              </div>

              <div class="object-confidence">
                ${(
                  track.score * 100
                ).toFixed(0)}%
              </div>

            </div>
          `;

        }
      )
      .join("");

}


/* =========================
   SNAPSHOT
========================= */

function captureSnapshot(
  track
) {

  try {

    if (
      !video.videoWidth
    ) {
      return;
    }


    const [
      x,
      y,
      w,
      h
    ] =
      track.bbox;


    const padding = 18;


    const sx =
      Math.max(
        0,
        x - padding
      );


    const sy =
      Math.max(
        0,
        y - padding
      );


    const sw =
      Math.min(
        video.videoWidth - sx,
        w + padding * 2
      );


    const sh =
      Math.min(
        video.videoHeight - sy,
        h + padding * 2
      );


    const c =
      document.createElement(
        "canvas"
      );


    c.width =
      Math.max(
        1,
        Math.floor(sw)
      );


    c.height =
      Math.max(
        1,
        Math.floor(sh)
      );


    const cctx =
      c.getContext("2d");


    cctx.drawImage(
      video,
      sx,
      sy,
      sw,
      sh,
      0,
      0,
      c.width,
      c.height
    );


    track.image =
      c.toDataURL(
        "image/jpeg",
        .78
      );


    updateArchive(
      track
    );

  } catch (error) {

    console.warn(
      "Snapshot failed",
      error
    );

  }

}


/* =========================
   ARCHIVE
========================= */

function updateArchive(
  track
) {

  let item =
    archive.find(
      x =>
        x.id ===
        track.id
    );


  if (!item) {

    item = {

      id:
        track.id,

      type:
        track.type,

      confidence:
        track.score,

      firstSeen:
        timeNow(),

      lastSeen:
        timeNow(),

      moved:
        track.moved,

      crossed:
        track.crossed,

      direction:
        track.direction,

      image:
        track.image

    };


    archive.push(
      item
    );

  } else {

    item.lastSeen =
      timeNow();


    item.confidence =
      Math.max(
        item.confidence,
        track.score
      );


    item.moved =
      item.moved ||
      track.moved;


    item.crossed =
      item.crossed ||
      track.crossed;


    if (
      track.direction !==
      "—"
    ) {

      item.direction =
        track.direction;

    }


    if (
      track.image &&
      !item.image
    ) {

      item.image =
        track.image;

    }

  }


  renderArchive();

}


/* =========================
   ARCHIVE RENDER
========================= */

function renderArchive() {

  archiveCount.textContent =
    archive.length;


  if (!archive.length) {

    archiveGrid.innerHTML =
      `
      <div class="empty-state">
        Архів порожній
      </div>
      `;

    return;

  }


  archiveGrid.innerHTML =
    archive
      .slice()
      .reverse()
      .map(
        item => {

          return `
            <div class="archive-card">

              ${
                item.image
                  ? `
                    <img
                      src="${item.image}"
                      alt=""
                    >
                  `
                  : ""
              }

              <div class="archive-info">

                <div class="archive-type">
                  ${icon(item.type)}
                  ${typeName(
                    item.type
                  )}
                </div>

                <div class="archive-detail">

                  OBJECT #${item.id}<br>

                  CONFIDENCE
                  ${(
                    item.confidence *
                    100
                  ).toFixed(0)}%<br>

                  ${item.direction}
                  ${
                    item.moved
                      ? " · MOVING"
                      : ""
                  }

                </div>

              </div>

            </div>
          `;

        }
      )
      .join("");

}


/* =========================
   SUMMARY
========================= */

function updateSummary() {

  if (!sessionStarted)
    return;


  const people =
    archive.filter(
      a =>
        a.type ===
        "person"
    ).length;


  const vehicles =
    archive.filter(
      a =>
        VEHICLES.includes(
          a.type
        )
    ).length;


  const animals =
    archive.filter(
      a =>
        a.type === "dog" ||
        a.type === "cat"
    ).length;


  const movements =
    events.filter(
      e =>
        e.type ===
        "MOVING"
    ).length;


  const entries =
    events.filter(
      e =>
        e.type ===
        "ENTER"
    ).length;


  summaryText.innerHTML = `

    <strong>
      ${events.length}
    </strong>
    events detected during
    <strong>
      ${duration(
        Math.floor(
          (
            Date.now() -
            sessionStarted
          ) / 1000
        )
      )}
    </strong>.

    <br><br>

    👤
    ${people}
    people
    ·
    🚗
    ${vehicles}
    vehicles
    ·
    🐾
    ${animals}
    animals

    <br>

    ${movements}
    movement events
    ·
    ${entries}
    zone crossings

  `;

}


/* =========================
   TIMER
========================= */

function updateTimer() {

  if (!sessionStarted)
    return;


  const seconds =
    Math.floor(
      (
        Date.now() -
        sessionStarted
      ) / 1000
    );


  sessionTime.textContent =
    duration(
      seconds
    );


  updateSummary();

}


/* =========================
   ACTIVITY
========================= */

function renderActivity() {

  if (!activity.length) {

    activityBars.innerHTML =
      "";

    return;

  }


  const max =
    Math.max(
      1,
      ...activity.map(
        x =>
          x.count
      )
    );


  activityBars.innerHTML =
    activity
      .map(
        point => {

          const height =
            Math.max(
              3,
              (
                point.count /
                max
              ) * 75
            );


          return `
            <div
              class="activity-bar"
              style="
                height:${height}px
              "
            ></div>
          `;

        }
      )
      .join("");

}


/* =========================
   SAVE
========================= */

saveSession.addEventListener(
  "click",
  () => {

    if (!archive.length) {

      alert(
        "Архів порожній."
      );

      return;

    }


    const cards =
      archive
        .slice()
        .reverse()
        .map(
          item => {

            return `
              <article>

                ${
                  item.image
                    ? `<img src="${item.image}">`
                    : ""
                }

                <h2>
                  ${icon(item.type)}
                  ${typeName(
                    item.type
                  )}
                </h2>

                <p>

                  OBJECT #${item.id}<br>

                  Confidence:
                  ${(
                    item.confidence *
                    100
                  ).toFixed(0)}%<br>

                  Direction:
                  ${item.direction}<br>

                  Moving:
                  ${item.moved
                    ? "YES"
                    : "NO"}<br>

                  Crossed:
                  ${item.crossed
                    ? "YES"
                    : "NO"}<br>

                  First seen:
                  ${item.firstSeen}<br>

                  Last seen:
                  ${item.lastSeen}

                </p>

              </article>
            `;

          }
        )
        .join("");


    const html = `
<!DOCTYPE html>

<html>

<head>

<meta charset="UTF-8">

<meta
  name="viewport"
  content="width=device-width,
  initial-scale=1"
>

<title>
GHOST SESSION
</title>

<style>

body{
  margin:0;
  padding:25px;
  background:#07090d;
  color:#edf4ef;
  font-family:Arial,sans-serif;
}

h1{
  letter-spacing:5px;
}

.grid{
  display:grid;
  grid-template-columns:
  repeat(auto-fit,
  minmax(220px,1fr));
  gap:14px;
}

article{
  overflow:hidden;
  background:#0b0f0d;
  border:1px solid #202824;
  border-radius:12px;
}

article img{
  display:block;
  width:100%;
}

article h2,
article p{
  padding:0 14px;
}

p{
  color:#91a097;
  line-height:1.8;
  font-size:12px;
}

</style>

</head>

<body>

<h1>
GHOST // SESSION
</h1>

<p>
AI Event Camera Archive
</p>

<div class="grid">

${cards}

</div>

</body>

</html>
`;


    const blob =
      new Blob(
        [html],
        {
          type:
            "text/html"
        }
      );


    const url =
      URL.createObjectURL(
        blob
      );


    const a =
      document.createElement(
        "a"
      );


    a.href = url;


    a.download =
      `GHOST_SESSION_${
        Date.now()
      }.html`;


    a.click();


    setTimeout(
      () =>
        URL.revokeObjectURL(
          url
        ),
      1000
    );

  }
);


/* =========================
   CLEAR
========================= */

clearArchive.addEventListener(
  "click",
  () => {

    if (!archive.length)
      return;


    if (
      !confirm(
        "Очистити архів?"
      )
    ) {
      return;
    }


    archive = [];

    renderArchive();

    updateSummary();

  }
);


/* =========================
   INITIAL
========================= */

zoomSlider.disabled =
  true;

console.log(
  "GHOST // AI EVENT CAMERA v2 loaded"
);