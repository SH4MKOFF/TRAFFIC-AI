"use strict";


/* =====================================================
   GHOST AI MONITOR
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

const zoneBtn =
  document.getElementById("zoneBtn");

const editZoneBtn =
  document.getElementById("editZoneBtn");


const zoneToggle =
  document.getElementById("zoneToggle");

const zoneEditor =
  document.getElementById("zoneEditor");


const zoomSlider =
  document.getElementById("zoomSlider");

const zoomValue =
  document.getElementById("zoomValue");


const statusDot =
  document.getElementById("statusDot");

const statusText =
  document.getElementById("statusText");


const recDot =
  document.getElementById("recDot");

const recText =
  document.getElementById("recText");


const cameraEmpty =
  document.getElementById("cameraEmpty");


const lastEvent =
  document.getElementById("lastEvent");

const lastEventText =
  document.getElementById("lastEventText");


const eventLog =
  document.getElementById("eventLog");

const eventCount =
  document.getElementById("eventCount");


const visibleCount =
  document.getElementById("visibleCount");

const uniqueCount =
  document.getElementById("uniqueCount");

const zoneCount =
  document.getElementById("zoneCount");


const zoneName =
  document.getElementById("zoneName");

const zoneStatus =
  document.getElementById("zoneStatus");


const objectList =
  document.getElementById("objectList");

const objectCountLabel =
  document.getElementById("objectCountLabel");


const sessionTime =
  document.getElementById("sessionTime");


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

const vibrationToggle =
  document.getElementById("vibrationToggle");

const movementToggle =
  document.getElementById("movementToggle");


/* =====================================================
   CONFIG
===================================================== */

