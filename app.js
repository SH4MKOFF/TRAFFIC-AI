"use strict";

/* =====================================================
   GHOST V2
   TWO PHONE SMART CAMERA
===================================================== */

const $ = id => document.getElementById(id);


/* =====================================================
   DOM
===================================================== */

const roleScreen = $("roleScreen");
const cameraPage = $("cameraPage");
const viewerPage = $("viewerPage");
const bottomNav = $("bottomNav");

const cameraRoleBtn = $("cameraRoleBtn");
const viewerRoleBtn = $("viewerRoleBtn");

const video = $("video");
const canvas = $("canvas");
const ctx = canvas.getContext("2d");

const remoteVideo = $("remoteVideo");

const startBtn = $("startBtn");
const zoneBtn = $("zoneBtn");
const editZoneBtn = $("editZoneBtn");

const zoneToggle = $("zoneToggle");
const zoneEditor = $("zoneEditor");
const zoneOverlay = $("zoneOverlay");
const zoneOverlayLabel = $("zoneOverlayLabel");

const zoomSlider = $("zoomSlider");
const zoomValue = $("zoomValue");

const statusDot = $("statusDot");
const statusText = $("statusText");
const statusSub = $("statusSub");

const recDot = $("recDot");
const recText = $("recText");

const cameraEmpty = $("cameraEmpty");

const lastEvent = $("lastEvent");
const lastEventText = $("lastEventText");

const eventLog = $("eventLog");
const eventCount = $("eventCount");

const visibleCount = $("visibleCount");
const uniqueCount = $("uniqueCount");
const zoneCount = $("zoneCount");

const zoneName = $("zoneName");
const zoneStatus = $("zoneStatus");

const objectList = $("objectList");
const objectCountLabel = $("objectCountLabel");

const sessionTime = $("sessionTime");

const archiveGrid = $("archiveGrid");
const archiveCount = $("archiveCount");

const saveSession = $("saveSession");
const clearArchive = $("clearArchive");

const soundToggle = $("soundToggle");
const vibrationToggle = $("vibrationToggle");
const movementToggle = $("movementToggle");

const cameraQr = $("cameraQr");
const cameraId = $("cameraId");
const copyCameraId = $("copyCameraId");

const remotePeerId = $("remotePeerId");
const connectBtn = $("connectBtn");
const disconnectBtn = $("disconnectBtn");

const viewerConnection = $("viewerConnection");
const viewerEmpty = $("viewerEmpty");
const viewerEvents = $("viewerEvents");


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

const MATCH_DISTANCE = 100;
const MOVEMENT_DISTANCE = 25;
const MAX_TRACK_AGE = 1300;


/* =====================================================
   STATE
===================================================== */

let model = null;

let stream = null;
let videoTrack = null;

let running = false;
let detecting = false;

let tracks = [];
let events = [];
let archive = [];

let nextTrackId = 1;

let sessionStarted = 0;
let sessionTimer = null;

let lastAlert = 0;

let zoneEditing = false;

let peer = null;
let cameraConnection = null;
let viewerConnectionCall = null;

let role = null;

let audioContext = null;


/* =====================================================
   ZONE
===================================================== */

let zone = {
  enabled: false,

  name: "Контрольна зона",

  points: [
    { x: .25, y: .25 },
    { x: .75, y: .25 },
    { x: .75, y: .75 },
    { x: .25, y: .75 }
  ]
};


/* =====================================================
   OBJECT NAMES
===================================================== */

function typeName(type){

  const names = {

    person: "Людина",
    car: "Автомобіль",
    truck: "Вантажівка",
    bus: "Автобус",
    motorcycle: "Мотоцикл",
    bicycle: "Велосипед",

    dog: "Собака",
    cat: "Кіт",

    backpack: "Рюкзак",
    handbag: "Сумка",
    suitcase: "Валіза",

    "cell phone": "Телефон",
    laptop: "Ноутбук",

    bottle: "Пляшка",
    cup: "Чашка"

  };

  return names[type] || type;
}


