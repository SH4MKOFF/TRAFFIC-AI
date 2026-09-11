"use strict";

/* =====================================================
   GHOST // AI EVENT CAMERA
===================================================== */


/* =====================================================
   DOM
===================================================== */

const video =
  document.getElementById("video");

const canvas =
  document.getElementById("canvas");

const ctx =
  canvas.getContext("2d");

const startBtn =
  document.getElementById("startBtn");

const stopSmall =
  document.getElementById("stopSmall");

const zoomSlider =
  document.getElementById("zoomSlider");

const zoomValue =
  document.getElementById("zoomValue");

const zoomStatus =
  document.getElementById("zoomStatus");

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

const crossedCount =
  document.getElementById("crossedCount");

const eventCount =
  document.getElementById("eventCount");

const eventLog =
  document.getElementById("eventLog");

const summaryText =
  document.getElementById("summaryText");

const sessionTime =
  document.getElementById("sessionTime");

const objectList =
  document.getElementById("objectList");

const objectCountLabel =
  document.getElementById("objectCountLabel");

const archiveGrid =
  document.getElementById("archiveGrid");

const archiveCount =
  document.getElementById("archiveCount");

const saveSession =
  document.getElementById("saveSession");

const clearArchive =
  document.getElementById("clearArchive");

const soundToggle =
  document.getElementById("soundToggle");

const rulePerson =
  document.getElementById("rulePerson");

const ruleVehicle =
  document.getElementById("ruleVehicle");

const ruleMovement =
  document.getElementById("ruleMovement");

const ruleAlert =
  document.getElementById("ruleAlert");


/* =====================================================
   CONFIG
===================================================== */

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


/* =====================================================
   STATE
===================================================== */

let model = null;

let stream = null;

let videoTrack = null;

let running = false;

let detecting = false;

let tracks = [];

let nextTrackId = 1;

let events = [];

let archive = [];

let sessionStarted = null;

let sessionTimer = null;

let detectionFrames = 0;

let lastAlert = 0;


/* =====================================================
   HELPERS
===================================================== */

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


function formatDuration(seconds) {

  const minutes =
    Math.floor(seconds / 60);

  const secs =
    seconds % 60;

  if (minutes >= 60) {

    const hours =
      Math.floor(minutes / 60);

    const mins =
      minutes % 60;

    return (
      String(hours).padStart(2, "0") +
      ":" +
      String(mins).padStart(2, "0") +
      ":" +
      String(secs).padStart(2, "0")
    );

  }

  return (
    String(minutes).padStart(2, "0") +
    ":" +
    String(secs).padStart(2, "0")
  );

}