const CLASSES = [

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


const MATCH_DISTANCE =
  100;


const MOVEMENT_DISTANCE =
  25;


const MAX_TRACK_AGE =
  1300;


/* =====================================================
   STATE
===================================================== */

let model =
  null;


let stream =
  null;


let videoTrack =
  null;


let running =
  false;


let detecting =
  false;


let tracks =
  [];


let events =
  [];


let archive =
  [];


let nextTrackId =
  1;


let sessionStarted =
  0;


let sessionTimer =
  null;


let lastAlert =
  0;


let zoneEditing =
  false;


/* =====================================================
   ZONE
===================================================== */

let zone = {

  enabled:
    false,

  name:
    "Контрольна зона",

  points: [

    {
      x: .25,
      y: .25
    },

    {
      x: .75,
      y: .25
    },

    {
      x: .75,
      y: .75
    },

    {
      x: .25,
      y: .75
    }

  ]

};


/* =====================================================
   OBJECT NAMES
===================================================== */

function typeName(type) {

  const names = {

    person:
      "Людина",

    car:
      "Автомобіль",

    truck:
      "Вантажівка",

    bus:
      "Автобус",

    motorcycle:
      "Мотоцикл",

    bicycle:
      "Велосипед",

    dog:
      "Собака",

    cat:
      "Кіт",

    backpack:
      "Рюкзак",

    handbag:
      "Сумка",

    suitcase:
      "Валіза",

    "cell phone":
      "Телефон",

    laptop:
      "Ноутбук",

    bottle:
      "Пляшка",

    cup:
      "Чашка"

  };


  return (
    names[type] ||
    type
  );

}


/* =====================================================
   ICONS
===================================================== */

function iconFor(type) {

  if (
    type ===
    "person"
  ) {

    return "👤";

  }


  if (
    VEHICLES.includes(type)
  ) {

    return "🚗";

  }


  if (
    type ===
    "dog"
  ) {

    return "🐕";

  }


  if (
    type ===
    "cat"
  ) {

    return "🐈";

  }


  if (
    type ===
    "bicycle"
  ) {

    return "🚲";

  }


  return "◈";

}


/* =====================================================
   MATH
===================================================== */

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


/* =====================================================
   POINT INSIDE POLYGON
===================================================== */

function pointInsideZone(point) {

  const p =
    zone.points;


  let inside =
    false;


  for (
    let i = 0,
    j = p.length - 1;

    i < p.length;

    j = i++
  ) {

    const xi =
      p[i].x;

    const yi =
      p[i].y;


    const xj =
      p[j].x;

    const yj =
      p[j].y;


    const intersect =

      (
        yi > point.y
      )
      !==
      (
        yj > point.y
      )

      &&

      point.x <

      (
        (xj - xi) *
        (point.y - yi)
        /
        (yj - yi)
      )
      +
      xi;


    if (intersect) {

      inside =
        !inside;

    }

  }


  return inside;

}


/* =====================================================
   DIRECTION
===================================================== */

function direction(dx, dy) {

  if (

    Math.abs(dx) < 8
    &&
    Math.abs(dy) < 8

  ) {

    return "—";

  }


  if (

    Math.abs(dx)
    >
    Math.abs(dy)

  ) {

    return (
      dx > 0
        ? "→"
        : "←"
    );

  }


  return (
    dy > 0
      ? "↓"
      : "↑"
  );

}


/* =====================================================
   TIME
===================================================== */

function currentTime() {

  return new Date()
    .toLocaleTimeString(
      "uk-UA",
      {
        hour:
          "2-digit",

        minute:
          "2-digit",

        second:
          "2-digit"
      }
    );

}


function duration() {

  if (!sessionStarted) {

    return "00:00";

  }


  const seconds =
    Math.floor(

      (
        Date.now()
        -
        sessionStarted
      )
      /
      1000

    );


  const minutes =
    Math.floor(
      seconds / 60
    );


  const secs =
    seconds % 60;


  return (

    String(minutes)
      .padStart(2, "0")

    +

    ":"

    +

    String(secs)
      .padStart(2, "0")

  );

}


/* =====================================================
   SAVE ZONE
===================================================== */

function saveZone() {

  try {

    localStorage.setItem(

      "ghost_zone",

      JSON.stringify(zone)

    );

  } catch (error) {

    console.warn(
      "Не вдалося зберегти зону",
      error
    );

  }

}


/* =====================================================
   LOAD ZONE
===================================================== */

function loadZone() {

  try {

    const saved =
      localStorage.getItem(
        "ghost_zone"
      );


    if (!saved)
      return;


    const parsed =
      JSON.parse(saved);


    if (

      parsed
      &&
      Array.isArray(
        parsed.points
      )
      &&
      parsed.points.length === 4

    ) {

      zone =
        parsed;

    }


  } catch (error) {

    console.warn(
      "Не вдалося завантажити зону",
      error
    );

  }

}


/* =====================================================
   START BUTTON
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


/* =====================================================
   START MONITORING
===================================================== */

async function startMonitoring() {

  try {

    resetSession();


    statusText.textContent =
      "ЗАПУСК";


    statusDot.className =
      "status-dot";


    cameraEmpty.classList.remove(
      "hidden"
    );


    cameraEmpty.querySelector(
      "strong"
    ).textContent =
      "Запуск камери";


    cameraEmpty.querySelector(
      "span"
    ).textContent =
      "Надання доступу...";


    stream =
      await navigator.mediaDevices.getUserMedia(
        {

          video: {

            facingMode: {

              ideal:
                "environment"

            },

            width: {

              ideal:
                1920

            },

            height: {

              ideal:
                1080

            }

          },

          audio:
            false

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


    await setupZoom();


    cameraEmpty.querySelector(
      "strong"
    ).textContent =
      "Підготовка AI";


    cameraEmpty.querySelector(
      "span"
    ).textContent =
      "Завантаження моделі...";


    if (!model) {

      model =
        await cocoSsd.load(
          {
            base:
              "mobilenet_v2"
          }
        );

    }


    running =
      true;


    detecting =
      true;


    sessionStarted =
      Date.now();


    sessionTimer =
      setInterval(

        () => {

          sessionTime.textContent =
            duration();

        },

        1000

      );


    statusText.textContent =
      "ОНЛАЙН";


    statusDot.className =
      "status-dot online";


    recDot.classList.add(
      "active"
    );


    recText.textContent =
      "АКТИВНА";


    cameraEmpty.classList.add(
      "hidden"
    );


    startBtn.classList.add(
      "running"
    );


    startBtn.innerHTML =
      "<span>■</span> ЗУПИНИТИ";


    detectLoop();


    redraw();


  } catch (error) {

    console.error(
      error
    );


    stopMonitoring();


    statusText.textContent =
      "ПОМИЛКА";


    statusDot.className =
      "status-dot alert";


    cameraEmpty.classList.remove(
      "hidden"
    );


    cameraEmpty.querySelector(
      "strong"
    ).textContent =
      "Немає доступу до камери";


    cameraEmpty.querySelector(
      "span"
    ).textContent =
      "Перевірте дозвіл браузера.";

  }

}


/* =====================================================
   STOP
===================================================== */

function stopMonitoring() {

  running =
    false;


  detecting =
    false;


  if (sessionTimer) {

    clearInterval(
      sessionTimer
    );

    sessionTimer =
      null;

  }


  if (stream) {

    stream
      .getTracks()
      .forEach(
        track =>
          track.stop()
      );

  }


  stream =
    null;


  videoTrack =
    null;


  video.srcObject =
    null;


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


  recDot.classList.remove(
    "active"
  );


  recText.textContent =
    "НЕАКТИВНА";


  cameraEmpty.classList.remove(
    "hidden"
  );


  cameraEmpty.querySelector(
    "strong"
  ).textContent =
    "Камера готова";


  cameraEmpty.querySelector(
    "span"
  ).textContent =
    "Запустіть моніторинг";


  startBtn.classList.remove(
    "running"
  );


  startBtn.innerHTML =
    "<span>●</span> ПОЧАТИ МОНІТОРИНГ";


  zoomSlider.disabled =
    true;

}


/* =====================================================
   RESET
===================================================== */

function resetSession() {

  tracks =
    [];


  events =
    [];


  archive =
    [];


  nextTrackId =
    1;


  visibleCount.textContent =
    "0";


  uniqueCount.textContent =
    "0";


  zoneCount.textContent =
    "0";


  eventCount.textContent =
    "0";


  objectCountLabel.textContent =
    "0";


  archiveCount.textContent =
    "0";


  sessionTime.textContent =
    "00:00";


  eventLog.innerHTML =

    `
      <div class="empty">
        Очікування активності
      </div>
    `;


  objectList.innerHTML =

    `
      <div class="empty">
        Об'єкти ще не виявлені
      </div>
    `;


  archiveGrid.innerHTML =
    "";

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

      zoomSlider.disabled =
        true;

      return;

    }


    zoomSlider.min =
      capabilities.zoom.min;


    zoomSlider.max =
      capabilities.zoom.max;


    zoomSlider.step =
      capabilities.zoom.step ||
      .1;


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
      Number(
        zoomSlider.value
      );


    zoomValue.textContent =
      `${value.toFixed(1)}×`;


    try {

      const current =
        videoTrack.getConstraints();


      await videoTrack.applyConstraints(

        {

          ...current,

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
        "Zoom error",
        error
      );

    }

  }
);


/* =====================================================
   DETECTION
===================================================== */

async function detectLoop() {

  if (

    !running
    ||
    !detecting
    ||
    !model

  ) {

    return;

  }


  try {

    const predictions =
      await model.detect(

        video,

        20,

        .35

      );


    const objects =
      predictions.filter(

        p =>
          CLASSES.includes(
            p.class
          )

      );


    processObjects(
      objects
    );


  } catch (error) {

    console.error(
      "Detection:",
      error
    );

  }


  if (running) {

    setTimeout(

      detectLoop,

      150

    );

  }

}


/* =====================================================
   TRACK OBJECTS
===================================================== */

function processObjects(
  predictions
) {

  const now =
    Date.now();


  const newTracks =
    [];


  const used =
    new Set();


  predictions.forEach(
    prediction => {

      const center =
        centerOf(
          prediction.bbox
        );


      let best =
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
              center,
              track.center
            );


          if (

            d <
            bestDistance

            &&

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


      /* ======================================
         EXISTING TRACK
      ====================================== */

      if (best) {

        used.add(
          best.id
        );


        const dx =
          center.x -
          best.center.x;


        const dy =
          center.y -
          best.center.y;


        const movement =
          Math.sqrt(

            dx * dx +
            dy * dy

          );


        const wasInside =
          best.insideZone;


        const normalizedPoint = {

          x:
            center.x /
            canvas.width,

          y:
            center.y /
            canvas.height

        };


        const isInside =
          zone.enabled
          &&
          pointInsideZone(
            normalizedPoint
          );


        best.center =
          center;


        best.bbox =
          prediction.bbox;


        best.score =
          prediction.score;


        best.lastSeen =
          now;


        best.direction =
          direction(
            dx,
            dy
          );


        /* MOVEMENT */

        if (

          movement >=
          MOVEMENT_DISTANCE

        ) {

          best.moved =
            true;


          if (
            movementToggle.checked
          ) {

            if (

              now -
              best.lastMovementEvent
              >
              2500

            ) {

              best.lastMovementEvent =
                now;


              addEvent(
                best,
                "РУХ"
              );

            }

          }

        }


        /* ZONE ENTRY */

        if (

          zone.enabled
          &&
          !wasInside
          &&
          isInside

        ) {

          best.crossed =
            true;


          zoneCount.textContent =

            Number(
              zoneCount.textContent
            )
            +
            1;


          addEvent(
            best,
            "ВХІД У ЗОНУ"
          );


          triggerAlert();

        }


        best.insideZone =
          isInside;


        newTracks.push(
          best
        );

      }


      /* ======================================
         NEW TRACK
      ====================================== */

      else {

        const normalizedPoint = {

          x:
            center.x /
            canvas.width,

          y:
            center.y /
            canvas.height

        };


        const inside =
          zone.enabled
          &&
          pointInsideZone(
            normalizedPoint
          );


        const track = {

          id:
            nextTrackId++,

          type:
            prediction.class,

          bbox:
            prediction.bbox,

          center,

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

          insideZone:
            inside,

          lastMovementEvent:
            0,

          image:
            null

        };


        newTracks.push(
          track
        );


        captureSnapshot(
          track
        );


        addEvent(
          track,
          "ВИЯВЛЕНО"
        );

      }

    }
  );


  /* ======================================
     KEEP RECENT TRACKS
  ====================================== */

  tracks =
    newTracks.concat(

      tracks.filter(

        old => {

          return (

            !newTracks.some(

              current =>
                current.id ===
                old.id

            )

            &&

            now -
            old.lastSeen
            <
            MAX_TRACK_AGE

          );

        }

      )

    );


  visibleCount.textContent =
    newTracks.length;


  uniqueCount.textContent =
    nextTrackId - 1;


  draw(
    newTracks
  );


  renderObjects(
    newTracks
  );

}


/* =====================================================
   DRAW EVERYTHING
===================================================== */

function draw(objects) {

  ctx.clearRect(

    0,
    0,
    canvas.width,
    canvas.height

  );


  /* ======================================
     OBJECTS
  ====================================== */

  objects.forEach(
    track => {

      const [
        x,
        y,
        w,
        h
      ] =
        track.bbox;


      const color =
        track.insideZone
          ? "#ef5b5b"
          : "#27b56b";


      ctx.save();


      ctx.strokeStyle =
        color;


      ctx.lineWidth =
        Math.max(
          2,
          canvas.width / 700
        );


      ctx.strokeRect(

        x,
        y,
        w,
        h

      );


      const label =

        `${typeName(
          track.type
        )} ${
          (
            track.score *
            100
          ).toFixed(0)
        }%`;


      ctx.font =
        "bold 12px Arial";


      const labelWidth =
        ctx.measureText(
          label
        ).width
        +
        12;


      ctx.fillStyle =
        color;


      ctx.fillRect(

        x,

        Math.max(
          0,
          y - 21
        ),

        labelWidth,

        21

      );


      ctx.fillStyle =
        "#ffffff";


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

        ctx.font =
          "bold 20px Arial";


        ctx.fillText(

          track.direction,

          x +
            w / 2 -
            6,

          y +
            h / 2

        );

      }


      ctx.restore();

    }
  );


  /* ======================================
     PERMANENT ZONE
  ====================================== */

  if (zone.enabled) {

    drawZone();

  }

}


/* =====================================================
   DRAW ZONE
===================================================== */

function drawZone() {

  const points =
    zone.points.map(

      point => ({

        x:
          point.x *
          canvas.width,

        y:
          point.y *
          canvas.height

      })

    );


  /* ======================================
     FILL
  ====================================== */

  ctx.save();


  ctx.beginPath();


  ctx.moveTo(
    points[0].x,
    points[0].y
  );


  for (
    let i = 1;
    i < points.length;
    i++
  ) {

    ctx.lineTo(
      points[i].x,
      points[i].y
    );

  }


  ctx.closePath();


  ctx.fillStyle =
    "rgba(47,184,115,.09)";


  ctx.fill();


  /* ======================================
     OUTER GLOW
  ====================================== */

  ctx.shadowColor =
    zoneEditing
      ? "rgba(240,165,46,.8)"
      : "rgba(47,184,115,.75)";


  ctx.shadowBlur =
    16;


  ctx.strokeStyle =
    zoneEditing
      ? "#f0a52e"
      : "#2fb873";


  ctx.lineWidth =
    3;


  ctx.setLineDash([
    11,
    8
  ]);


  ctx.stroke();


  /* ======================================
     INNER DASH
  ====================================== */

  ctx.shadowBlur =
    0;


  ctx.lineWidth =
    1;


  ctx.setLineDash([
    3,
    6
  ]);


  ctx.strokeStyle =
    zoneEditing
      ? "rgba(240,165,46,.8)"
      : "rgba(47,184,115,.55)";


  ctx.stroke();


  ctx.restore();


  /* ======================================
     LABEL
  ====================================== */

  if (!zoneEditing) {

    const centerX =
      points.reduce(
        (sum, point) =>
          sum +
          point.x,
        0
      )
      /
      points.length;


    const centerY =
      points.reduce(
        (sum, point) =>
          sum +
          point.y,
        0
      )
      /
      points.length;


    ctx.save();


    ctx.font =
      "bold 11px Arial";


    const label =
      `◇ ${zone.name}`;


    const width =
      ctx.measureText(
        label
      ).width
      +
      18;


    ctx.fillStyle =
      "rgba(255,255,255,.93)";


    ctx.shadowColor =
      "rgba(0,0,0,.15)";


    ctx.shadowBlur =
      10;


    ctx.fillRect(

      centerX -
        width / 2,

      centerY -
        14,

      width,

      28

    );


    ctx.shadowBlur =
      0;


    ctx.fillStyle =
      "#258f5a";


    ctx.fillText(

      label,

      centerX -
        width / 2 +
        9,

      centerY +
        4

    );


    ctx.restore();

  }

}


/* =====================================================
   REDRAW
===================================================== */

function redraw() {

  draw(

    tracks.filter(

      track =>
        Date.now() -
        track.lastSeen
        <
        MAX_TRACK_AGE

    )

  );

}


/* =====================================================
   EVENT
===================================================== */

function addEvent(
  track,
  type
) {

  const event = {

    id:
      Date.now() +
      Math.random(),

    type,

    object:
      track.type,

    score:
      track.score,

    direction:
      track.direction,

    time:
      currentTime(),

    image:
      track.image

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

}


/* =====================================================
   ALERT
===================================================== */

function triggerAlert() {

  const now =
    Date.now();


  if (

    now -
    lastAlert
    <
    1200

  ) {

    return;

  }


  lastAlert =
    now;


  statusDot.className =
    "status-dot alert";


  if (

    vibrationToggle.checked
    &&
    navigator.vibrate

  ) {

    navigator.vibrate([
      120,
      70,
      120
    ]);

  }


  if (
    soundToggle.checked
  ) {

    playSound();

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


/* =====================================================
   SOUND
===================================================== */

function playSound() {

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


    oscillator.type =
      "sine";


    oscillator.frequency.value =
      680;


    gain.gain.setValueAtTime(

      .0001,

      audio.currentTime

    );


    gain.gain.exponentialRampToValueAtTime(

      .08,

      audio.currentTime +
      .02

    );


    gain.gain.exponentialRampToValueAtTime(

      .0001,

      audio.currentTime +
      .18

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
      .2

    );

  } catch (error) {

    console.warn(
      error
    );

  }

}


/* =====================================================
   LAST EVENT
===================================================== */

function showLastEvent(
  event
) {

  lastEventText.textContent =

    `${iconFor(
      event.object
    )} ${typeName(
      event.object
    )} · ${event.type}`;


  lastEvent.classList.remove(
    "hidden"
  );


  clearTimeout(
    lastEvent._timer
  );


  lastEvent._timer =

    setTimeout(

      () => {

        lastEvent.classList.add(
          "hidden"
        );

      },

      4000

    );

}


/* =====================================================
   EVENTS UI
===================================================== */

function renderEvents() {

  if (!events.length) {

    eventLog.innerHTML =

      `
        <div class="empty">
          Очікування активності
        </div>
      `;

    return;

  }


  eventLog.innerHTML =

    events
      .slice(
        0,
        30
      )
      .map(

        event => `

          <div class="event-row">

            <span class="event-time">
              ${event.time}
            </span>


            <span class="event-icon">
              ${iconFor(
                event.object
              )}
            </span>


            <span class="event-main">

              ${event.type}


              <span class="event-sub">

                ${typeName(
                  event.object
                )}

                ·

                ${(
                  event.score *
                  100
                ).toFixed(0)}%

                ${
                  event.direction !==
                  "—"

                    ? ` · ${event.direction}`

                    : ""
                }

              </span>

            </span>

          </div>

        `

      )
      .join("");

}


/* =====================================================
   OBJECTS UI
===================================================== */

function renderObjects(
  objects
) {

  objectCountLabel.textContent =
    objects.length;


  if (!objects.length) {

    objectList.innerHTML =

      `
        <div class="empty">
          Об'єкти ще не виявлені
        </div>
      `;

    return;

  }


  objectList.innerHTML =

    objects
      .map(

        track => `

          <div class="object-card">

            <div class="object-card-top">

              <strong>

                ${iconFor(
                  track.type
                )}

                ${typeName(
                  track.type
                )}

              </strong>


              <span class="object-score">

                ${(
                  track.score *
                  100
                ).toFixed(0)}%

              </span>

            </div>


            <div class="object-meta">

              Об'єкт #${track.id}

              ·

              ${
                track.insideZone
                  ? "У ЗОНІ"
                  : "ПОЗА ЗОНОЮ"
              }

              ·

              ${track.direction}

            </div>

          </div>

        `

      )
      .join("");

}


/* =====================================================
   SNAPSHOT
===================================================== */

function captureSnapshot(
  track
) {

  try {

    const [
      x,
      y,
      w,
      h
    ] =
      track.bbox;


    const padding =
      20;


    const sx =
      Math.max(
        0,
        x -
        padding
      );


    const sy =
      Math.max(
        0,
        y -
        padding
      );


    const sw =
      Math.min(

        video.videoWidth -
        sx,

        w +
        padding *
        2

      );


    const sh =
      Math.min(

        video.videoHeight -
        sy,

        h +
        padding *
        2

      );


    const image =
      document.createElement(
        "canvas"
      );


    image.width =
      Math.max(
        1,
        Math.floor(sw)
      );


    image.height =
      Math.max(
        1,
        Math.floor(sh)
      );


    image
      .getContext("2d")
      .drawImage(

        video,

        sx,
        sy,
        sw,
        sh,

        0,
        0,
        image.width,
        image.height

      );


    track.image =
      image.toDataURL(

        "image/jpeg",

        .78

      );


    updateArchive(
      track
    );


  } catch (error) {

    console.warn(
      "Snapshot error",
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

      score:
        track.score,

      image:
        track.image,

      moved:
        track.moved,

      insideZone:
        track.insideZone,

      direction:
        track.direction,

      time:
        currentTime()

    };


    archive.push(
      item
    );

  } else {

    item.score =
      Math.max(

        item.score,

        track.score

      );


    item.moved =
      item.moved ||
      track.moved;


    item.insideZone =
      track.insideZone;


    item.direction =
      track.direction;


    if (

      !item.image
      &&
      track.image

    ) {

      item.image =
        track.image;

    }

  }


  renderArchive();

}


/* =====================================================
   ARCHIVE UI
===================================================== */

function renderArchive() {

  archiveCount.textContent =
    archive.length;


  if (!archive.length) {

    archiveGrid.innerHTML =

      `
        <div class="empty">
          Архів поки порожній
        </div>
      `;

    return;

  }


  archiveGrid.innerHTML =

    archive
      .slice()
      .reverse()
      .map(

        item => `

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

              <strong>

                ${iconFor(
                  item.type
                )}

                ${typeName(
                  item.type
                )}

              </strong>


              <small>

                Об'єкт #${item.id}

                ·

                ${(
                  item.score *
                  100
                ).toFixed(0)}%

                <br>

                ${item.time}

                ${
                  item.insideZone
                    ? " · ЗОНА"
                    : ""
                }

              </small>

            </div>

          </div>

        `

      )
      .join("");

}


/* =====================================================
   ZONE TOGGLE
===================================================== */

zoneToggle.addEventListener(
  "change",
  () => {

    zone.enabled =
      zoneToggle.checked;


    saveZone();


    updateZoneUI();


    redraw();

  }
);


/* =====================================================
   ZONE UI
===================================================== */

function updateZoneUI() {

  zoneToggle.checked =
    zone.enabled;


  if (zone.enabled) {

    zoneName.textContent =
      zone.name;


    zoneStatus.textContent =
      "Перетини зони відстежуються";


  } else {

    zoneName.textContent =
      "Зона вимкнена";


    zoneStatus.textContent =
      "Виявлення перетинів вимкнено";

  }

}


/* =====================================================
   ZONE EDIT BUTTONS
===================================================== */

zoneBtn.addEventListener(
  "click",
  toggleZoneEditor
);


editZoneBtn.addEventListener(
  "click",
  toggleZoneEditor
);


/* =====================================================
   TOGGLE EDITOR
===================================================== */

function toggleZoneEditor() {

  if (!running) {

    alert(
      "Спочатку запустіть камеру."
    );

    return;

  }


  zoneEditing =
    !zoneEditing;


  zoneEditor.classList.toggle(

    "hidden",

    !zoneEditing

  );


  if (zoneEditing) {

    zone.enabled =
      true;


    zoneToggle.checked =
      true;


    updateZoneUI();


    updateHandles();


    zoneBtn.textContent =
      "✓ ГОТОВО";


    editZoneBtn.textContent =
      "ГОТОВО";


    redraw();

  } else {

    saveZone();


    zoneBtn.textContent =
      "◇ ЗОНА";


    editZoneBtn.textContent =
      "НАЛАШТУВАТИ ЗОНУ";


    updateZoneUI();


    redraw();

  }

}


/* =====================================================
   ZONE HANDLES
===================================================== */

document
  .querySelectorAll(
    ".zone-handle"
  )
  .forEach(

    handle => {

      handle.addEventListener(

        "pointerdown",

        startZoneDrag

      );

    }

  );


/* =====================================================
   DRAG ZONE POINT
===================================================== */

function startZoneDrag(
  event
) {

  if (!zoneEditing)
    return;


  event.preventDefault();


  const corner =
    Number(

      event.currentTarget
        .dataset
        .corner

    );


  const move =
    e => {

      const rect =
        document
          .getElementById(
            "cameraStage"
          )
          .getBoundingClientRect();


      let x =
        (
          e.clientX -
          rect.left
        )
        /
        rect.width;


      let y =
        (
          e.clientY -
          rect.top
        )
        /
        rect.height;


      x =
        Math.max(

          .02,

          Math.min(
            .98,
            x
          )

        );


      y =
        Math.max(

          .02,

          Math.min(
            .98,
            y
          )

        );


      zone.points[
        corner
      ] = {

        x,
        y

      };


      updateHandles();


      redraw();

    };


  const stop =
    () => {

      window.removeEventListener(

        "pointermove",

        move

      );


      window.removeEventListener(

        "pointerup",

        stop

      );


      saveZone();

    };


  window.addEventListener(

    "pointermove",

    move

  );


  window.addEventListener(

    "pointerup",

    stop

  );

}


/* =====================================================
   UPDATE HANDLES
===================================================== */

function updateHandles() {

  const handles =
    document
      .querySelectorAll(
        ".zone-handle"
      );


  handles.forEach(

    (handle, index) => {

      const point =
        zone.points[index];


      handle.style.left =
        `${point.x * 100}%`;


      handle.style.top =
        `${point.y * 100}%`;

    }

  );

}


/* =====================================================
   SAVE SESSION
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

          item => `

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

                Об'єкт #${item.id}

                <br>

                Впевненість:
                ${(
                  item.score *
                  100
                ).toFixed(0)}%

                <br>

                Час:
                ${item.time}

                <br>

                Зона:
                ${
                  item.insideZone
                    ? "ТАК"
                    : "НІ"
                }

              </p>

            </article>

          `

        )
        .join("");


    const html = `

<!DOCTYPE html>

<html lang="uk">

<head>

<meta charset="UTF-8">

<meta
  name="viewport"
  content="width=device-width"
>

<title>
GHOST — Архів
</title>


<style>

body {

  margin: 0;

  padding: 25px;

  background: #f4f7f8;

  color: #172027;

  font-family: Arial, sans-serif;

}


h1 {

  letter-spacing: 3px;

}


.grid {

  display: grid;

  grid-template-columns:
    repeat(
      auto-fit,
      minmax(220px,1fr)
    );

  gap: 15px;

}


article {

  overflow: hidden;

  background: white;

  border:
    1px solid
    #dfe6e8;

  border-radius: 14px;

}


article img {

  width: 100%;

  display: block;

}


article h2,
article p {

  padding:
    0
    15px;

}


p {

  color: #738087;

  line-height: 1.8;

}

</style>

</head>


<body>


<h1>
GHOST.
</h1>


<p>
AI Monitor · Архів сесії
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
      `GHOST_SESSION_${Date.now()}.html`;


    link.click();


    setTimeout(

      () => {

        URL.revokeObjectURL(
          url
        );

      },

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


    archive =
      [];


    renderArchive();

  }
);


/* =====================================================
   NAVIGATION
===================================================== */

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


          button.classList.add(
            "active"
          );


          const tab =
            button.dataset.tab;


          document
            .getElementById(
              "archiveTab"
            )
            .classList.toggle(

              "hidden",

              tab !==
              "archive"

            );


          document
            .getElementById(
              "settingsTab"
            )
            .classList.toggle(

              "hidden",

              tab !==
              "settings"

            );


          document
            .getElementById(
              "monitorPage"
            )
            .classList.toggle(

              "hidden",

              tab !==
              "monitor"

            );


          document
            .getElementById(
              "objectPanel"
            )
            .classList.toggle(

              "hidden",

              tab !==
              "monitor"

            );

        }

      );

    }

  );


/* =====================================================
   SETTINGS BUTTON
===================================================== */

document
  .getElementById(
    "settingsBtn"
  )
  .addEventListener(

    "click",

    () => {

      document
        .querySelector(
          '[data-tab="settings"]'
        )
        .click();

    }

  );


/* =====================================================
   INITIALIZE
===================================================== */

loadZone();

updateZoneUI();

updateHandles();

zoomSlider.disabled =
  true;


console.log(
  "GHOST AI MONITOR v50"
);