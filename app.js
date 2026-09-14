"use strict";

/* GHOST V3 — stable two-phone smart camera */

const $ = id => document.getElementById(id);

const video = $("video");
const canvas = $("canvas");
const ctx = canvas.getContext("2d");

const remoteVideo = $("remoteVideo");
const viewerCanvas = $("viewerCanvas");
const viewerCtx = viewerCanvas?.getContext("2d");


/* =========================================================
   AI
   ========================================================= */

const VEHICLES = [
  "car",
  "truck",
  "bus",
  "motorcycle",
  "bicycle"
];

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

const MATCH_DISTANCE = 110;
const MOVEMENT_DISTANCE = 24;
const MAX_TRACK_AGE = 1400;
const DETECTION_INTERVAL = 180;


/* =========================================================
   CAMERA STATE
   ========================================================= */

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
let detectionTimer = null;

let lastAlert = 0;
let zoneEditing = false;


/* =========================================================
   PEER STATE
   ========================================================= */

let peer = null;
let peerId = "";

let viewerConn = null;
let viewerCall = null;

let role = "";


/* =========================================================
   VIEWER STATE
   ========================================================= */

let viewerTracks = [];

let viewerZone = {
  enabled: false,
  name: "Контрольна зона",
  points: [
    {x:.25,y:.25},
    {x:.75,y:.25},
    {x:.75,y:.75},
    {x:.25,y:.75}
  ]
};

let viewerZoneEditing = false;
let viewerStateRAF = 0;


/* =========================================================
   CAMERA ZONE
   ========================================================= */

let zone = {
  enabled: false,
  name: "Контрольна зона",
  points: [
    {x:.25,y:.25},
    {x:.75,y:.25},
    {x:.75,y:.75},
    {x:.25,y:.75}
  ]
};


/* =========================================================
   HELPERS
   ========================================================= */

function typeName(type){

  return ({
    person:"Людина",
    car:"Автомобіль",
    truck:"Вантажівка",
    bus:"Автобус",
    motorcycle:"Мотоцикл",
    bicycle:"Велосипед",
    dog:"Собака",
    cat:"Кіт",
    backpack:"Рюкзак",
    handbag:"Сумка",
    suitcase:"Валіза",
    "cell phone":"Телефон",
    laptop:"Ноутбук",
    bottle:"Пляшка",
    cup:"Чашка"
  })[type] || type;

}


function iconFor(type){

  if(type==="person") return "👤";

  if(VEHICLES.includes(type)) return "🚗";

  if(type==="dog") return "🐕";

  if(type==="cat") return "🐈";

  if(type==="bicycle") return "🚲";

  return "◈";

}


function centerOf(b){

  return {
    x:b[0]+b[2]/2,
    y:b[1]+b[3]/2
  };

}


function distance(a,b){

  return Math.hypot(
    a.x-b.x,
    a.y-b.y
  );

}


function currentTime(){

  return new Date().toLocaleTimeString(
    [],
    {
      hour:"2-digit",
      minute:"2-digit",
      second:"2-digit"
    }
  );

}


function duration(){

  if(!sessionStarted){
    return "00:00";
  }

  const sec =
    Math.max(
      0,
      Math.floor(
        (Date.now()-sessionStarted)/1000
      )
    );

  return (
    String(Math.floor(sec/60)).padStart(2,"0")
    +
    ":"
    +
    String(sec%60).padStart(2,"0")
  );

}


function setStatus(
  main,
  state="",
  sub=""
){

  $("statusText").textContent = main;

  $("statusSub").textContent = sub;

  $("statusDot").className = state;

}


/* =========================================================
   ZONE STORAGE
   ========================================================= */

function saveZone(){

  try{

    localStorage.setItem(
      "ghost_zone",
      JSON.stringify(zone)
    );

  }catch(e){

    console.warn(
      "Zone save failed",
      e
    );

  }

}


function loadZone(){

  try{

    const saved =
      localStorage.getItem(
        "ghost_zone"
      );

    if(!saved){
      return;
    }

    const parsed =
      JSON.parse(saved);

    if(
      parsed &&
      Array.isArray(parsed.points) &&
      parsed.points.length===4
    ){

      zone = {
        enabled:!!parsed.enabled,

        name:
          parsed.name ||
          "Контрольна зона",

        points:
          parsed.points.map(
            p=>({

              x:
                Math.max(
                  0,
                  Math.min(
                    1,
                    Number(p.x)
                  )
                ),

              y:
                Math.max(
                  0,
                  Math.min(
                    1,
                    Number(p.y)
                  )
                )

            })
          )
      };

    }

  }catch(e){

    console.warn(
      "Zone restore failed",
      e
    );

  }

}


/* =========================================================
   ZONE UI
   ========================================================= */

function updateZoneUI(){

  $("zoneToggle").checked =
    !!zone.enabled;

  $("zoneName").textContent =
    zone.enabled
      ? zone.name
      : "Зона вимкнена";

  $("zoneStatus").textContent =
    zone.enabled
      ? "GHOST фіксує входи в зону"
      : "Виявлення перетинів вимкнено";

  $("zoneOverlayLabel").textContent =
    zone.name;

  $("zoneOverlay").classList.toggle(
    "hidden",
    !zone.enabled ||
    zoneEditing
  );

  positionZoneHandles();

}


function positionZoneHandles(){

  zone.points.forEach(
    (p,i)=>{

      const h =
        document.querySelector(
          `#zoneEditor .zone-handle[data-corner="${i}"]`
        );

      if(h){

        h.style.left =
          `${p.x*100}%`;

        h.style.top =
          `${p.y*100}%`;

      }

    }
  );

}


function positionViewerZoneHandles(){

  viewerZone.points.forEach(
    (p,i)=>{

      const h =
        document.querySelector(
          `#viewerZoneEditor .zone-handle[data-corner="${i}"]`
        );

      if(h){

        h.style.left =
          `${p.x*100}%`;

        h.style.top =
          `${p.y*100}%`;

      }

    }
  );

}


function pointInsideZone(point){

  const p =
    zone.points;

  let inside = false;

  for(
    let i=0,
        j=p.length-1;

    i<p.length;

    j=i++
  ){

    const xi=p[i].x;
    const yi=p[i].y;

    const xj=p[j].x;
    const yj=p[j].y;

    const intersect =
      (
        (yi>point.y) !==
        (yj>point.y)
      )
      &&
      point.x <
      (
        (xj-xi) *
        (point.y-yi) /
        (yj-yi)
        +
        xi
      );

    if(intersect){
      inside=!inside;
    }

  }

  return inside;

}


function direction(dx,dy){

  if(
    Math.abs(dx)<8 &&
    Math.abs(dy)<8
  ){

    return "—";

  }

  if(
    Math.abs(dx)>
    Math.abs(dy)
  ){

    return dx>0
      ? "праворуч"
      : "ліворуч";

  }

  return dy>0
    ? "вниз"
    : "вгору";

}