function iconFor(type) {

  if (type === "person")
    return "👤";

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


function typeName(type) {

  const names = {

    person: "ЛЮДИНА",

    car: "АВТОМОБІЛЬ",

    truck: "ВАНТАЖІВКА",

    bus: "АВТОБУС",

    motorcycle: "МОТОЦИКЛ",

    bicycle: "ВЕЛОСИПЕД",

    dog: "СОБАКА",

    cat: "КІТ",

    backpack: "РЮКЗАК",

    handbag: "СУМКА",

    suitcase: "ВАЛІЗА",

    "cell phone": "ТЕЛЕФОН",

    laptop: "НОУТБУК",

    bottle: "ПЛЯШКА",

    cup: "ЧАШКА"

  };

  return (
    names[type] ||
    type.toUpperCase()
  );

}


function categoryFor(type) {

  if (type === "person")
    return "person";

  if (VEHICLES.includes(type))
    return "vehicle";

  return "other";

}


function centerOf(box) {

  return {

    x:
      box[0] +
      box[2] / 2,

    y:
      box[1] +
      box[3] / 2

  };

}


function distance(a, b) {

  return Math.sqrt(

    Math.pow(
      a.x - b.x,
      2
    )

    +

    Math.pow(
      a.y - b.y,
      2
    )

  );

}


function getDirection(dx, dy) {

  if (
    Math.abs(dx) < 8 &&
    Math.abs(dy) < 8
  ) {
    return "—";
  }

  if (
    Math.abs(dx) >=
    Math.abs(dy)
  ) {

    return dx > 0
      ? "→"
      : "←";

  }

  return dy > 0
    ? "↓"
    : "↑";

}


/* =====================================================
   START / STOP
===================================================== */

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


stopSmall.addEventListener(
  "click",
  () => {

    if (running) {

      stopMonitoring();

    }

  }
);


/* =====================================================
   START MONITORING
===================================================== */

async function startMonitoring() {

  try {

    resetSession();


    startBtn.disabled = true;


    statusText.textContent =
      "ЗАПУСК";


    cameraMessage.classList.remove(
      "hidden"
    );


    cameraMessage.querySelector(
      "strong"
    ).textContent =
      "ЗАПУСК КАМЕРИ";


    cameraMessage.querySelector(
      "span"
    ).textContent =
      "Надання доступу...";


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


    video.srcObject =
      stream;


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


    cameraMessage.querySelector(
      "strong"
    ).textContent =
      "ЗАВАНТАЖЕННЯ AI";


    cameraMessage.querySelector(
      "span"
    ).textContent =
      "Підготовка моделі...";


    if (!model) {

      model =
        await cocoSsd.load(
          {
            base:
              "mobilenet_v2"
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
      "МОНІТОРИНГ";


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
      <span class="button-icon">■</span>
      <span>ЗУПИНИТИ МОНІТОРИНГ</span>
    `;


    fpsLabel.textContent =
      "AI АКТИВНИЙ";


    detectLoop();


  } catch (error) {

    console.error(
      "Camera error:",
      error
    );


    stopMonitoring();


    statusText.textContent =
      "ПОМИЛКА";


    statusDot.className =
      "status-dot alert";


    cameraMessage.classList.remove(
      "hidden"
    );


    cameraMessage.querySelector(
      "strong"
    ).textContent =
      "НЕМАЄ ДОСТУПУ";


    cameraMessage.querySelector(
      "span"
    ).textContent =
      "Дозвольте доступ до камери.";

  }

}


/* =====================================================
   STOP
===================================================== */

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
        track =>
          track.stop()
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
    "ГОТОВИЙ";


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
    "GHOST ГОТОВИЙ";


  cameraMessage.querySelector(
    "span"
  ).textContent =
    "Натисніть «ПОЧАТИ МОНІТОРИНГ»";


  startBtn.classList.remove(
    "running"
  );


  startBtn.innerHTML = `
    <span class="button-icon">▶</span>
    <span>ПОЧАТИ МОНІТОРИНГ</span>
  `;


  zoomSlider.disabled = true;


  fpsLabel.textContent =
    "AI ГОТОВИЙ";


  updateSummary();

}


/* =====================================================
   RESET
===================================================== */

function resetSession() {

  tracks = [];

  events = [];

  archive = [];

  nextTrackId = 1;

  detectionFrames = 0;

  sessionStarted = null;


  visibleCount.textContent =
    "0";

  uniqueCount.textContent =
    "0";

  movedCount.textContent =
    "0";

  crossedCount.textContent =
    "0";

  eventCount.textContent =
    "0";

  objectCountLabel.textContent =
    "0";

  archiveCount.textContent =
    "0";

  sessionTime.textContent =
    "00:00";


  eventLog.innerHTML = `
    <div class="empty-event">
      Очікування активності...
    </div>
  `;


  objectList.innerHTML = `
    <div class="empty-event">
      Об'єкти не виявлені
    </div>
  `;


  archiveGrid.innerHTML = "";


  summaryText.textContent =
    "Запустіть моніторинг, щоб GHOST почав аналізувати сцену.";

}


/* =====================================================
   ZOOM
===================================================== */

async function setupZoom() {

  if (!videoTrack)
    return;


  try {

    const capabilities =
      videoTrack.getCapabilities();


    if (!capabilities.zoom) {

      zoomSlider.disabled = true;

      zoomStatus.textContent =
        "НЕ ПІДТРИМУЄТЬСЯ";

      return;

    }


    zoomSlider.min =
      capabilities.zoom.min;

    zoomSlider.max =
      capabilities.zoom.max;

    zoomSlider.step =
      capabilities.zoom.step ||
      0.1;


    const settings =
      videoTrack.getSettings();


    const current =
      settings.zoom ||
      capabilities.zoom.min;


    zoomSlider.value =
      current;


    zoomValue.textContent =
      `${Number(current).toFixed(1)}×`;


    zoomStatus.textContent =
      `${Number(current).toFixed(1)}×`;


    zoomSlider.disabled =
      false;


  } catch (error) {

    console.warn(
      "Zoom unavailable:",
      error
    );

    zoomSlider.disabled =
      true;

  }

}


zoomSlider.addEventListener(
  "input",
  async () => {

    if (!videoTrack)
      return;


    const value =
      Number(
        zoomSlider.value
      );


    zoomValue.textContent =
      `${value.toFixed(1)}×`;


    zoomStatus.textContent =
      `${value.toFixed(1)}×`;


    try {

      await videoTrack.applyConstraints(
        {
          advanced: [
            {
              zoom:
                value
            }
          ]
        }
      );

    } catch (error) {

      console.warn(
        "Zoom failed:",
        error
      );

    }

  }
);


/* =====================================================
   AI LOOP
===================================================== */

async function detectLoop() {

  if (
    !running ||
    !detecting ||
    !model
  ) {
    return;
  }


  const started =
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
        p =>
          INTEREST_CLASSES.includes(
            p.class
          )
      );


    processPredictions(
      visible
    );


    const elapsed =
      performance.now() -
      started;


    if (elapsed > 0) {

      const fps =
        Math.min(
          30,
          Math.round(
            1000 /
            elapsed
          )
        );


      fpsLabel.textContent =
        `AI ${fps} FPS`;

    }


  } catch (error) {

    console.error(
      "AI error:",
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


/* =====================================================
   PROCESS OBJECTS
===================================================== */

function processPredictions(
  predictions
) {

  const now =
    Date.now();


  const updated = [];

  const used =
    new Set();


  predictions.forEach(
    prediction => {

      const currentCenter =
        centerOf(
          prediction.bbox
        );


      let bestTrack =
        null;

      let bestDistance =
        Infinity;


      tracks.forEach(
        track => {

          if (
            used.has(
              track.id
            )
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
              currentCenter,
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

            bestTrack =
              track;

          }

        }
      );


      /* EXISTING TRACK */

      if (bestTrack) {

        used.add(
          bestTrack.id
        );


        const dx =
          currentCenter.x -
          bestTrack.center.x;


        const dy =
          currentCenter.y -
          bestTrack.center.y;


        const movement =
          Math.sqrt(
            dx * dx +
            dy * dy
          );


        const moved =
          movement >=
          MOVEMENT_DISTANCE;


        bestTrack.direction =
          getDirection(
            dx,
            dy
          );


        bestTrack.center =
          currentCenter;


        bestTrack.bbox =
          prediction.bbox;


        bestTrack.score =
          prediction.score;


        bestTrack.lastSeen =
          now;


        if (moved) {

          bestTrack.moved =
            true;


          if (
            ruleMovement.checked &&
            now -
            bestTrack.lastMovementEvent >
            2000
          ) {

            bestTrack.lastMovementEvent =
              now;


            createEvent(
              bestTrack,
              "РУХ"
            );

          }

        }


        updated.push(
          bestTrack
        );


      }


      /* NEW TRACK */

      else {

        const track = {

          id:
            nextTrackId++,

          type:
            prediction.class,

          bbox:
            prediction.bbox,

          center:
            currentCenter,

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
            currentCenter.x,

          lastMovementEvent:
            0,

          image:
            null

        };


        updated.push(
          track
        );


        captureSnapshot(
          track
        );


        createEvent(
          track,
          "ВИЯВЛЕНО"
        );

      }

    }
  );


  /* KEEP RECENT LOST TRACKS */

  tracks =
    updated.concat(

      tracks.filter(
        old => {

          return (

            !updated.some(
              x =>
                x.id ===
                old.id
            )

            &&

            now -
            old.lastSeen <
            MAX_TRACK_AGE

          );

        }
      )

    );


  checkLineCrossing(
    updated
  );


  drawObjects(
    updated
  );


  visibleCount.textContent =
    updated.length;


  uniqueCount.textContent =
    nextTrackId - 1;


  movedCount.textContent =
    archive.filter(
      item =>
        item.moved
    ).length;


  crossedCount.textContent =
    archive.filter(
      item =>
        item.crossed
    ).length;


  renderObjects(
    updated
  );


  detectionFrames++;


  updateSummary();

}


/* =====================================================
   LINE CROSSING
===================================================== */

function checkLineCrossing(
  objects
) {

  const lineX =
    canvas.width *
    0.5;


  objects.forEach(
    track => {

      if (
        typeof
        track.previousX !==
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
        )

        &&

        !track.crossed
      ) {

        track.crossed =
          true;


        track.direction =
          leftToRight
            ? "→"
            : "←";


        const category =
          categoryFor(
            track.type
          );


        let allowed = true;


        if (
          category ===
          "person"
        ) {

          allowed =
            rulePerson.checked;

        }


        if (
          category ===
          "vehicle"
        ) {

          allowed =
            ruleVehicle.checked;

        }


        if (allowed) {

          createEvent(
            track,
            "ВХІД",
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


/* =====================================================
   CREATE EVENT
===================================================== */

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
      track.image ||
      null

  };


  events.unshift(
    event
  );


  if (
    events.length >
    100
  ) {

    events.pop();

  }


  eventCount.textContent =
    events.length;


  renderEvents();

  showLastEvent(
    event
  );


  updateArchive(
    track
  );


  if (
    eventType !==
    "ВИЯВЛЕНО"
  ) {

    triggerAlert();

  }

}


/* =====================================================
   ALERT
===================================================== */

function triggerAlert() {

  const now =
    Date.now();


  if (
    now -
    lastAlert <
    1000
  ) {

    return;

  }


  lastAlert =
    now;


  statusDot.className =
    "status-dot alert";


  if (
    ruleAlert.checked &&
    navigator.vibrate
  ) {

    navigator.vibrate(
      [
        100,
        60,
        100
      ]
    );

  }


  if (
    soundToggle.checked
  ) {

    playAlertSound();

  }


  setTimeout(
    () => {

      if (running) {

        statusDot.className =
          "status-dot online";

      }

    },
    1200
  );

}


/* =====================================================
   SIMPLE ALERT SOUND
===================================================== */

function playAlertSound() {

  try {

    const AudioContext =
      window.AudioContext ||
      window.webkitAudioContext;


    if (!AudioContext)
      return;


    const audio =
      new AudioContext();


    const oscillator =
      audio.createOscillator();


    const gain =
      audio.createGain();


    oscillator.frequency.value =
      720;


    oscillator.type =
      "sine";


    gain.gain.setValueAtTime(
      0.0001,
      audio.currentTime
    );


    gain.gain.exponentialRampToValueAtTime(
      0.08,
      audio.currentTime + 0.02
    );


    gain.gain.exponentialRampToValueAtTime(
      0.0001,
      audio.currentTime + 0.18
    );


    oscillator.connect(
      gain
    );


    gain.connect(
      audio.destination
    );


    oscillator.start();

    oscillator.stop(
      audio.currentTime +
      0.2
    );

  } catch (error) {

    console.warn(
      "Sound unavailable"
    );

  }

}


/* =====================================================
   LAST EVENT
===================================================== */

function showLastEvent(
  event
) {

  const emoji =
    iconFor(
      event.objectType
    );


  const name =
    typeName(
      event.objectType
    );


  cameraEventText.textContent =
    `${emoji} ${name} · ${event.type}`;


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


/* =====================================================
   EVENTS RENDER
===================================================== */

function renderEvents() {

  if (!events.length) {

    eventLog.innerHTML = `
      <div class="empty-event">
        Очікування активності...
      </div>
    `;

    return;

  }


  eventLog.innerHTML =
    events
      .slice(
        0,
        40
      )
      .map(
        event => {

          return `
            <div class="event-row">

              <span class="event-time">
                ${event.time}
              </span>

              <span class="event-icon">
                ${iconFor(
                  event.objectType
                )}
              </span>

              <span class="event-main">

                ${event.type}
                ${
                  event.direction !==
                  "—"
                    ? ` ${event.direction}`
                    : ""
                }

                <span
                  class="event-sub"
                >
                  ${typeName(
                    event.objectType
                  )}

                  · #${event.trackId}

                  · ${(
                    event.confidence *
                    100
                  ).toFixed(0)}%
                </span>

              </span>

            </div>
          `;

        }
      )
      .join("");

}


/* =====================================================
   OBJECTS
===================================================== */

function renderObjects(
  objects
) {

  objectCountLabel.textContent =
    objects.length;


  if (!objects.length) {

    objectList.innerHTML = `
      <div class="empty-event">
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

                  ${iconFor(
                    track.type
                  )}

                  ${typeName(
                    track.type
                  )}

                </div>

                <div class="object-meta">

                  ОБ'ЄКТ #${track.id}

                  ·
                  ${track.direction}

                  ${
                    track.moved
                      ? " · РУХАЄТЬСЯ"
                      : ""
                  }

                </div>

              </div>

              <div
                class="object-confidence"
              >

                ${(
                  track.score *
                  100
                ).toFixed(0)}%

              </div>

            </div>
          `;

        }
      )
      .join("");

}


/* =====================================================
   DRAW OBJECTS
===================================================== */

function drawObjects(
  objects
) {

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
          ? "#ff6262"
          : "#76ff9a";


      ctx.lineWidth =
        2;


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
          track.score *
          100
        ).toFixed(0)}%`;


      ctx.font =
        "bold 12px Arial";


      const textWidth =
        ctx.measureText(
          label
        ).width;


      ctx.fillStyle =
        track.moved
          ? "#ff6262"
          : "#76ff9a";


      ctx.fillRect(
        x,
        Math.max(
          0,
          y - 20
        ),
        textWidth + 12,
        20
      );


      ctx.fillStyle =
        "#061009";


      ctx.fillText(
        label,
        x + 6,
        Math.max(
          14,
          y - 6
        )
      );


      if (
        track.direction !==
        "—"
      ) {

        ctx.fillStyle =
          track.moved
            ? "#ff6262"
            : "#76ff9a";


        ctx.font =
          "bold 22px Arial";


        ctx.fillText(
          track.direction,
          x +
            w / 2 -
            7,
          y +
            h / 2
        );

      }

    }
  );


  /* CONTROL LINE */

  const lineX =
    canvas.width *
    0.5;


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
    "rgba(118,255,154,.5)";


  ctx.lineWidth =
    1;


  ctx.stroke();


  ctx.setLineDash([]);

}


/* =====================================================
   SNAPSHOT
===================================================== */

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


    const padding =
      18;


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
        video.videoWidth -
        sx,
        w +
        padding * 2
      );


    const sh =
      Math.min(
        video.videoHeight -
        sy,
        h +
        padding * 2
      );


    const imageCanvas =
      document.createElement(
        "canvas"
      );


    imageCanvas.width =
      Math.max(
        1,
        Math.floor(sw)
      );


    imageCanvas.height =
      Math.max(
        1,
        Math.floor(sh)
      );


    const imageCtx =
      imageCanvas.getContext(
        "2d"
      );


    imageCtx.drawImage(
      video,
      sx,
      sy,
      sw,
      sh,
      0,
      0,
      imageCanvas.width,
      imageCanvas.height
    );


    track.image =
      imageCanvas.toDataURL(
        "image/jpeg",
        .78
      );


    updateArchive(
      track
    );

  } catch (error) {

    console.warn(
      "Snapshot error:",
      error
    );

  }

}