/* =====================================================
   ICONS
===================================================== */

function iconFor(type){

  if(type === "person")
    return "👤";

  if(VEHICLES.includes(type))
    return "🚗";

  if(type === "dog")
    return "🐕";

  if(type === "cat")
    return "🐈";

  if(type === "bicycle")
    return "🚲";

  return "◈";
}


/* =====================================================
   MATH
===================================================== */

function centerOf(box){

  return {
    x: box[0] + box[2] / 2,
    y: box[1] + box[3] / 2
  };

}


function distance(a,b){

  return Math.sqrt(
    Math.pow(a.x-b.x,2) +
    Math.pow(a.y-b.y,2)
  );

}


/* =====================================================
   POINT IN POLYGON
===================================================== */

function pointInsideZone(point){

  const p = zone.points;

  let inside = false;

  for(
    let i = 0,
    j = p.length - 1;

    i < p.length;

    j = i++
  ){

    const xi = p[i].x;
    const yi = p[i].y;

    const xj = p[j].x;
    const yj = p[j].y;

    const intersect =
      (yi > point.y) !== (yj > point.y)
      &&
      point.x <
      (
        (xj-xi) *
        (point.y-yi) /
        (yj-yi)
      ) +
      xi;

    if(intersect)
      inside = !inside;

  }

  return inside;
}


/* =====================================================
   DIRECTION
===================================================== */

function direction(dx,dy){

  if(
    Math.abs(dx) < 8 &&
    Math.abs(dy) < 8
  )
    return "—";

  if(Math.abs(dx) > Math.abs(dy))
    return dx > 0 ? "→" : "←";

  return dy > 0 ? "↓" : "↑";
}


/* =====================================================
   TIME
===================================================== */

function currentTime(){

  return new Date().toLocaleTimeString(
    "uk-UA",
    {
      hour:"2-digit",
      minute:"2-digit",
      second:"2-digit"
    }
  );

}


function duration(){

  if(!sessionStarted)
    return "00:00";

  const seconds =
    Math.floor(
      (Date.now()-sessionStarted)/1000
    );

  const minutes =
    Math.floor(seconds/60);

  const secs =
    seconds%60;

  return (
    String(minutes).padStart(2,"0")
    +
    ":"
    +
    String(secs).padStart(2,"0")
  );
}


/* =====================================================
   ROLE
===================================================== */

cameraRoleBtn.addEventListener(
  "click",
  () => {

    role = "camera";

    roleScreen.classList.add("hidden");
    cameraPage.classList.remove("hidden");
    bottomNav.classList.remove("hidden");

    initializeCameraPeer();

  }
);


viewerRoleBtn.addEventListener(
  "click",
  () => {

    role = "viewer";

    roleScreen.classList.add("hidden");
    viewerPage.classList.remove("hidden");

    initializeViewerPeer();

  }
);


/* =====================================================
   PEER ID
===================================================== */

function makeCameraId(){

  return (
    "ghost-" +
    Math.random()
      .toString(36)
      .slice(2,8)
  );

}


/* =====================================================
   CAMERA PEER
===================================================== */

function initializeCameraPeer(){

  const id = makeCameraId();

  peer = new Peer(id);

  peer.on(
    "open",
    peerId => {

      cameraId.value = peerId;

      generateQR(
        location.origin +
        location.pathname +
        "?camera=" +
        encodeURIComponent(peerId)
      );

    }
  );


  peer.on(
    "call",
    call => {

      if(!stream){

        call.close();
        return;

      }

      cameraConnection = call;

      call.answer(stream);

    }
  );


  peer.on(
    "error",
    error => {

      console.error(
        "Peer error:",
        error
      );

    }
  );

}


/* =====================================================
   VIEWER PEER
===================================================== */