/* =========================================================
   SESSION
   ========================================================= */

function resetSession(){

  tracks=[];
  events=[];
  archive=[];

  nextTrackId=1;

  $("visibleCount").textContent="0";
  $("uniqueCount").textContent="0";
  $("zoneCount").textContent="0";

  $("eventCount").textContent="0";

  $("objectCountLabel").textContent="0";

  $("archiveCount").textContent="0";

  $("sessionTime").textContent="00:00";

  $("eventLog").innerHTML =
    '<div class="empty">Очікування активності</div>';

  $("objectList").innerHTML =
    '<div class="empty">Об’єкти ще не виявлені</div>';

  $("archiveGrid").innerHTML="";

  $("lastEvent").classList.add(
    "hidden"
  );

}


/* =========================================================
   VIDEO / CANVAS
   ========================================================= */

function resizeCanvas(){

  if(
    !video.videoWidth ||
    !video.videoHeight
  ){

    return;

  }

  canvas.width =
    video.videoWidth;

  canvas.height =
    video.videoHeight;

}


function resizeViewerCanvas(){

  if(
    !remoteVideo.videoWidth ||
    !remoteVideo.videoHeight
  ){

    return;

  }

  viewerCanvas.width =
    remoteVideo.videoWidth;

  viewerCanvas.height =
    remoteVideo.videoHeight;

}


/* =========================================================
   ZOOM
   ========================================================= */

async function setupZoom(){

  if(
    !videoTrack ||
    !videoTrack.getCapabilities
  ){

    return;

  }

  try{

    const capabilities =
      videoTrack.getCapabilities();

    if(!capabilities.zoom){

      $("zoomSlider").disabled=true;

      return;

    }

    const settings =
      videoTrack.getSettings
        ? videoTrack.getSettings()
        : {};

    const value =
      Number(
        settings.zoom ??
        capabilities.zoom.min
      );

    $("zoomSlider").min =
      capabilities.zoom.min;

    $("zoomSlider").max =
      capabilities.zoom.max;

    $("zoomSlider").step =
      capabilities.zoom.step || .1;

    $("zoomSlider").value =
      value;

    $("zoomValue").textContent =
      `${value.toFixed(1)}×`;

    $("zoomSlider").disabled=false;

  }catch(e){

    console.warn(
      "Zoom setup failed",
      e
    );

  }

}


$("zoomSlider").addEventListener(
  "input",
  async()=>{

    if(!videoTrack){
      return;
    }

    const value =
      Number(
        $("zoomSlider").value
      );

    $("zoomValue").textContent =
      `${value.toFixed(1)}×`;

    try{

      const constraints =
        videoTrack.getConstraints
          ? videoTrack.getConstraints()
          : {};

      await videoTrack.applyConstraints({

        ...constraints,

        advanced:[
          {
            zoom:value
          }
        ]

      });

    }catch(e){

      console.warn(
        "Zoom failed",
        e
      );

    }

  }
);


/* =========================================================
   START CAMERA
   ========================================================= */

async function startMonitoring(){

  if(running){
    return;
  }

  resetSession();

  setStatus(
    "ЗАПУСК",
    "",
    "Надання доступу до камери…"
  );

  $("cameraEmpty")
    .classList.remove("hidden");

  $("cameraEmpty")
    .querySelector("strong")
    .textContent =
      "Запуск камери";

  $("cameraEmpty")
    .querySelector("span")
    .textContent =
      "Надання доступу…";


  try{

    if(
      !navigator.mediaDevices ||
      !navigator.mediaDevices.getUserMedia
    ){

      throw new Error(
        "Цей браузер не підтримує доступ до камери."
      );

    }


    stream =
      await navigator.mediaDevices.getUserMedia({

        video:{

          facingMode:{
            ideal:"environment"
          },

          width:{
            ideal:1080
          },

          height:{
            ideal:1920
          },

          aspectRatio:{
            ideal:9/16
          }

        },

        audio:false

      });


    video.srcObject =
      stream;

    video.muted =
      true;

    video.playsInline =
      true;


    await video.play();


    videoTrack =
      stream.getVideoTracks()[0];


    resizeCanvas();


    video.addEventListener(
      "loadedmetadata",
      resizeCanvas,
      {
        once:true
      }
    );


    await setupZoom();


    $("cameraEmpty")
      .querySelector("strong")
      .textContent =
        "Підготовка AI";

    $("cameraEmpty")
      .querySelector("span")
      .textContent =
        "Завантаження моделі…";


    if(!model){

      model =
        await cocoSsd.load({
          base:"mobilenet_v2"
        });

    }


    running=true;
    detecting=true;

    sessionStarted =
      Date.now();


    sessionTimer =
      setInterval(
        ()=>{
          $("sessionTime")
            .textContent =
              duration();
        },
        1000
      );


    setStatus(
      "ОНЛАЙН",
      "online",
      "Камера активна"
    );


    $("recDot")
      .classList.add(
        "active"
      );

    $("recText")
      .textContent =
        "АКТИВНА";


    $("cameraEmpty")
      .classList.add(
        "hidden"
      );


    $("startBtn")
      .classList.add(
        "running"
      );

    $("startBtn")
      .innerHTML =
        "<span>■</span> Зупинити";


    /*
      Peer створюється після отримання stream.
      Це гарантує, що camera peer вже має
      реальний MediaStream для WebRTC.
    */

    startPeerCamera();

    detectLoop();

    redraw();

  }catch(e){

    console.error(e);

    stopMonitoring(false);

    setStatus(
      "ПОМИЛКА",
      "alert",
      e.message ||
      "Перевірте дозвіл браузера"
    );

    $("cameraEmpty")
      .classList.remove(
        "hidden"
      );

    $("cameraEmpty")
      .querySelector("strong")
      .textContent =
        "Немає доступу до камери";

    $("cameraEmpty")
      .querySelector("span")
      .textContent =
        "Перевірте дозвіл браузера.";

  }

}


/* =========================================================
   STOP CAMERA
   ========================================================= */

function stopMonitoring(
  closePeer=true
){

  running=false;
  detecting=false;


  if(detectionTimer){

    clearTimeout(
      detectionTimer
    );

    detectionTimer=null;

  }


  if(sessionTimer){

    clearInterval(
      sessionTimer
    );

    sessionTimer=null;

  }


  if(stream){

    stream
      .getTracks()
      .forEach(
        t=>t.stop()
      );

  }


  stream=null;
  videoTrack=null;

  video.srcObject=null;


  ctx.clearRect(
    0,
    0,
    canvas.width,
    canvas.height
  );


  setStatus(
    "ГОТОВИЙ",
    "",
    "Камера не активна"
  );


  $("recDot")
    .classList.remove(
      "active"
    );

  $("recText")
    .textContent =
      "НЕАКТИВНА";


  $("cameraEmpty")
    .classList.remove(
      "hidden"
    );

  $("cameraEmpty")
    .querySelector("strong")
    .textContent =
      "Камера готова";

  $("cameraEmpty")
    .querySelector("span")
    .textContent =
      "Натисніть «Почати»";


  $("startBtn")
    .classList.remove(
      "running"
    );

  $("startBtn")
    .innerHTML =
      "<span>●</span> Почати моніторинг";


  $("zoomSlider")
    .disabled=true;


  if(closePeer){

    closePeerCamera();

  }

}