/* =====================================================
   ARCHIVE
===================================================== */

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
        track.image ||
        null

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


/* =====================================================
   ARCHIVE RENDER
===================================================== */

function renderArchive() {

  archiveCount.textContent =
    archive.length;


  if (!archive.length) {

    archiveGrid.innerHTML =
      `
      <div class="empty-event">
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
            <div
              class="archive-card"
            >

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

              <div
                class="archive-info"
              >

                <div
                  class="archive-type"
                >

                  ${iconFor(
                    item.type
                  )}

                  ${typeName(
                    item.type
                  )}

                </div>

                <div
                  class="archive-detail"
                >

                  ОБ'ЄКТ #${item.id}<br>

                  ВПЕВНЕНІСТЬ
                  ${(
                    item.confidence *
                    100
                  ).toFixed(0)}%<br>

                  НАПРЯМОК
                  ${item.direction}

                  ${
                    item.moved
                      ? " · РУХ"
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


/* =====================================================
   SUMMARY
===================================================== */

function updateSummary() {

  if (!sessionStarted) {
    return;
  }


  const people =
    archive.filter(
      x =>
        x.type ===
        "person"
    ).length;


  const vehicles =
    archive.filter(
      x =>
        VEHICLES.includes(
          x.type
        )
    ).length;


  const animals =
    archive.filter(
      x =>
        x.type === "dog" ||
        x.type === "cat"
    ).length;


  const moving =
    events.filter(
      x =>
        x.type ===
        "РУХ"
    ).length;


  const crossings =
    events.filter(
      x =>
        x.type ===
        "ВХІД"
    ).length;


  const seconds =
    Math.floor(
      (
        Date.now() -
        sessionStarted
      ) / 1000
    );


  summaryText.innerHTML = `

    За
    <strong>
      ${formatDuration(
        seconds
      )}
    </strong>
    GHOST зафіксував
    <strong>
      ${events.length}
    </strong>
    подій.

    <br><br>

    👤 ${people} людей
    ·
    🚗 ${vehicles} транспортних засобів
    ·
    🐾 ${animals} тварин

    <br>

    ${moving} подій руху
    ·
    ${crossings} перетинів

  `;

}


/* =====================================================
   TIMER
===================================================== */

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
    formatDuration(
      seconds
    );


  updateSummary();

}


/* =====================================================
   ARCHIVE SAVE
===================================================== */

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
                    ? `
                      <img
                        src="${item.image}"
                      >
                    `
                    : ""
                }

                <h2>
                  ${iconFor(
                    item.type
                  )}
                  ${typeName(
                    item.type
                  )}
                </h2>

                <p>

                  ОБ'ЄКТ #${item.id}<br>

                  Впевненість:
                  ${(
                    item.confidence *
                    100
                  ).toFixed(0)}%<br>

                  Напрямок:
                  ${item.direction}<br>

                  Рух:
                  ${
                    item.moved
                      ? "ТАК"
                      : "НІ"
                  }

                </p>

              </article>
            `;

          }
        )
        .join("");


    const html = `
<!DOCTYPE html>

<html lang="uk">

<head>

<meta charset="UTF-8">

<meta
  name="viewport"
  content="width=device-width,
  initial-scale=1"
>

<title>
GHOST — Архів сесії
</title>

<style>

body{
  margin:0;
  padding:25px;
  background:#05080d;
  color:#edf4f1;
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
  gap:15px;
}

article{
  overflow:hidden;
  background:#0b1117;
  border:1px solid #202a30;
  border-radius:12px;
}

article img{
  width:100%;
  display:block;
}

article h2,
article p{
  padding:0 14px;
}

p{
  color:#91a097;
  line-height:1.8;
}

</style>

</head>

<body>

<h1>
GHOST.
</h1>

<p>
Архів AI-моніторингу
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


    const link =
      document.createElement(
        "a"
      );


    link.href =
      url;


    link.download =
      `GHOST_${Date.now()}.html`;


    link.click();


    setTimeout(
      () =>
        URL.revokeObjectURL(
          url
        ),
      1000
    );

  }
);


/* =====================================================
   CLEAR ARCHIVE
===================================================== */

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


/* =====================================================
   TABS
===================================================== */

document
  .querySelectorAll(
    ".tab"
  )
  .forEach(
    button => {

      button.addEventListener(
        "click",
        () => {

          document
            .querySelectorAll(
              ".tab"
            )
            .forEach(
              b =>
                b.classList.remove(
                  "active"
                )
            );


          document
            .querySelectorAll(
              ".tab-content"
            )
            .forEach(
              section =>
                section.classList.remove(
                  "active"
                )
            );


          button.classList.add(
            "active"
          );


          const target =
            document.getElementById(
              `${button.dataset.tab}Tab`
            );


          if (target) {

            target.classList.add(
              "active"
            );

          }

        }
      );

    }
  );


/* =====================================================
   INITIAL
===================================================== */

zoomSlider.disabled =
  true;


console.log(
  "GHOST // AI EVENT CAMERA v30"
);