function initializeViewerPeer(){

  peer = new Peer();

  peer.on(
    "open",
    () => {

      const urlParams =
        new URLSearchParams(
          location.search
        );

      const camera =
        urlParams.get("camera");

      if(camera){

        remotePeerId.value = camera;

        setTimeout(
          () => connectToCamera(camera),
          500
        );

      }

    }
  );


  peer.on(
    "error",
    error => {

      console.error(
        "Viewer peer error:",
        error
      );

      setViewerConnection(
        "ПОМИЛКА"
      );

    }
  );

}


/* =====================================================
   CONNECT
===================================================== */

connectBtn.addEventListener(
  "click",
  () => {

    const id =
      remotePeerId.value.trim();

    if(!id)
      return;

    connectToCamera(id);

  }
);


async function connectToCamera(id){

  try{

    if(!peer)
      initializeViewerPeer();

    setViewerConnection(
      "ПІДКЛЮЧЕННЯ..."
    );

    const tempStream =
      await navigator.mediaDevices.getUserMedia(
        {
          video:true,
          audio:false
        }
      );

    tempStream
      .getTracks()
      .forEach(
        track => track.stop()
      );

    const call =
      peer.call(
        id,
        new MediaStream()
      );

    viewerConnectionCall = call;

    call.on(
      "stream",
      remoteStream => {

        remoteVideo.srcObject =
          remoteStream;

        remoteVideo.play()
          .catch(()=>{});

        viewerEmpty.classList.add(
          "hidden"
        );

        setViewerConnection(
          "ПІДКЛЮЧЕНО"
        );

      }
    );


    call.on(
      "close",
      () => {

        setViewerConnection(
          "ВІДКЛЮЧЕНО"
        );

        viewerEmpty.classList.remove(
          "hidden"
        );

      }
    );

  }
  catch(error){

    console.error(error);

    setViewerConnection(
      "ПОМИЛКА"
    );

    alert(
      "Не вдалося підключитися до камери."
    );

  }

}


/* =====================================================
   VIEWER CONNECTION
===================================================== */

function setViewerConnection(text){

  viewerConnection.textContent =
    text;

  if(text === "ПІДКЛЮЧЕНО")
    viewerConnection.classList.add(
      "online"
    );
  else
    viewerConnection.classList.remove(
      "online"
    );

}


/* =====================================================
   DISCONNECT
===================================================== */

disconnectBtn.addEventListener(
  "click",
  () => {

    if(viewerConnectionCall){

      try{
        viewerConnectionCall.close();
      }
      catch(error){}

    }

    viewerConnectionCall =
      null;

    remoteVideo.srcObject =
      null;

    viewerEmpty.classList.remove(
      "hidden"
    );

    setViewerConnection(
      "НЕ ПІДКЛЮЧЕНО"
    );

  }
);


/* =====================================================
   QR
===================================================== */

function generateQR(text){

  if(!cameraQr)
    return;

  cameraQr.innerHTML = "";

  if(
    typeof QRCode ===
    "undefined"
  ){

    cameraQr.textContent =
      "QR";

    return;

  }

  const img =
    document.createElement("img");

  QRCode.toDataURL(
    text,
    {
      width:210,
      margin:1
    },
    (
      error,
      url
    ) => {

      if(error){

        console.error(error);

        cameraQr.textContent =
          "QR";

        return;

      }

      img.src = url;

      cameraQr.appendChild(img);

    }
  );

}


/* =====================================================
   COPY ID
===================================================== */

copyCameraId.addEventListener(
  "click",
  async () => {

    if(!cameraId.value)
      return;

    try{

      await navigator.clipboard.writeText(
        cameraId.value
      );

      copyCameraId.textContent =
        "СКОПІЙОВАНО";

      setTimeout(
        () => {

          copyCameraId.textContent =
            "КОПІЮВАТИ КОД";

        },
        1400
      );

    }
    catch(error){

      cameraId.select();

    }

  }
);


/* =====================================================
   START BUTTON
===================================================== */