/* =========================================================
   DETECTION LOOP
   ========================================================= */

async function detectLoop(){

  if(
    !running ||
    !detecting ||
    !model
  ){

    return;

  }


  try{

    const predictions =
      await model.detect(
        video,
        20,
        .35
      );


    processObjects(
      predictions.filter(
        p=>CLASSES.includes(
          p.class
        )
      )
    );

  }catch(e){

    console.error(
      "Detection",
      e
    );

  }


  if(running){

    detectionTimer =
      setTimeout(
        detectLoop,
        DETECTION_INTERVAL
      );

  }

}


/* =========================================================
   TRACKING
   ========================================================= */

function processObjects(
  predictions
){

  const now =
    Date.now();

  const newTracks=[];

  const used =
    new Set();


  predictions.forEach(
    pred=>{

      const center =
        centerOf(
          pred.bbox
        );

      let best=null;
      let bestDistance=Infinity;


      tracks.forEach(
        t=>{

          if(
            used.has(t.id) ||
            t.type!==pred.class
          ){

            return;

          }


          if(
            now-t.lastSeen>
            MAX_TRACK_AGE
          ){

            return;

          }


          const d =
            distance(
              center,
              t.center
            );


          if(
            d<bestDistance &&
            d<=MATCH_DISTANCE
          ){

            bestDistance=d;
            best=t;

          }

        }
      );


      if(best){

        used.add(
          best.id
        );


        const dx =
          center.x-
          best.center.x;

        const dy =
          center.y-
          best.center.y;

        const movement =
          Math.hypot(
            dx,
            dy
          );


        const wasInside =
          best.insideZone;


        const isInside =
          zone.enabled &&
          pointInsideZone({

            x:
              center.x /
              Math.max(
                1,
                canvas.width
              ),

            y:
              center.y /
              Math.max(
                1,
                canvas.height
              )

          });


        best.center =
          center;

        best.bbox =
          pred.bbox;

        best.score =
          pred.score;

        best.lastSeen =
          now;

        best.direction =
          direction(
            dx,
            dy
          );

        best.moved =
          movement >=
          MOVEMENT_DISTANCE;


        if(
          best.moved &&
          $("movementToggle").checked &&
          now-
          best.lastMovementEvent>
          2500
        ){

          best.lastMovementEvent =
            now;

          addEvent(
            best,
            "РУХ"
          );

        }


        if(
          zone.enabled &&
          !wasInside &&
          isInside
        ){

          best.crossed=true;

          $("zoneCount")
            .textContent =
              String(
                Number(
                  $("zoneCount")
                    .textContent ||
                  0
                )+1
              );


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

      }else{

        const inside =
          zone.enabled &&
          pointInsideZone({

            x:
              center.x /
              Math.max(
                1,
                canvas.width
              ),

            y:
              center.y /
              Math.max(
                1,
                canvas.height
              )

          });


        const track={

          id:
            nextTrackId++,

          type:
            pred.class,

          center,

          bbox:
            pred.bbox,

          score:
            pred.score,

          firstSeen:
            now,

          lastSeen:
            now,

          lastMovementEvent:
            0,

          direction:
            "—",

          moved:
            false,

          crossed:
            false,

          insideZone:
            inside

        };


        newTracks.push(
          track
        );


        createArchive(
          track
        );

      }

    }
  );


  tracks=[

    ...newTracks,

    ...tracks.filter(
      t=>
        now-t.lastSeen<
        MAX_TRACK_AGE
        &&
        !newTracks.some(
          n=>n.id===t.id
        )
    )

  ];


  const visible =
    tracks.filter(
      t=>
        now-t.lastSeen<
        500
    );


  $("visibleCount")
    .textContent =
      String(
        visible.length
      );


  $("uniqueCount")
    .textContent =
      String(
        new Set(
          tracks.map(
            t=>t.id
          )
        ).size
      );


  renderObjects(
    visible
  );

  renderArchive();

  sendDetectionState();

}


/* =========================================================
   EVENTS
   ========================================================= */

function addEvent(
  track,
  action
){

  const event={

    id:
      Date.now()+
      Math.random(),

    time:
      currentTime(),

    type:
      track.type,

    action,

    direction:
      track.direction

  };


  events.unshift(
    event
  );

  events =
    events.slice(
      0,
      40
    );


  $("eventCount")
    .textContent =
      String(
        events.length
      );


  $("eventLog")
    .innerHTML =
      events.map(
        x=>`

          <div class="event-row">

            <div class="event-time">
              ${x.time}
            </div>

            <div class="event-icon">
              ${iconFor(x.type)}
            </div>

            <div>

              <div class="event-main">
                ${typeName(x.type)} · ${x.action}
              </div>

              <span class="event-sub">
                ${
                  x.direction &&
                  x.direction!=="—"
                    ? `Напрямок ${x.direction}`
                    : "Подія зафіксована"
                }
              </span>

            </div>

          </div>

        `
      ).join("");


  $("lastEventText")
    .textContent =
      `${typeName(track.type)} · ${action.toLowerCase()}`;


  $("lastEvent")
    .classList.remove(
      "hidden"
    );


  sendPeer({

    kind:
      "event",

    event

  });

}


/* =========================================================
   ALERT
   ========================================================= */

function triggerAlert(){

  const now =
    Date.now();


  if(
    now-lastAlert<
    1200
  ){

    return;

  }


  lastAlert =
    now;


  if(
    $("vibrationToggle").checked &&
    navigator.vibrate
  ){

    navigator.vibrate(
      [
        80,
        50,
        120
      ]
    );

  }


  if(
    $("soundToggle").checked
  ){

    try{

      const AudioCtx =
        window.AudioContext ||
        window.webkitAudioContext;


      if(AudioCtx){

        const audio =
          new AudioCtx();

        const oscillator =
          audio.createOscillator();

        const gain =
          audio.createGain();


        oscillator.frequency.value =
          720;

        gain.gain.value =
          .035;


        oscillator.connect(
          gain
        );

        gain.connect(
          audio.destination
        );


        oscillator.start();

        oscillator.stop(
          audio.currentTime+
          .12
        );

      }

    }catch(e){

      console.warn(
        "Sound failed",
        e
      );

    }

  }


  setStatus(
    "УВАГА",
    "alert",
    "Об’єкт увійшов у зону"
  );


  setTimeout(
    ()=>{
      if(running){

        setStatus(
          "ОНЛАЙН",
          "online",
          "Камера активна"
        );

      }
    },
    1600
  );

}


/* =========================================================
   ARCHIVE
   ========================================================= */

function createArchive(
  track
){

  if(
    !video.videoWidth ||
    !video.videoHeight
  ){

    return;

  }


  try{

    const pad=30;

    const b=
      track.bbox;

    const x=
      Math.max(
        0,
        b[0]-pad
      );

    const y=
      Math.max(
        0,
        b[1]-pad
      );

    const w=
      Math.min(
        video.videoWidth-x,
        b[2]+pad*2
      );

    const h=
      Math.min(
        video.videoHeight-y,
        b[3]+pad*2
      );


    const c =
      document.createElement(
        "canvas"
      );


    c.width =
      Math.max(
        1,
        Math.round(w)
      );

    c.height =
      Math.max(
        1,
        Math.round(h)
      );


    c.getContext("2d")
      .drawImage(
        video,
        x,
        y,
        w,
        h,
        0,
        0,
        c.width,
        c.height
      );


    archive.unshift({

      id:
        track.id,

      type:
        track.type,

      score:
        track.score,

      firstSeen:
        currentTime(),

      moved:
        false,

      crossed:
        track.insideZone,

      image:
        c.toDataURL(
          "image/jpeg",
          .78
        )

    });


    archive =
      archive.slice(
        0,
        60
      );


    $("archiveCount")
      .textContent =
        String(
          archive.length
        );

  }catch(e){

    console.warn(
      "Archive snapshot failed",
      e
    );

  }

}


function renderArchive(){

  $("archiveGrid")
    .innerHTML =
      archive.length

        ? archive.map(
            a=>`

              <article class="archive-card">

                <img
                  src="${a.image}"
                  alt="${typeName(a.type)}"
                >

                <div class="archive-info">

                  <strong>
                    ${iconFor(a.type)}
                    ${typeName(a.type)}
                  </strong>

                  <small>
                    Впевненість:
                    ${Math.round(a.score*100)}%
                    <br>
                    Трек #${a.id}
                  </small>

                </div>

              </article>

            `
          ).join("")

        : "<div class='empty'>Архів порожній</div>";

}


/* =========================================================
   OBJECT LIST
   ========================================================= */

function renderObjects(
  list
){

  $("objectCountLabel")
    .textContent =
      String(
        list.length
      );


  $("objectList")
    .innerHTML =
      list.length

        ? list.map(
            t=>`

              <article class="object-card">

                <div class="object-card-top">

                  <strong>
                    ${iconFor(t.type)}
                    ${typeName(t.type)}
                  </strong>

                  <span class="object-score">
                    ${Math.round(t.score*100)}%
                  </span>

                </div>

                <div class="object-meta">
                  Трек #${t.id}
                  ·
                  ${t.direction}
                  ·
                  ${
                    t.insideZone
                      ? "у зоні"
                      : "поза зоною"
                  }
                </div>

              </article>

            `
          ).join("")

        : "<div class='empty'>Об’єкти ще не виявлені</div>";

}


/* =========================================================
   DRAWING
   ========================================================= */

function drawPolygon(
  targetCtx,
  w,
  h,
  points,
  fill=true
){

  if(
    !points ||
    points.length<3
  ){

    return;

  }


  targetCtx.save();

  targetCtx.beginPath();


  points.forEach(
    (p,i)=>{

      const x=
        p.x*w;

      const y=
        p.y*h;


      if(i){

        targetCtx.lineTo(
          x,
          y
        );

      }else{

        targetCtx.moveTo(
          x,
          y
        );

      }

    }
  );


  targetCtx.closePath();


  if(fill){

    targetCtx.fillStyle =
      "#6c63ff18";

    targetCtx.fill();

  }


  targetCtx.lineWidth =
    Math.max(
      3,
      w/420
    );

  targetCtx.strokeStyle =
    "#6c63ffcc";

  targetCtx.stroke();

  targetCtx.restore();

}


function drawTrack(
  targetCtx,
  track,
  canvasWidth
){

  const [
    x,
    y,
    w,
    h
  ] =
    track.bbox;


  targetCtx.lineWidth =
    Math.max(
      2,
      canvasWidth/600
    );


  targetCtx.strokeStyle =
    track.crossed
      ? "#ee655e"
      : "#6c63ff";


  targetCtx.fillStyle =
    "#ffffffdd";


  targetCtx.strokeRect(
    x,
    y,
    w,
    h
  );


  targetCtx.font =
    `${Math.max(
      12,
      canvasWidth/75
    )}px -apple-system,BlinkMacSystemFont,Arial`;


  const label =
    `${typeName(track.type)} ${Math.round(track.score*100)}%`;


  const tw =
    targetCtx.measureText(
      label
    ).width+14;


  targetCtx.fillRect(
    x,
    Math.max(
      0,
      y-26
    ),
    tw,
    22
  );


  targetCtx.fillStyle =
    track.crossed
      ? "#d95550"
      : "#5148d0";


  targetCtx.fillText(
    label,
    x+7,
    Math.max(
      16,
      y-10
    )
  );


  if(track.moved){

    targetCtx.fillStyle =
      "#2db879";

    targetCtx.beginPath();

    targetCtx.arc(
      x+w-9,
      y+9,
      5,
      0,
      Math.PI*2
    );

    targetCtx.fill();

  }

}


function redraw(){

  if(!running){

    return;

  }


  ctx.clearRect(
    0,
    0,
    canvas.width,
    canvas.height
  );


  if(zone.enabled){

    drawPolygon(
      ctx,
      canvas.width,
      canvas.height,
      zone.points,
      true
    );

  }


  const now =
    Date.now();


  tracks
    .filter(
      t=>
        now-t.lastSeen<
        500
    )
    .forEach(
      t=>
        drawTrack(
          ctx,
          t,
          canvas.width
        )
    );


  requestAnimationFrame(
    redraw
  );

}


/* =========================================================
   SEND AI STATE
   ========================================================= */

function sendDetectionState(){

  if(
    !viewerConn ||
    !viewerConn.open
  ){

    return;

  }


  const now =
    Date.now();


  const visible =
    tracks
      .filter(
        t=>
          now-t.lastSeen<
          500
      )
      .map(
        t=>({

          id:
            t.id,

          type:
            t.type,

          score:
            t.score,

          bbox:
            t.bbox,

          direction:
            t.direction,

          insideZone:
            t.insideZone,

          moved:
            t.moved,

          crossed:
            t.crossed

        })
      );


  sendPeer({

    kind:
      "state",

    tracks:
      visible,

    zone:{

      enabled:
        zone.enabled,

      name:
        zone.name,

      points:
        zone.points

    },

    stats:{

      visible:
        visible.length,

      unique:
        new Set(
          tracks.map(
            t=>t.id
          )
        ).size,

      zone:
        Number(
          $("zoneCount")
            .textContent ||
          0
        )

    }

  });

}


/* =========================================================
   VIEWER DRAW
   ========================================================= */

function drawViewerState(){

  if(
    !viewerCtx ||
    !viewerCanvas.width
  ){

    return;

  }


  viewerCtx.clearRect(
    0,
    0,
    viewerCanvas.width,
    viewerCanvas.height
  );


  if(viewerZone.enabled){

    drawPolygon(
      viewerCtx,
      viewerCanvas.width,
      viewerCanvas.height,
      viewerZone.points,
      true
    );

  }


  viewerTracks.forEach(
    t=>
      drawTrack(
        viewerCtx,
        t,
        viewerCanvas.width
      )
  );


  cancelAnimationFrame(
    viewerStateRAF
  );


  viewerStateRAF =
    requestAnimationFrame(
      drawViewerState
    );

}


/* =========================================================
   CAMERA ZONE EDITOR
   ========================================================= */

function toggleZoneEditor(){

  zoneEditing =
    !zoneEditing;


  $("zoneEditor")
    .classList.toggle(
      "hidden",
      !zoneEditing
    );


  $("zoneOverlay")
    .classList.toggle(
      "hidden",
      !zone.enabled ||
      zoneEditing
    );


  $("zoneBtn")
    .textContent =
      zoneEditing
        ? "✓ Готово"
        : "◇ Зона";


  $("editZoneBtn")
    .textContent =
      zoneEditing
        ? "✓ Готово"
        : "Налаштувати зону";


  positionZoneHandles();

}


function initZoneDrag(){

  document
    .querySelectorAll(
      "#zoneEditor .zone-handle"
    )
    .forEach(
      h=>{

        h.addEventListener(
          "pointerdown",
          e=>{

            e.preventDefault();

            h.setPointerCapture?.(
              e.pointerId
            );


            const move =
              ev=>{

                const r =
                  $("cameraStage")
                    .getBoundingClientRect();


                let x =
                  (ev.clientX-r.left)/
                  r.width;

                let y =
                  (ev.clientY-r.top)/
                  r.height;


                x=
                  Math.max(
                    .02,
                    Math.min(
                      .98,
                      x
                    )
                  );


                y=
                  Math.max(
                    .02,
                    Math.min(
                      .98,
                      y
                    )
                  );


                zone.points[
                  Number(
                    h.dataset.corner
                  )
                ]={
                  x,
                  y
                };


                positionZoneHandles();

                saveZone();

                sendPeer({
                  kind:"zone",
                  zone
                });

              };


            const up =
              ()=>{
                
                h.removeEventListener(
                  "pointermove",
                  move
                );

                h.removeEventListener(
                  "pointerup",
                  up
                );


                sendPeer({
                  kind:"zone",
                  zone
                });

              };


            h.addEventListener(
              "pointermove",
              move
            );


            h.addEventListener(
              "pointerup",
              up,
              {
                once:true
              }
            );

          }
        );

      }
    );

}


/* =========================================================
   PEER IDS
   ========================================================= */

function makePeerId(){

  return (
    "ghost-"+
    Math.random()
      .toString(36)
      .slice(2,8)
  );

}


/* =========================================================
   CAMERA PEER
   ========================================================= */

function startPeerCamera(){

  if(peer){

    return;

  }


  peer =
    new Peer(
      makePeerId(),
      {

        debug:1,

        config:{

          iceServers:[

            {
              urls:
                "stun:stun.l.google.com:19302"
            },

            {
              urls:
                "stun:stun1.l.google.com:19302"
            }

          ]

        }

      }
    );


  peer.on(
    "open",
    id=>{

      peerId =
        id;


      $("peerIdField")
        .value =
          id;


      $("connectionState")
        .textContent =
          "ГОТОВА";


      $("connectionState")
        .classList.add(
          "online"
        );


      renderQR(
        id
      );

    }
  );


  /*
    Viewer should normally receive the stream
    from the camera. If a viewer ever initiates
    a call itself, camera answers safely.
  */

  peer.on(
    "call",
    call=>{

      if(stream){

        call.answer(
          stream
        );

      }else{

        call.close();

      }

    }
  );


  peer.on(
    "connection",
    conn=>{

      setupDataConnection(
        conn
      );

    }
  );


  peer.on(
    "error",
    e=>{

      console.warn(
        "Camera Peer error",
        e
      );


      $("connectionState")
        .textContent =
          "ПОМИЛКА";


      $("connectionState")
        .classList.remove(
          "online"
        );

    }
  );


  peer.on(
    "disconnected",
    ()=>{

      $("connectionState")
        .textContent =
          "ПЕРЕПІДКЛЮЧЕННЯ";


      try{

        peer.reconnect();

      }catch(e){

        console.warn(e);

      }

    }
  );

}


/* =========================================================
   CAMERA → VIEWER MEDIA
   ========================================================= */

function callViewer(
  viewerId
){

  if(
    !peer ||
    !stream ||
    !viewerId
  ){

    return;

  }


  try{

    /*
      Do not create duplicate media calls
      to the same viewer.
    */

    if(
      viewerCall &&
      viewerCall.peer===
      viewerId
    ){

      return;

    }


    const call =
      peer.call(
        viewerId,
        stream,
        {
          metadata:{
            ghost:true
          }
        }
      );


    viewerCall =
      call;


    call.on(
      "close",
      ()=>{

        if(
          viewerCall===
          call
        ){

          viewerCall =
            null;

        }

      }
    );


    call.on(
      "error",
      e=>{

        console.warn(
          "Camera media call error",
          e
        );


        if(
          viewerCall===
          call
        ){

          viewerCall =
            null;

        }

      }
    );

  }catch(e){

    console.warn(
      "callViewer failed",
      e
    );

  }

}


/* =========================================================
   DATA CONNECTION — CAMERA SIDE
   ========================================================= */

function setupDataConnection(
  conn
){

  viewerConn =
    conn;


  conn.on(
    "open",
    ()=>{

      $("connectionState")
        .textContent =
          "ПІДКЛЮЧЕНО";


      $("connectionState")
        .classList.add(
          "online"
        );


      conn.send({

        kind:
          "hello",

        name:
          $("cameraTitle")
            .textContent

      });


      conn.send({

        kind:
          "zone",

        zone

      });


      sendDetectionState();


      /*
        КЛЮЧОВОЕ ИСПРАВЛЕНИЕ:
        камера сама инициирует media call
        после того, как data connection viewer
        уже открыт.
      */

      callViewer(
        conn.peer
      );

    }
  );


  conn.on(
    "data",
    data=>{

      if(
        !data ||
        typeof data!=="object"
      ){

        return;

      }


      if(
        data.kind===
        "request-state" ||
        data.kind===
        "request-stream"
      ){

        sendDetectionState();


        sendPeer({

          kind:
            "zone",

          zone

        });


        if(stream){

          callViewer(
            conn.peer
          );

        }

      }


      /*
        Viewer changed the whole zone.
      */

      if(
        data.kind===
        "set-zone" &&
        data.zone &&
        Array.isArray(
          data.zone.points
        )
      ){

        zone={

          enabled:
            !!data.zone.enabled,

          name:
            data.zone.name ||
            zone.name,

          points:
            data.zone.points
              .slice(0,4)
              .map(
                p=>({

                  x:
                    Math.max(
                      0,
                      Math.min(
                        1,
                        Number(p.x)
                      )
                    ),

                  y:
                    Math.max(
                      0,
                      Math.min(
                        1,
                        Number(p.y)
                      )
                    )

                })
              )

        };


        saveZone();

        updateZoneUI();

        sendDetectionState();

      }


      /*
        Viewer enabled / disabled zone.
      */

      if(
        data.kind===
        "set-zone-enabled"
      ){

        zone.enabled =
          !!data.enabled;


        saveZone();

        updateZoneUI();


        sendPeer({

          kind:
            "zone",

          zone

        });

      }

    }
  );


  conn.on(
    "close",
    ()=>{

      if(
        viewerConn===
        conn
      ){

        viewerConn=null;

      }


      viewerCall=null;


      $("connectionState")
        .textContent =
          "ГОТОВА";

    }
  );


  conn.on(
    "error",
    e=>{

      console.warn(
        "Data connection",
        e
      );

    }
  );

}


/* =========================================================
   SEND PEER DATA
   ========================================================= */

function sendPeer(
  data
){

  if(
    !viewerConn ||
    !viewerConn.open
  ){

    return;

  }


  try{

    viewerConn.send(
      data
    );

  }catch(e){

    console.warn(
      "Peer send failed",
      e
    );

  }

}


/* =========================================================
   CLOSE CAMERA PEER
   ========================================================= */

function closePeerCamera(){

  viewerCall=null;
  viewerConn=null;


  if(peer){

    try{

      peer.destroy();

    }catch(e){

      console.warn(e);

    }

  }


  peer=null;
  peerId="";


  $("peerIdField")
    .value =
      "—";


  $("qrCode")
    .innerHTML =
      "";


  $("connectionState")
    .textContent =
      "OFFLINE";


  $("connectionState")
    .classList.remove(
      "online"
    );

}


/* =========================================================
   QR
   ========================================================= */

function renderQR(
  id
){

  $("qrCode")
    .innerHTML =
      "";


  const url =
    new URL(
      location.href
    );


  url.search="";
  url.hash="";


  url.searchParams.set(
    "mode",
    "viewer"
  );


  url.searchParams.set(
    "camera",
    id
  );


  new QRCode(
    $("qrCode"),
    {

      text:
        url.toString(),

      width:
        105,

      height:
        105,

      colorDark:
        "#171717",

      colorLight:
        "#ffffff",

      correctLevel:
        QRCode.CorrectLevel.M

    }
  );

}


/* =========================================================
   VIEWER PEER
   ========================================================= */

function createViewerPeer(){

  return new Promise(
    (resolve,reject)=>{

      if(peer){

        try{

          peer.destroy();

        }catch(e){}

        peer=null;

      }


      peer =
        new Peer(
          makePeerId(),
          {

            debug:1,

            config:{

              iceServers:[

                {
                  urls:
                    "stun:stun.l.google.com:19302"
                },

                {
                  urls:
                    "stun:stun1.l.google.com:19302"
                }

              ]

            }

          }
        );


      peer.on(
        "open",
        id=>{

          console.log(
            "Viewer peer ready",
            id
          );

          resolve(id);

        }
      );


      /*
        Viewer receives the MediaStream.
      */

      peer.on(
        "call",
        call=>{

          call.answer();


          call.on(
            "stream",
            remoteStream=>{

              remoteVideo.srcObject =
                remoteStream;

              remoteVideo.muted =
                true;

              remoteVideo.playsInline =
                true;

              remoteVideo.autoplay =
                true;


              remoteVideo
                .play()
                .catch(
                  ()=>{}
                );


              $("viewerEmpty")
                .classList.add(
                  "hidden"
                );


              $("viewerState")
                .textContent =
                  "ОНЛАЙН";


              $("viewerDot")
                .classList.add(
                  "active"
                );


              resizeViewerCanvas();


              remoteVideo.addEventListener(
                "loadedmetadata",
                resizeViewerCanvas,
                {
                  once:true
                }
              );


              drawViewerState();

            }
          );


          call.on(
            "close",
            ()=>{

              $("viewerState")
                .textContent =
                  "ПОТОК ЗАВЕРШЕНО";


              $("viewerDot")
                .classList.remove(
                  "active"
                );

            }
          );


          call.on(
            "error",
            e=>
              console.warn(
                "Viewer media call",
                e
              )
          );

        }
      );


      peer.on(
        "error",
        e=>{

          console.warn(
            "Viewer Peer error",
            e
          );


          $("viewerState")
            .textContent =
              "ПОМИЛКА";


          $("viewerDot")
            .classList.remove(
              "active"
            );


          $("viewerEmpty")
            .classList.remove(
              "hidden"
            );


          $("viewerEmpty")
            .querySelector("strong")
            .textContent =
              "Не вдалося підключитися";


          $("viewerEmpty")
            .querySelector("span")
            .textContent =
              "Перевірте код і чи камера онлайн.";


          reject(e);

        }
      );


      peer.on(
        "disconnected",
        ()=>{

          try{

            peer.reconnect();

          }catch(e){

            console.warn(e);

          }

        }
      );

    }
  );

}


/* =========================================================
   VIEWER CONNECTION
   ========================================================= */

function connectViewer(
  id
){

  id =
    String(
      id || ""
    ).trim();


  /*
    FIX:
    if user presses viewer role without
    entering code, show viewer screen and
    focus the manual code field.
  */

  if(!id){

    $("viewerEmpty")
      .classList.remove(
        "hidden"
      );


    $("viewerEmpty")
      .querySelector("strong")
      .textContent =
        "Введіть код камери";


    $("viewerEmpty")
      .querySelector("span")
      .textContent =
        "Наприклад: ghost-a8f3";


    $("manualPeerId")
      .focus();


    return;

  }


  $("manualPeerId")
    .value =
      id;


  $("viewerEmpty")
    .classList.remove(
      "hidden"
    );


  $("viewerEmpty")
    .querySelector("strong")
    .textContent =
      "Підключення…";


  $("viewerEmpty")
    .querySelector("span")
    .textContent =
      `Пошук ${id}`;


  $("viewerState")
    .textContent =
      "ПІДКЛЮЧЕННЯ";


  $("viewerDot")
    .classList.remove(
      "active"
    );


  createViewerPeer()
    .then(
      ()=>{
        
        const conn =
          peer.connect(
            id,
            {
              reliable:true,
              serialization:"json"
            }
          );


        viewerConn =
          conn;


        conn.on(
          "open",
          ()=>{

            $("viewerState")
              .textContent =
                "КАМЕРА ЗНАЙДЕНА";


            $("viewerDot")
              .classList.add(
                "active"
              );


            $("viewerEmpty")
              .querySelector("strong")
              .textContent =
                "Камера знайдена";


            $("viewerEmpty")
              .querySelector("span")
              .textContent =
                "Очікуємо відеопотік…";


            conn.send({

              kind:
                "request-stream"

            });


            conn.send({

              kind:
                "request-state"

            });

          }
        );


        conn.on(
          "data",
          data=>{

            if(
              !data ||
              typeof data!=="object"
            ){

              return;

            }


            if(
              data.kind===
              "hello"
            ){

              $("viewerTitle")
                .textContent =
                  data.name ||
                  "GHOST Camera";

            }


            if(
              data.kind===
              "zone"
            ){

              applyViewerZone(
                data.zone
              );

            }


            if(
              data.kind===
              "state"
            ){

              viewerTracks =
                Array.isArray(
                  data.tracks
                )
                  ? data.tracks
                  : [];


              if(data.zone){

                applyViewerZone(
                  data.zone
                );

              }


              drawViewerState();

            }


            if(
              data.kind===
              "event"
            ){

              addViewerEvent(
                data.event
              );

            }

          }
        );


        conn.on(
          "close",
          ()=>{

            $("viewerState")
              .textContent =
                "OFFLINE";


            $("viewerDot")
              .classList.remove(
                "active"
              );


            $("viewerEmpty")
              .classList.remove(
                "hidden"
              );


            $("viewerEmpty")
              .querySelector("strong")
              .textContent =
                "Камера відключена";


            $("viewerEmpty")
              .querySelector("span")
              .textContent =
                "Натисніть «Підключити», щоб спробувати знову.";

          }
        );


        conn.on(
          "error",
          e=>
            console.warn(
              "Viewer data connection",
              e
            )
        );

      }
    )
    .catch(
      ()=>{}
    );

}


/* =========================================================
   VIEWER ZONE
   ========================================================= */

function applyViewerZone(
  data
){

  if(
    !data ||
    !Array.isArray(
      data.points
    ) ||
    data.points.length!==4
  ){

    return;

  }


  viewerZone={

    enabled:
      !!data.enabled,

    name:
      data.name ||
      "Контрольна зона",

    points:
      data.points.map(
        p=>({

          x:
            Math.max(
              0,
              Math.min(
                1,
                Number(p.x)
              )
            ),

          y:
            Math.max(
              0,
              Math.min(
                1,
                Number(p.y)
              )
            )

        })
      )

  };


  updateViewerZoneUI();

  drawViewerState();

}


function updateViewerZoneUI(){

  $("viewerZoneToggle")
    .checked =
      !!viewerZone.enabled;


  $("viewerZoneStatus")
    .textContent =
      viewerZone.enabled
        ? "Активна · входи контролюються"
        : "Вимкнена";


  $("viewerZoneLabel")
    .textContent =
      viewerZone.name ||
      "Контрольна зона";


  $("viewerZoneEditor")
    .classList.toggle(
      "hidden",
      !viewerZoneEditing
    );


  positionViewerZoneHandles();

}


function toggleViewerZoneEditor(){

  if(
    !viewerConn ||
    !viewerConn.open
  ){

    $("viewerConnectionHint")
      .textContent =
        "Спочатку підключіть камеру.";

    return;

  }


  viewerZoneEditing =
    !viewerZoneEditing;


  $("viewerZoneBtn")
    .textContent =
      viewerZoneEditing
        ? "✓ Готово"
        : "◇ Зона";


  $("viewerZoneEditor")
    .classList.toggle(
      "hidden",
      !viewerZoneEditing
    );


  positionViewerZoneHandles();

}


function initViewerZoneDrag(){

  document
    .querySelectorAll(
      "#viewerZoneEditor .zone-handle"
    )
    .forEach(
      h=>{

        h.addEventListener(
          "pointerdown",
          e=>{

            e.preventDefault();

            h.setPointerCapture?.(
              e.pointerId
            );


            const move =
              ev=>{

                const r =
                  $("viewerStage")
                    .getBoundingClientRect();


                let x =
                  (ev.clientX-r.left)/
                  r.width;

                let y =
                  (ev.clientY-r.top)/
                  r.height;


                x=
                  Math.max(
                    .02,
                    Math.min(
                      .98,
                      x
                    )
                  );


                y=
                  Math.max(
                    .02,
                    Math.min(
                      .98,
                      y
                    )
                  );


                viewerZone.points[
                  Number(
                    h.dataset.corner
                  )
                ]={
                  x,
                  y
                };


                positionViewerZoneHandles();

                drawViewerState();

              };


            const up =
              ()=>{

                h.removeEventListener(
                  "pointermove",
                  move
                );

                h.removeEventListener(
                  "pointerup",
                  up
                );


                sendPeer({

                  kind:
                    "set-zone",

                  zone:
                    viewerZone

                });

              };


            h.addEventListener(
              "pointermove",
              move
            );


            h.addEventListener(
              "pointerup",
              up,
              {
                once:true
              }
            );

          }
        );

      }
    );

}


function sendViewerZoneEnabled(){

  viewerZone.enabled =
    $("viewerZoneToggle")
      .checked;


  drawViewerState();


  sendPeer({

    kind:
      "set-zone-enabled",

    enabled:
      viewerZone.enabled

  });

}


/* =========================================================
   VIEWER EVENTS
   ========================================================= */

function addViewerEvent(
  e
){

  if(!e){
    return;
  }


  const count =
    Number(
      $("viewerEventCount")
        .textContent ||
      0
    )+1;


  $("viewerEventCount")
    .textContent =
      String(count);


  const row = `

    <div class="event-row">

      <div class="event-time">
        ${e.time || "—"}
      </div>

      <div class="event-icon">
        ${iconFor(e.type)}
      </div>

      <div>

        <div class="event-main">
          ${typeName(e.type)} · ${e.action}
        </div>

        <span class="event-sub">
          Подія з камери
        </span>

      </div>

    </div>

  `;


  const empty =
    $("viewerEventLog")
      .querySelector(
        ".empty"
      );


  if(empty){

    $("viewerEventLog")
      .innerHTML =
        "";

  }


  $("viewerEventLog")
    .insertAdjacentHTML(
      "afterbegin",
      row
    );

}


/* =========================================================
   ROLE / NAVIGATION
   ========================================================= */

function showRoleCamera(){

  role="camera";


  $("roleChooser")
    .classList.add(
      "hidden"
    );


  $("viewerPage")
    .classList.add(
      "hidden"
    );


  $("cameraPage")
    .classList.remove(
      "hidden"
    );


  $("bottomNav")
    .classList.remove(
      "hidden"
    );


  loadZone();

  updateZoneUI();

}


function initViewer(
  id=""
){

  role="viewer";


  $("roleChooser")
    .classList.add(
      "hidden"
    );


  $("cameraPage")
    .classList.add(
      "hidden"
    );


  $("bottomNav")
    .classList.add(
      "hidden"
    );


  $("viewerPage")
    .classList.remove(
      "hidden"
    );


  updateViewerZoneUI();


  if(id){

    $("manualPeerId")
      .value =
        id;

    connectViewer(
      id
    );

  }else{

    $("manualPeerId")
      .focus();

  }

}


function showHome(){

  if(running){

    stopMonitoring();

  }else if(peer){

    closePeerCamera();

  }


  role="";


  $("cameraPage")
    .classList.add(
      "hidden"
    );


  $("viewerPage")
    .classList.add(
      "hidden"
    );


  $("bottomNav")
    .classList.add(
      "hidden"
    );


  $("archiveTab")
    .classList.add(
      "hidden"
    );


  $("settingsTab")
    .classList.add(
      "hidden"
    );


  $("roleChooser")
    .classList.remove(
      "hidden"
    );

}


/* =========================================================
   BUTTONS
   ========================================================= */

$("cameraRoleBtn")
  .addEventListener(
    "click",
    showRoleCamera
  );


$("viewerRoleBtn")
  .addEventListener(
    "click",
    ()=>{
      initViewer("");
    }
  );


$("brandHome")
  .addEventListener(
    "click",
    showHome
  );


$("startBtn")
  .addEventListener(
    "click",
    ()=>{
      if(running){
        stopMonitoring();
      }else{
        startMonitoring();
      }
    }
  );


$("zoneBtn")
  .addEventListener(
    "click",
    toggleZoneEditor
  );


$("editZoneBtn")
  .addEventListener(
    "click",
    toggleZoneEditor
  );


$("zoneToggle")
  .addEventListener(
    "change",
    ()=>{

      zone.enabled =
        $("zoneToggle")
          .checked;


      saveZone();

      updateZoneUI();


      sendPeer({

        kind:
          "zone",

        zone

      });

    }
  );


/* =========================================================
   COPY CAMERA CODE
   ========================================================= */

$("copyPeerBtn")
  .addEventListener(
    "click",
    async()=>{

      if(!peerId){
        return;
      }


      try{

        await navigator
          .clipboard
          .writeText(
            peerId
          );


        $("copyPeerBtn")
          .textContent =
            "Скопійовано ✓";


        setTimeout(
          ()=>{
            $("copyPeerBtn")
              .textContent =
                "Копіювати код";
          },
          1200
        );

      }catch(e){

        /*
          Fallback for Safari / restricted
          clipboard environments.
        */

        const input =
          $("peerIdField");

        input.focus();

        input.select();

      }

    }
  );


/* =========================================================
   MANUAL VIEWER CONNECTION
   ========================================================= */

$("manualPeerId")
  .addEventListener(
    "keydown",
    e=>{

      if(
        e.key==="Enter"
      ){

        e.preventDefault();

        connectViewer(
          $("manualPeerId")
            .value
            .trim()
        );

      }

    }
  );


$("manualConnectBtn")
  .addEventListener(
    "click",
    ()=>{

      connectViewer(
        $("manualPeerId")
          .value
          .trim()
      );

    }
  );


$("viewerReconnectBtn")
  .addEventListener(
    "click",
    ()=>{

      connectViewer(
        $("manualPeerId")
          .value
          .trim()
      );

    }
  );


$("viewerBackBtn")
  .addEventListener(
    "click",
    showHome
  );


$("viewerZoneBtn")
  .addEventListener(
    "click",
    toggleViewerZoneEditor
  );


$("viewerZoneToggle")
  .addEventListener(
    "change",
    sendViewerZoneEnabled
  );


/* =========================================================
   FULLSCREEN
   ========================================================= */

$("viewerZoomBtn")
  .addEventListener(
    "click",
    ()=>{

      if(
        document.fullscreenElement
      ){

        document
          .exitFullscreen?.()
          .catch?.(
            ()=>{}
          );

        return;

      }


      if(
        remoteVideo.requestFullscreen
      ){

        remoteVideo
          .requestFullscreen()
          .catch(
            ()=>{}
          );

      }else if(
        remoteVideo.webkitEnterFullscreen
      ){

        remoteVideo
          .webkitEnterFullscreen();

      }

    }
  );


/* =========================================================
   BOTTOM NAV
   ========================================================= */

document
  .querySelectorAll(
    ".nav-button"
  )
  .forEach(
    btn=>{

      btn.addEventListener(
        "click",
        ()=>{

          document
            .querySelectorAll(
              ".nav-button"
            )
            .forEach(
              b=>
                b.classList.remove(
                  "active"
                )
            );


          btn.classList.add(
            "active"
          );


          const tab =
            btn.dataset.tab;


          $("cameraPage")
            .classList.toggle(
              "hidden",
              tab!=="monitor"
            );


          $("archiveTab")
            .classList.toggle(
              "hidden",
              tab!=="archive"
            );


          $("settingsTab")
            .classList.toggle(
              "hidden",
              tab!=="settings"
            );

        }
      );

    }
  );


$("settingsBtn")
  .addEventListener(
    "click",
    ()=>{

      document
        .querySelector(
          '.nav-button[data-tab="settings"]'
        )
        .click();

    }
  );


/* =========================================================
   ARCHIVE
   ========================================================= */

$("clearArchive")
  .addEventListener(
    "click",
    ()=>{

      archive=[];

      $("archiveCount")
        .textContent =
          "0";

      renderArchive();

    }
  );


$("saveSession")
  .addEventListener(
    "click",
    ()=>{

      const html =
        `<!doctype html>
<meta charset="utf-8">
<title>GHOST Session</title>

<style>
body{
  font-family:Arial;
  background:#f7f6f2;
  padding:24px
}

main{
  display:grid;
  grid-template-columns:
    repeat(auto-fill,minmax(220px,1fr));
  gap:12px
}

article{
  background:white;
  border-radius:14px;
  overflow:hidden;
  padding-bottom:10px
}

img{
  width:100%;
  display:block
}

p{
  padding:0 10px
}
</style>

<h1>GHOST Session</h1>

<main>

${archive.map(
  a=>`
    <article>

      <img src="${a.image}">

      <p>
        <b>${typeName(a.type)}</b>
        ·
        ${Math.round(a.score*100)}%
      </p>

    </article>
  `
).join("")}

</main>`;


      const blob =
        new Blob(
          [html],
          {
            type:
              "text/html"
          }
        );


      const a =
        document.createElement(
          "a"
        );


      a.href =
        URL.createObjectURL(
          blob
        );


      a.download =
        `ghost-session-${Date.now()}.html`;


      a.click();


      setTimeout(
        ()=>{
          URL.revokeObjectURL(
            a.href
          );
        },
        500
      );

    }
  );


/* =========================================================
   INIT
   ========================================================= */

loadZone();

updateZoneUI();

initZoneDrag();

initViewerZoneDrag();

remoteVideo.addEventListener(
  "loadedmetadata",
  resizeViewerCanvas
);


/* =========================================================
   QR AUTO VIEWER
   ========================================================= */

const params =
  new URLSearchParams(
    location.search
  );


if(
  params.get("mode")===
  "viewer"
){

  initViewer(
    params.get("camera") ||
    ""
  );

}else{

  showHome();

}