startBtn.addEventListener(
  "click",
  async () => {

    if(running){

      stopMonitoring();

    }
    else{

      await startMonitoring();

    }

  }
);


/* =====================================================
   START MONITORING
===================================================== */

async function startMonitoring(){

  try{

    resetSession();

    statusText.textContent =
      "ЗАПУСК";

    statusSub.textContent =
      "Запуск камери";

    statusDot.className =
      "";

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
          video:{
            facingMode:{
              ideal:"environment"
            },

            width:{
              ideal:1920
            },

            height:{
              ideal:1080
            }
          },

          audio:false
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


    if(!model){

      model =
        await cocoSsd.load(
          {
            base:"mobilenet_v2"
          }
        );

    }


    running = true;
    detecting = true;

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

    statusSub.textContent =
      "AI працює на пристрої";

    statusDot.className =
      "online";


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

    startBtn.textContent =
      "■ ЗУПИНИТИ";


    detectLoop();

    redraw();

  }
  catch(error){

    console.error(
      error
    );

    stopMonitoring();

    statusText.textContent =
      "ПОМИЛКА";

    statusSub.textContent =
      "Немає доступу";

    statusDot.className =
      "alert";


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

function stopMonitoring(){

  running = false;
  detecting = false;


  if(sessionTimer){

    clearInterval(
      sessionTimer
    );

    sessionTimer =
      null;

  }


  if(stream){

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

  statusSub.textContent =
    "Камера вимкнена";

  statusDot.className =
    "";


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
    "Натисніть «Почати моніторинг»";


  startBtn.classList.remove(
    "running"
  );

  startBtn.textContent =
    "● ПОЧАТИ МОНІТОРИНГ";


  zoomSlider.disabled =
    true;

}


/* =====================================================
   RESET
===================================================== */

function resetSession(){

  tracks = [];
  events = [];
  archive = [];

  nextTrackId = 1;

  visibleCount.textContent = "0";
  uniqueCount.textContent = "0";
  zoneCount.textContent = "0";
  eventCount.textContent = "0";
  objectCountLabel.textContent = "0";
  archiveCount.textContent = "0";

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

async function setupZoom(){

  if(!videoTrack)
    return;

  try{

    const capabilities =
      videoTrack.getCapabilities();

    if(!capabilities.zoom){

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

  }
  catch(error){

    console.warn(
      "Zoom unavailable",
      error
    );

  }

}


zoomSlider.addEventListener(
  "input",
  async () => {

    if(!videoTrack)
      return;

    const value =
      Number(
        zoomSlider.value
      );

    zoomValue.textContent =
      `${value.toFixed(1)}×`;


    try{

      await videoTrack.applyConstraints(
        {
          advanced:[
            {
              zoom:value
            }
          ]
        }
      );

    }
    catch(error){

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

async function detectLoop(){

  if(
    !running ||
    !detecting ||
    !model
  )
    return;


  try{

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

  }
  catch(error){

    console.error(
      "Detection:",
      error
    );

  }


  if(running){

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
){

  const now =
    Date.now();

  const newTracks = [];

  const used = new Set();


  predictions.forEach(
    prediction => {

      const center =
        centerOf(
          prediction.bbox
        );


      let best = null;

      let bestDistance =
        Infinity;


      tracks.forEach(
        track => {

          if(
            used.has(
              track.id
            )
          )
            return;


          if(
            track.type !==
            prediction.class
          )
            return;


          const d =
            distance(
              center,
              track.center
            );


          if(
            d < bestDistance &&
            d <= MATCH_DISTANCE
          ){

            bestDistance =
              d;

            best =
              track;

          }

        }
      );


      if(best){

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
            dx*dx +
            dy*dy
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
          zone.enabled &&
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


        if(
          movement >=
          MOVEMENT_DISTANCE
        ){

          best.moved =
            true;


          if(
            movementToggle.checked
          ){

            if(
              now -
              best.lastMovementEvent
              >
              2500
            ){

              best.lastMovementEvent =
                now;

              addEvent(
                best,
                "РУХ"
              );

            }

          }

        }


        if(
          zone.enabled &&
          !wasInside &&
          isInside
        ){

          best.crossed =
            true;


          zoneCount.textContent =
            Number(
              zoneCount.textContent
            ) + 1;


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
      else{

        const normalizedPoint = {

          x:
            center.x /
            canvas.width,

          y:
            center.y /
            canvas.height

        };


        const inside =
          zone.enabled &&
          pointInsideZone(
            normalizedPoint
          );


        const track = {

          id:
            nextTrackId++,

          type:
            prediction.class,

          center,

          bbox:
            prediction.bbox,

          score:
            prediction.score,

          firstSeen:
            now,

          lastSeen:
            now,

          moved:false,

          crossed:false,

          insideZone:
            inside,

          direction:"—",

          lastMovementEvent:0

        };


        newTracks.push(
          track
        );


        addArchive(
          track
        );

      }

    }
  );


  tracks =
    newTracks.filter(
      track =>
        now -
        track.lastSeen
        <=
        MAX_TRACK_AGE
    );


  visibleCount.textContent =
    predictions.length;

  uniqueCount.textContent =
    nextTrackId - 1;

  objectCountLabel.textContent =
    predictions.length;


  renderObjects();
  renderArchive();

}


/* =====================================================
   EVENTS
===================================================== */

function addEvent(
  track,
  action
){

  const event = {

    id:
      Date.now() +
      Math.random(),

    time:
      currentTime(),

    type:
      track.type,

    action,

    direction:
      track.direction,

    score:
      track.score

  };


  events.unshift(
    event
  );


  if(events.length > 50)
    events.pop();


  eventCount.textContent =
    events.length;


  renderEvents();


  lastEvent.classList.remove(
    "hidden"
  );

  lastEventText.textContent =
    `${typeName(track.type)} — ${action}`;


  sendEventToViewer(
    event
  );

}


/* =====================================================
   VIEWER EVENTS
===================================================== */

function sendEventToViewer(
  event
){

  if(
    !cameraConnection ||
    !cameraConnection.open
  )
    return;

  try{

    cameraConnection.send(
      {
        type:"event",
        event
      }
    );

  }
  catch(error){

    console.warn(
      "Event send error",
      error
    );

  }

}


/* =====================================================
   EVENTS RENDER
===================================================== */

function renderEvents(){

  if(!events.length){

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
      .slice(0,15)
      .map(
        event =>
          `
          <div class="event-row">

            <div class="event-time">
              ${event.time}
            </div>

            <div class="event-icon">
              ${iconFor(event.type)}
            </div>

            <div>

              <div class="event-main">
                ${typeName(event.type)} · ${event.action}
              </div>

              <span class="event-sub">
                ${event.direction || "—"}
              </span>

            </div>

          </div>
          `
      )
      .join("");

}


/* =====================================================
   VIEWER EVENTS LISTENER
===================================================== */

function setupViewerDataChannel(){

  if(!cameraConnection)
    return;

  cameraConnection.on(
    "data",
    data => {

      if(
        !data ||
        data.type !==
        "event"
      )
        return;

      addViewerEvent(
        data.event
      );

    }
  );

}


function addViewerEvent(
  event
){

  const empty =
    viewerEvents.querySelector(
      ".empty"
    );

  if(empty)
    empty.remove();


  const row =
    document.createElement(
      "div"
    );

  row.className =
    "event-row";

  row.innerHTML =
    `
      <div class="event-time">
        ${event.time}
      </div>

      <div class="event-icon">
        ${iconFor(event.type)}
      </div>

      <div>
        <div class="event-main">
          ${typeName(event.type)} · ${event.action}
        </div>

        <span class="event-sub">
          ${event.direction || "—"}
        </span>
      </div>
    `;


  viewerEvents.prepend(
    row
  );

}


/* =====================================================
   OBJECTS UI
===================================================== */

function renderObjects(){

  if(!tracks.length){

    objectList.innerHTML =
      `
        <div class="empty">
          Об'єкти ще не виявлені
        </div>
      `;

    return;

  }


  objectList.innerHTML =
    tracks
      .map(
        track =>
          `
          <div class="object-card">

            <div class="object-card-top">

              <strong>
                ${iconFor(track.type)}
                ${typeName(track.type)}
              </strong>

              <span class="object-score">
                ${Math.round(track.score*100)}%
              </span>

            </div>

            <div class="object-meta">

              ${track.moved ? "Рухається" : "Стабільний"}

              ·

              напрямок ${track.direction}

            </div>

          </div>
          `
      )
      .join("");

}


/* =====================================================
   ARCHIVE
===================================================== */

function addArchive(
  track
){

  try{

    if(
      !video.videoWidth ||
      !video.videoHeight
    )
      return;


    const padding =
      35;


    const x =
      Math.max(
        0,
        track.bbox[0] -
        padding
      );

    const y =
      Math.max(
        0,
        track.bbox[1] -
        padding
      );

    const width =
      Math.min(
        video.videoWidth -
        x,

        track.bbox[2] +
        padding*2
      );

    const height =
      Math.min(
        video.videoHeight -
        y,

        track.bbox[3] +
        padding*2
      );


    const imageCanvas =
      document.createElement(
        "canvas"
      );


    imageCanvas.width =
      Math.max(
        1,
        width
      );

    imageCanvas.height =
      Math.max(
        1,
        height
      );


    const imageCtx =
      imageCanvas.getContext(
        "2d"
      );


    imageCtx.drawImage(
      video,
      x,
      y,
      width,
      height,
      0,
      0,
      width,
      height
    );


    const image =
      imageCanvas.toDataURL(
        "image/jpeg",
        .78
      );


    archive.push({

      id:
        track.id,

      type:
        track.type,

      confidence:
        track.score,

      firstSeen:
        currentTime(),

      moved:
        false,

      crossed:
        false,

      image

    });


    archiveCount.textContent =
      archive.length;

  }
  catch(error){

    console.warn(
      "Archive:",
      error
    );

  }

}


function renderArchive(){

  if(!archive.length){

    archiveGrid.innerHTML =
      "";

    return;

  }


  archiveGrid.innerHTML =
    archive
      .slice()
      .reverse()
      .map(
        item =>
          `
          <article class="archive-card">

            <img
              src="${item.image}"
              alt=""
            >

            <div class="archive-info">

              <strong>
                ${iconFor(item.type)}
                ${typeName(item.type)}
              </strong>

              <small>
                Виявлено о ${item.firstSeen}<br>
                Точність ${Math.round(item.confidence*100)}%
              </small>

            </div>

          </article>
          `
      )
      .join("");

}


/* =====================================================
   ALERT
===================================================== */

function triggerAlert(){

  const now =
    Date.now();

  if(
    now -
    lastAlert <
    1500
  )
    return;


  lastAlert =
    now;


  if(
    vibrationToggle.checked &&
    navigator.vibrate
  ){

    navigator.vibrate(
      [80,40,80]
    );

  }


  if(
    soundToggle.checked
  ){

    playAlertSound();

  }

}


/* =====================================================
   SOUND
===================================================== */

function playAlertSound(){

  try{

    if(!audioContext){

      audioContext =
        new (
          window.AudioContext ||
          window.webkitAudioContext
        )();

    }


    const oscillator =
      audioContext.createOscillator();

    const gain =
      audioContext.createGain();


    oscillator.frequency.value =
      720;

    oscillator.type =
      "sine";


    gain.gain.setValueAtTime(
      .001,
      audioContext.currentTime
    );

    gain.gain.exponentialRampToValueAtTime(
      .08,
      audioContext.currentTime+.01
    );

    gain.gain.exponentialRampToValueAtTime(
      .001,
      audioContext.currentTime+.18
    );


    oscillator.connect(
      gain
    );

    gain.connect(
      audioContext.destination
    );


    oscillator.start();

    oscillator.stop(
      audioContext.currentTime+.2
    );

  }
  catch(error){

    console.warn(
      "Audio:",
      error
    );

  }

}


/* =====================================================
   DRAW
===================================================== */

function redraw(){

  if(!running)
    return;


  ctx.clearRect(
    0,
    0,
    canvas.width,
    canvas.height
  );


  tracks.forEach(
    track => {

      const [
        x,
        y,
        w,
        h
      ] = track.bbox;


      ctx.strokeStyle =
        "#6c63ff";

      ctx.lineWidth =
        3;


      ctx.strokeRect(
        x,
        y,
        w,
        h
      );


      ctx.fillStyle =
        "#fffdf9";


      const label =
        `${typeName(track.type)} ${Math.round(track.score*100)}%`;


      const textWidth =
        ctx.measureText(label).width +
        18;


      ctx.fillRect(
        x,
        Math.max(
          0,
          y-25
        ),
        textWidth,
        22
      );


      ctx.fillStyle =
        "#4e46ca";

      ctx.font =
        "bold 13px Arial";


      ctx.fillText(
        label,
        x+9,
        Math.max(
          15,
          y-9
        )
      );

    }
  );


  requestAnimationFrame(
    redraw
  );

}


/* =====================================================
   ZONE
===================================================== */

zoneToggle.addEventListener(
  "change",
  () => {

    zone.enabled =
      zoneToggle.checked;

    saveZone();

    updateZoneUI();

  }
);


editZoneBtn.addEventListener(
  "click",
  () => {

    zoneEditing =
      !zoneEditing;

    zoneEditor.classList.toggle(
      "hidden",
      !zoneEditing
    );

    zoneOverlay.classList.toggle(
      "hidden",
      zoneEditing ||
      !zone.enabled
    );

  }
);


zoneBtn.addEventListener(
  "click",
  () => {

    zoneEditing =
      !zoneEditing;

    zoneEditor.classList.toggle(
      "hidden",
      !zoneEditing
    );

  }
);


function updateZoneUI(){

  zoneName.textContent =
    zone.enabled
      ? zone.name
      : "Зона вимкнена";

  zoneStatus.textContent =
    zone.enabled
      ? "Виявлення входу активне"
      : "Виявлення входу вимкнено";


  zoneOverlayLabel.textContent =
    zone.name;


  zoneOverlay.classList.toggle(
    "hidden",
    !zone.enabled ||
    zoneEditing
  );

}


function saveZone(){

  try{

    localStorage.setItem(
      "ghost_zone_v2",
      JSON.stringify(zone)
    );

  }
  catch(error){

    console.warn(
      error
    );

  }

}


function loadZone(){

  try{

    const saved =
      localStorage.getItem(
        "ghost_zone_v2"
      );

    if(!saved)
      return;

    const parsed =
      JSON.parse(saved);

    if(
      parsed &&
      Array.isArray(
        parsed.points
      ) &&
      parsed.points.length === 4
    ){

      zone =
        parsed;

      zoneToggle.checked =
        !!zone.enabled;

    }

  }
  catch(error){

    console.warn(
      error
    );

  }


  updateZoneUI();

}


/* =====================================================
   ZONE DRAG
===================================================== */

document
  .querySelectorAll(
    ".zone-handle"
  )
  .forEach(
    handle => {

      const corner =
        Number(
          handle.dataset.corner
        );


      function move(
        event
      ){

        if(!zoneEditing)
          return;


        const rect =
          zoneEditor.getBoundingClientRect();


        let x =
          (
            event.clientX -
            rect.left
          ) /
          rect.width;


        let y =
          (
            event.clientY -
            rect.top
          ) /
          rect.height;


        x =
          Math.max(
            0,
            Math.min(
              1,
              x
            )
          );


        y =
          Math.max(
            0,
            Math.min(
              1,
              y
            )
          );


        zone.points[
          corner
        ] = {
          x,
          y
        };


        handle.style.left =
          `${x*100}%`;

        handle.style.top =
          `${y*100}%`;


        saveZone();

      }


      handle.addEventListener(
        "pointerdown",
        event => {

          event.preventDefault();

          handle.setPointerCapture(
            event.pointerId
          );

        }
      );


      handle.addEventListener(
        "pointermove",
        move
      );

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

          const tab =
            button.dataset.tab;


          document
            .querySelectorAll(
              ".nav-button"
            )
            .forEach(
              item =>
                item.classList.toggle(
                  "active",
                  item === button
                )
            );


          if(tab === "camera"){

            cameraPage.classList.remove(
              "hidden"
            );

            document
              .getElementById(
                "archiveTab"
              )
              .classList.add(
                "hidden"
              );

            document
              .getElementById(
                "settingsTab"
              )
              .classList.add(
                "hidden"
              );

          }


          if(tab === "archive"){

            cameraPage.classList.add(
              "hidden"
            );

            document
              .getElementById(
                "archiveTab"
              )
              .classList.remove(
                "hidden"
              );

            document
              .getElementById(
                "settingsTab"
              )
              .classList.add(
                "hidden"
              );

          }


          if(tab === "settings"){

            cameraPage.classList.add(
              "hidden"
            );

            document
              .getElementById(
                "archiveTab"
              )
              .classList.add(
                "hidden"
              );

            document
              .getElementById(
                "settingsTab"
              )
              .classList.remove(
                "hidden"
              );

          }

        }
      );

    }
  );


/* =====================================================
   SETTINGS BUTTON
===================================================== */

settingsBtn.addEventListener(
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
   ARCHIVE BUTTONS
===================================================== */

clearArchive.addEventListener(
  "click",
  () => {

    archive = [];

    archiveGrid.innerHTML =
      "";

    archiveCount.textContent =
      "0";

  }
);


saveSession.addEventListener(
  "click",
  () => {

    const html =
      `
<!doctype html>
<html lang="uk">
<head>
<meta charset="UTF-8">
<title>GHOST Session</title>

<style>
body{
  font-family:Arial,sans-serif;
  background:#f7f6f2;
  color:#171717;
  padding:30px
}

.grid{
  display:grid;
  grid-template-columns:repeat(auto-fill,minmax(220px,1fr));
  gap:20px
}

.card{
  background:white;
  border-radius:18px;
  overflow:hidden
}

img{
  width:100%;
  display:block
}

.info{
  padding:14px
}
</style>

</head>

<body>

<h1>GHOST Session</h1>

<p>
Експортовано:
${new Date().toLocaleString("uk-UA")}
</p>

<div class="grid">

${archive.map(
  item =>
    `
    <div class="card">

      <img src="${item.image}">

      <div class="info">

        <strong>
          ${typeName(item.type)}
        </strong>

        <p>
          ${item.firstSeen}
        </p>

      </div>

    </div>
    `
).join("")}

</div>

</body>
</html>
      `;


    const blob =
      new Blob(
        [html],
        {
          type:"text/html"
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

    a.href =
      url;

    a.download =
      "ghost-session.html";

    a.click();


    URL.revokeObjectURL(
      url
    );

  }
);


/* =====================================================
   LOAD
===================================================== */

loadZone();


/* =====================================================
   DEFAULT VIEW
===================================================== */

roleScreen.classList.remove(
  "hidden"
);

cameraPage.classList.add(
  "hidden"
);

viewerPage.classList.add(
  "hidden"
);

bottomNav.classList.add(
  "hidden"
);


/* =====================================================
   CAMERA CONNECTION DATA
===================================================== */

if(cameraConnection){

  setupViewerDataChannel();

}