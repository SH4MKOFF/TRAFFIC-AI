"use strict";

/* =====================================================
   GHOST V2
   TWO PHONE SMART CAMERA
   FIXED WEBRTC / PORTRAIT CAMERA
===================================================== */


/* =====================================================
   DOM
===================================================== */

const $ = id =>
  document.getElementById(id);


const video =
  $("video");

const canvas =
  $("canvas");

const ctx =
  canvas.getContext("2d");

const remoteVideo =
  $("remoteVideo");


/* =====================================================
   AI
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
   WEBRTC STATE
===================================================== */

let peer =
  null;

let peerId =
  "";

let role =
  "";

let viewerDataConnection =
  null;

let cameraConnections =
  new Map();


/*
  Important:

  cameraConnections:
  viewerPeerId -> {
    dataConnection,
    call
  }
*/


/* =====================================================
   ZONE
===================================================== */

let zone = {

  enabled:false,

  name:"Контрольна зона",

  points:[
    {
      x:.25,
      y:.25
    },

    {
      x:.75,
      y:.25
    },

    {
      x:.75,
      y:.75
    },

    {
      x:.25,
      y:.75
    }
  ]

};


/* =====================================================
   OBJECT NAMES
===================================================== */

function typeName(
  type
){

  const names = {

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

  };

  return (
    names[type] ||
    type
  );

}


/* =====================================================
   ICON
===================================================== */

function iconFor(
  type
){

  if(
    type ===
    "person"
  )
    return "👤";


  if(
    VEHICLES.includes(
      type
    )
  )
    return "🚗";


  if(
    type ===
    "dog"
  )
    return "🐕";


  if(
    type ===
    "cat"
  )
    return "🐈";


  if(
    type ===
    "bicycle"
  )
    return "🚲";


  return "◈";

}


/* =====================================================
   GEOMETRY
===================================================== */

function centerOf(
  box
){

  return {

    x:
      box[0] +
      box[2] / 2,

    y:
      box[1] +
      box[3] / 2

  };

}


function distance(
  a,
  b
){

  return Math.hypot(
    a.x-b.x,
    a.y-b.y
  );

}


/* =====================================================
   ZONE
===================================================== */

function pointInsideZone(
  point
){

  const p =
    zone.points;

  let inside =
    false;


  for(
    let i=0,
    j=p.length-1;

    i<p.length;

    j=i++
  ){

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
      ) !==
      (
        yj > point.y
      )
      &&
      point.x <
      (
        (xj-xi) *
        (point.y-yi) /
        (yj-yi)
      ) +
      xi;


    if(intersect)
      inside =
        !inside;

  }


  return inside;

}


/* =====================================================
   DIRECTION
===================================================== */

function direction(
  dx,
  dy
){

  if(
    Math.abs(dx)<8 &&
    Math.abs(dy)<8
  )
    return "—";


  if(
    Math.abs(dx) >
    Math.abs(dy)
  )
    return dx>0
      ? "→"
      : "←";


  return dy>0
    ? "↓"
    : "↑";

}


/* =====================================================
   TIME
===================================================== */

function currentTime(){

  return new Date()
    .toLocaleTimeString(
      "uk-UA",
      {
        hour:"2-digit",
        minute:"2-digit",
        second:"2-digit"
      }
    );

}


function duration(){

  if(
    !sessionStarted
  )
    return "00:00";


  const seconds =
    Math.floor(
      (
        Date.now() -
        sessionStarted
      ) /
      1000
    );


  const minutes =
    Math.floor(
      seconds /
      60
    );


  return (
    String(
      minutes
    ).padStart(
      2,
      "0"
    )
    +
    ":"
    +
    String(
      seconds % 60
    ).padStart(
      2,
      "0"
    )
  );

}


/* =====================================================
   STATUS
===================================================== */

function setStatus(
  text,
  kind="",
  sub=""
){

  $("statusText")
    .textContent =
    text;


  $("statusSub")
    .textContent =
    sub ||
    (
      kind === "online"
        ? "AI працює на пристрої"
        : kind === "alert"
          ? "Потрібна увага"
          : "Камера не активна"
    );


  $("statusDot")
    .className =
    kind;

}


/* =====================================================
   ZONE STORAGE
===================================================== */

function saveZone(){

  try{

    localStorage.setItem(
      "ghost_zone_v2",
      JSON.stringify(
        zone
      )
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
      JSON.parse(
        saved
      );


    if(
      parsed &&
      Array.isArray(
        parsed.points
      ) &&
      parsed.points.length === 4
    ){

      zone =
        parsed;

    }

  }
  catch(error){

    console.warn(
      error
    );

  }

}


/* =====================================================
   ZONE UI
===================================================== */

function positionZoneHandles(){

  zone.points
    .forEach(
      (
        point,
        index
      ) => {

        const handle =
          document.querySelector(
            `.zone-handle[data-corner="${index}"]`
          );


        if(!handle)
          return;


        handle.style.left =
          `${point.x*100}%`;

        handle.style.top =
          `${point.y*100}%`;

      }
    );

}


function updateZoneUI(){

  $("zoneToggle")
    .checked =
    !!zone.enabled;


  $("zoneName")
    .textContent =
    zone.enabled
      ? zone.name
      : "Зона вимкнена";


  $("zoneStatus")
    .textContent =
    zone.enabled
      ? "GHOST фіксує входи в зону"
      : "Виявлення перетинів вимкнено";


  $("zoneOverlayLabel")
    .textContent =
    zone.name;


  $("zoneOverlay")
    .classList.toggle(
      "hidden",
      !zone.enabled ||
      zoneEditing
    );


  positionZoneHandles();

}


/* =====================================================
   CANVAS
===================================================== */

function resizeCanvas(){

  if(
    !video.videoWidth ||
    !video.videoHeight
  )
    return;


  canvas.width =
    video.videoWidth;

  canvas.height =
    video.videoHeight;


  /*
    Критично:

    aspect ratio реального відео.
    Це прибирає роз'їзд canvas
    з відео.
  */

  $("cameraStage")
    .style.aspectRatio =
    `${video.videoWidth}/${video.videoHeight}`;

}


/* =====================================================
   ROLE
===================================================== */

function showHome(){

  if(running)
    stopMonitoring();


  closePeerCamera();


  role =
    "";


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


/* =====================================================
   CAMERA ROLE
===================================================== */

function showRoleCamera(){

  role =
    "camera";


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


  initZoneDrag();


  /*
    Создаём Peer сразу,
    чтобы QR появился ещё
    до запуска камеры.
  */

  startPeerCamera();

}


/* =====================================================
   CAMERA PEER
===================================================== */

function makeCameraId(){

  return (
    "ghost-" +
    Math.random()
      .toString(36)
      .slice(2,8)
  );

}


/*
  ВАЖНО:

  Здесь Peer используется только
  как signalling/data connection.

  Когда viewer подключается,
  camera получает viewer peer ID
  и САМА инициирует media call.
*/

function startPeerCamera(){

  if(peer)
    return;


  const id =
    makeCameraId();


  peer =
    new Peer(
      id,
      {
        debug:2
      }
    );


  peer.on(
    "open",
    openedId => {

      peerId =
        openedId;


      $("peerIdField")
        .value =
        openedId;


      $("connectionState")
        .textContent =
        "ГОТОВА";


      $("connectionState")
        .classList.add(
          "online"
        );


      renderQR(
        openedId
      );

    }
  );


  /*
    VIEWER DATA CONNECTION
  */

  peer.on(
    "connection",
    connection => {

      console.log(
        "Viewer connected:",
        connection.peer
      );


      cameraConnections.set(
        connection.peer,
        {
          dataConnection:
            connection,
          call:null
        }
      );


      connection.on(
        "open",
        () => {

          $("connectionState")
            .textContent =
            "ПІДКЛЮЧЕНО";


          $("connectionState")
            .classList.add(
              "online"
            );


          connection.send(
            {
              kind:"hello",

              name:
                $("cameraTitle")
                  .textContent
            }
          );


          /*
            ИМЕННО ЗДЕСЬ
            камера сама начинает
            media call.
          */

          callViewer(
            connection.peer,
            connection
          );

        }
      );


      connection.on(
        "close",
        () => {

          removeCameraConnection(
            connection.peer
          );

        }
      );


      connection.on(
        "error",
        error => {

          console.warn(
            "Data connection error:",
            error
          );

          removeCameraConnection(
            connection.peer
          );

        }
      );

    }
  );


  peer.on(
    "error",
    error => {

      console.warn(
        "Camera PeerJS error:",
        error
      );


      $("connectionState")
        .textContent =
        "ПОМИЛКА";

    }
  );


  peer.on(
    "disconnected",
    () => {

      $("connectionState")
        .textContent =
        "RECONNECTING";


      try{

        peer.reconnect();

      }
      catch(error){

        console.warn(
          error
        );

      }

    }
  );

}


/* =====================================================
   CALL VIEWER
===================================================== */

function callViewer(
  viewerId,
  dataConnection
){

  if(!stream){

    /*
      Камера ещё не запущена.

      После запуска monitoring
      мы повторим call.
    */

    return;

  }


  const existing =
    cameraConnections.get(
      viewerId
    );


  if(
    existing &&
    existing.call
  ){

    return;

  }


  console.log(
    "Calling viewer:",
    viewerId
  );


  const call =
    peer.call(
      viewerId,
      stream
    );


  if(!existing){

    cameraConnections.set(
      viewerId,
      {
        dataConnection,
        call
      }
    );

  }
  else{

    existing.call =
      call;

  }


  call.on(
    "close",
    () => {

      const item =
        cameraConnections.get(
          viewerId
        );


      if(item)
        item.call =
          null;

    }
  );


  call.on(
    "error",
    error => {

      console.warn(
        "Media call error:",
        error
      );

      const item =
        cameraConnections.get(
          viewerId
        );


      if(item)
        item.call =
          null;

    }
  );

}


/* =====================================================
   CALL ALL VIEWERS
===================================================== */

function callAllViewers(){

  if(!stream)
    return;


  cameraConnections
    .forEach(
      (
        connection,
        viewerId
      ) => {

        if(
          connection
            .dataConnection
            .open
        ){

          callViewer(
            viewerId,
            connection.dataConnection
          );

        }

      }
    );

}


/* =====================================================
   REMOVE CAMERA CONNECTION
===================================================== */

function removeCameraConnection(
  viewerId
){

  const item =
    cameraConnections.get(
      viewerId
    );


  if(!item)
    return;


  try{

    if(item.call)
      item.call.close();

  }
  catch(error){}


  cameraConnections.delete(
    viewerId
  );


  if(
    cameraConnections.size ===
    0
  ){

    $("connectionState")
      .textContent =
      "ГОТОВА";

  }

}


/* =====================================================
   CLOSE CAMERA PEER
===================================================== */

function closePeerCamera(){

  cameraConnections
    .forEach(
      item => {

        try{

          if(
            item.call
          )
            item.call.close();

        }
        catch(error){}


        try{

          if(
            item.dataConnection
          )
            item.dataConnection.close();

        }
        catch(error){}

      }
    );


  cameraConnections.clear();


  if(peer){

    try{

      peer.destroy();

    }
    catch(error){}

  }


  peer =
    null;

  peerId =
    "";


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


/* =====================================================
   QR
===================================================== */

function renderQR(
  id
){

  $("qrCode")
    .innerHTML =
    "";


  if(
    typeof QRCode ===
    "undefined"
  ){

    $("qrCode")
      .textContent =
      "QR";

    return;

  }


  const url =
    new URL(
      location.href
    );


  url.search =
    "";


  url.hash =
    "";


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

      width:105,

      height:105,

      colorDark:
        "#171717",

      colorLight:
        "#ffffff",

      correctLevel:
        QRCode.CorrectLevel.M
    }
  );

}


/* =====================================================
   COPY PEER
===================================================== */

$("copyPeerBtn")
  .addEventListener(
    "click",
    async () => {

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
          () => {

            $("copyPeerBtn")
              .textContent =
              "Копіювати код";

          },
          1200
        );

      }
      catch(error){

        console.warn(
          error
        );

      }

    }
  );


/* =====================================================
   START MONITORING
===================================================== */

async function startMonitoring(){

  try{

    resetSession();


    setStatus(
      "ЗАПУСК",
      "",
      "Надання доступу до камери…"
    );


    $("cameraEmpty")
      .classList.remove(
        "hidden"
      );


    $("cameraEmpty")
      .querySelector(
        "strong"
      )
      .textContent =
      "Запуск камери";


    $("cameraEmpty")
      .querySelector(
        "span"
      )
      .textContent =
      "Надання доступу…";


    /*
      Portrait-friendly request.
    */

    stream =
      await navigator
        .mediaDevices
        .getUserMedia(
          {

            video:{

              facingMode:{
                ideal:"environment"
              },

              width:{
                ideal:1080
              },

              height:{
                ideal:1920
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
      .querySelector(
        "strong"
      )
      .textContent =
      "Підготовка AI";


    $("cameraEmpty")
      .querySelector(
        "span"
      )
      .textContent =
      "Завантаження моделі…";


    if(!model){

      model =
        await cocoSsd.load(
          {
            base:"mobilenet_v2"
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

          $("sessionTime")
            .textContent =
            duration();

        },
        1000
      );


    setStatus(
      "ОНЛАЙН",
      "online"
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
      Якщо viewer уже підключився
      ДО старту камери — тепер
      відразу віддаємо йому stream.
    */

    callAllViewers();


    detectLoop();


    redraw();

  }
  catch(error){

    console.error(
      "Camera start error:",
      error
    );


    stopMonitoring();


    setStatus(
      "ПОМИЛКА",
      "alert",
      "Перевірте дозвіл браузера"
    );


    $("cameraEmpty")
      .classList.remove(
        "hidden"
      );


    $("cameraEmpty")
      .querySelector(
        "strong"
      )
      .textContent =
      "Немає доступу до камери";


    $("cameraEmpty")
      .querySelector(
        "span"
      )
      .textContent =
      "Перевірте дозвіл браузера.";

  }

}


/* =====================================================
   STOP
===================================================== */

function stopMonitoring(){

  running =
    false;


  detecting =
    false;


  if(sessionTimer){

    clearInterval(
      sessionTimer
    );

    sessionTimer =
      null;

  }


  /*
    Закрываем media calls,
    но Peer оставляем живым.
  */

  cameraConnections
    .forEach(
      item => {

        try{

          if(item.call)
            item.call.close();

        }
        catch(error){}

        item.call =
          null;

      }
    );


  if(stream){

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
    .querySelector(
      "strong"
    )
    .textContent =
    "Камера готова";


  $("cameraEmpty")
    .querySelector(
      "span"
    )
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
    .disabled =
    true;

}


/* =====================================================
   RESET
===================================================== */

function resetSession(){

  tracks =
    [];

  events =
    [];

  archive =
    [];

  nextTrackId =
    1;


  $("visibleCount")
    .textContent =
    "0";


  $("uniqueCount")
    .textContent =
    "0";


  $("zoneCount")
    .textContent =
    "0";


  $("eventCount")
    .textContent =
    "0";


  $("objectCountLabel")
    .textContent =
    "0";


  $("archiveCount")
    .textContent =
    "0";


  $("sessionTime")
    .textContent =
    "00:00";


  $("eventLog")
    .innerHTML =
    '<div class="empty">Очікування активності</div>';


  $("objectList")
    .innerHTML =
    '<div class="empty">Об’єкти ще не виявлені</div>';


  $("archiveGrid")
    .innerHTML =
    "";


  $("lastEvent")
    .classList.add(
      "hidden"
    );

}


/* =====================================================
   ZOOM
===================================================== */

async function setupZoom(){

  if(!videoTrack)
    return;


  try{

    const capabilities =
      videoTrack
        .getCapabilities();


    if(
      !capabilities.zoom
    ){

      $("zoomSlider")
        .disabled =
        true;

      return;

    }


    $("zoomSlider")
      .min =
      capabilities.zoom.min;


    $("zoomSlider")
      .max =
      capabilities.zoom.max;


    $("zoomSlider")
      .step =
      capabilities.zoom.step ||
      .1;


    const settings =
      videoTrack
        .getSettings();


    const value =
      settings.zoom ||
      capabilities.zoom.min;


    $("zoomSlider")
      .value =
      value;


    $("zoomValue")
      .textContent =
      `${Number(value).toFixed(1)}×`;


    $("zoomSlider")
      .disabled =
      false;

  }
  catch(error){

    console.warn(
      "Zoom:",
      error
    );

  }

}


$("zoomSlider")
  .addEventListener(
    "input",
    async () => {

      if(!videoTrack)
        return;


      const value =
        Number(
          $("zoomSlider")
            .value
        );


      $("zoomValue")
        .textContent =
        `${value.toFixed(1)}×`;


      try{

        const constraints =
          videoTrack
            .getConstraints();


        await videoTrack
          .applyConstraints(
            {
              ...constraints,

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
          "Zoom error:",
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
        prediction =>
          CLASSES.includes(
            prediction.class
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
      180
    );

  }

}


/* =====================================================
   TRACKING
===================================================== */

function processObjects(
  predictions
){

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
            d <
            bestDistance &&
            d <=
            MATCH_DISTANCE
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
          Math.hypot(
            dx,
            dy
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
            $("movementToggle")
              .checked
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


          $("zoneCount")
            .textContent =
            String(
              Number(
                $("zoneCount")
                  .textContent
              ) + 1
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


  tracks =
    [
      ...newTracks,

      ...tracks.filter(
        track =>
          now -
          track.lastSeen
          <
          MAX_TRACK_AGE &&
          !newTracks.some(
            newTrack =>
              newTrack.id ===
              track.id
          )
      )
    ];


  $("visibleCount")
    .textContent =
    String(
      predictions.length
    );


  $("uniqueCount")
    .textContent =
    String(
      new Set(
        tracks.map(
          track =>
            track.id
        )
      ).size
    );


  renderObjects(
    tracks.filter(
      track =>
        now -
        track.lastSeen
        <
        500
    )
  );


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
    events
      .map(
        item =>
          `
          <div class="event-row">

            <div class="event-time">
              ${item.time}
            </div>

            <div class="event-icon">
              ${iconFor(item.type)}
            </div>

            <div>

              <div class="event-main">
                ${typeName(item.type)}
                ·
                ${item.action}
              </div>

              <span class="event-sub">
                ${
                  item.direction &&
                  item.direction !== "—"
                    ? `Напрямок ${item.direction}`
                    : "Подія зафіксована"
                }
              </span>

            </div>

          </div>
          `
      )
      .join("");


  $("lastEventText")
    .textContent =
    `${typeName(track.type)} · ${action.toLowerCase()}`;


  $("lastEvent")
    .classList.remove(
      "hidden"
    );


  /*
    Передаём событие всем Viewer.
  */

  sendEventToViewers(
    event
  );

}


/* =====================================================
   SEND EVENT TO VIEWERS
===================================================== */

function sendEventToViewers(
  event
){

  cameraConnections
    .forEach(
      connection => {

        if(
          connection
            .dataConnection
            &&
          connection
            .dataConnection
            .open
        ){

          try{

            connection
              .dataConnection
              .send(
                {
                  kind:"event",
                  event
                }
              );

          }
          catch(error){

            console.warn(
              "Event send:",
              error
            );

          }

        }

      }
    );

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
    1200
  )
    return;


  lastAlert =
    now;


  if(
    $("vibrationToggle")
      .checked &&
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


  setStatus(
    "УВАГА",
    "alert",
    "Об’єкт увійшов у зону"
  );


  setTimeout(
    () => {

      if(running){

        setStatus(
          "ОНЛАЙН",
          "online"
        );

      }

    },
    1600
  );

}


/* =====================================================
   ARCHIVE
===================================================== */

function createArchive(
  track
){

  if(
    !video.videoWidth ||
    !video.videoHeight
  )
    return;


  try{

    const padding =
      30;


    const b =
      track.bbox;


    const x =
      Math.max(
        0,
        b[0] -
        padding
      );


    const y =
      Math.max(
        0,
        b[1] -
        padding
      );


    const w =
      Math.min(
        video.videoWidth -
        x,

        b[2] +
        padding * 2
      );


    const h =
      Math.min(
        video.videoHeight -
        y,

        b[3] +
        padding * 2
      );


    const crop =
      document.createElement(
        "canvas"
      );


    crop.width =
      Math.max(
        1,
        Math.round(w)
      );


    crop.height =
      Math.max(
        1,
        Math.round(h)
      );


    crop
      .getContext("2d")
      .drawImage(
        video,
        x,
        y,
        w,
        h,
        0,
        0,
        crop.width,
        crop.height
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

      moved:false,

      crossed:
        track.insideZone,

      image:
        crop.toDataURL(
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

  }
  catch(error){

    console.warn(
      "Archive:",
      error
    );

  }

}


/* =====================================================
   OBJECT UI
===================================================== */

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
      ?

      list
        .map(
          track =>
            `
            <article class="object-card">

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
                Трек #${track.id}
                ·
                ${track.direction}
                ·
                ${
                  track.insideZone
                    ? "у зоні"
                    : "поза зоною"
                }
              </div>

            </article>
            `
        )
        .join("")

      :

      `
      <div class="empty">
        Об’єкти ще не виявлені
      </div>
      `;

}


/* =====================================================
   ARCHIVE UI
===================================================== */

function renderArchive(){

  $("archiveGrid")
    .innerHTML =
    archive.length
      ?

      archive
        .map(
          item =>
            `
            <article class="archive-card">

              <img
                src="${item.image}"
                alt="${typeName(item.type)}"
              >

              <div class="archive-info">

                <strong>
                  ${iconFor(item.type)}
                  ${typeName(item.type)}
                </strong>

                <small>
                  Впевненість:
                  ${Math.round(item.score*100)}%
                  <br>
                  Трек #${item.id}
                </small>

              </div>

            </article>
            `
        )
        .join("")

      :

      `
      <div class="empty">
        Архів порожній
      </div>
      `;

}


/* =====================================================
   DRAW AI BOXES
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


  const now =
    Date.now();


  tracks
    .filter(
      track =>
        now -
        track.lastSeen
        <
        500
    )
    .forEach(
      track => {

        const [
          x,
          y,
          w,
          h
        ] =
        track.bbox;


        ctx.lineWidth =
          Math.max(
            2,
            canvas.width / 600
          );


        ctx.strokeStyle =
          "#6c63ff";


        ctx.strokeRect(
          x,
          y,
          w,
          h
        );


        ctx.font =
          `${Math.max(
            12,
            canvas.width / 75
          )}px -apple-system,BlinkMacSystemFont,Arial`;


        const label =
          `${typeName(track.type)} ${Math.round(track.score*100)}%`;


        const width =
          ctx.measureText(
            label
          ).width +
          14;


        ctx.fillStyle =
          "#ffffffdd";


        ctx.fillRect(
          x,
          Math.max(
            0,
            y-26
          ),
          width,
          22
        );


        ctx.fillStyle =
          "#5148d0";


        ctx.fillText(
          label,
          x+7,
          Math.max(
            15,
            y-10
          )
        );

      }
    );


  requestAnimationFrame(
    redraw
  );

}


/* =====================================================
   ZONE EDITOR
===================================================== */

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


  positionZoneHandles();

}


function initZoneDrag(){

  document
    .querySelectorAll(
      ".zone-handle"
    )
    .forEach(
      handle => {

        const move =
          event => {

            const rect =
              $("cameraStage")
                .getBoundingClientRect();


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
              Number(
                handle.dataset.corner
              )
            ] = {
              x,
              y
            };


            positionZoneHandles();

          };


        handle.addEventListener(
          "pointerdown",
          event => {

            event.preventDefault();

            handle.setPointerCapture(
              event.pointerId
            );

            handle.onpointermove =
              move;

            handle.onpointerup =
              () => {

                handle.onpointermove =
                  null;

                saveZone();

              };

          }
        );

      }
    );

}


/* =====================================================
   VIEWER
===================================================== */

function makeViewerId(){

  return (
    "viewer-" +
    Math.random()
      .toString(36)
      .slice(2,8)
  );

}


/*
  Viewer creates its own Peer.
  Then it opens a DATA connection
  to camera.

  Camera then calls this viewer
  with actual video stream.
*/

function initViewer(
  cameraId
){

  role =
    "viewer";


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


  if(cameraId){

    $("manualPeerId")
      .value =
      cameraId;


    connectViewer(
      cameraId
    );

  }

}


/* =====================================================
   CONNECT VIEWER
===================================================== */

function connectViewer(
  cameraId
){

  if(!cameraId)
    return;


  /*
    Close previous viewer peer.
  */

  if(peer){

    try{

      peer.destroy();

    }
    catch(error){}

  }


  viewerDataConnection =
    null;


  remoteVideo.srcObject =
    null;


  $("viewerEmpty")
    .classList.remove(
      "hidden"
    );


  $("viewerEmpty")
    .querySelector(
      "strong"
    )
    .textContent =
    "Підключення…";


  $("viewerEmpty")
    .querySelector(
      "span"
    )
    .textContent =
    "Встановлюємо з’єднання…";


  $("viewerState")
    .textContent =
    "ПІДКЛЮЧЕННЯ";


  $("viewerDot")
    .classList.remove(
      "active"
    );


  /*
    New viewer Peer.
  */

  peer =
    new Peer(
      makeViewerId(),
      {
        debug:2
      }
    );


  peer.on(
    "open",
    viewerPeerId => {

      console.log(
        "Viewer Peer:",
        viewerPeerId
      );


      /*
        DATA connection to camera.
      */

      const connection =
        peer.connect(
          cameraId,
          {
            reliable:true
          }
        );


      viewerDataConnection =
        connection;


      connection.on(
        "open",
        () => {

          console.log(
            "Viewer data connected"
          );


          $("viewerState")
            .textContent =
            "КАМЕРА ЗНАЙДЕНА";


          $("viewerEmpty")
            .querySelector(
              "strong"
            )
            .textContent =
            "Камеру знайдено";


          $("viewerEmpty")
            .querySelector(
              "span"
            )
            .textContent =
            "Очікуємо відео…";

        }
      );


      connection.on(
        "data",
        data => {

          if(
            !data
          )
            return;


          if(
            data.kind ===
            "event"
          ){

            addViewerEvent(
              data.event
            );

          }


          if(
            data.kind ===
            "hello"
          ){

            $("viewerTitle")
              .textContent =
              data.name ||
              "GHOST Camera";

          }

        }
      );


      connection.on(
        "close",
        () => {

          setViewerOffline();

        }
      );


      connection.on(
        "error",
        error => {

          console.warn(
            "Viewer data error:",
            error
          );

        }
      );

    }
  );


  /*
    THIS IS THE IMPORTANT PART.

    Camera will call us.

    We simply accept its call.
  */

  peer.on(
    "call",
    call => {

      console.log(
        "Incoming media call from camera:",
        call.peer
      );


      call.answer();


      call.on(
        "stream",
        remoteStream => {

          console.log(
            "REMOTE STREAM RECEIVED",
            remoteStream
          );


          remoteVideo.srcObject =
            remoteStream;


          remoteVideo.play()
            .catch(
              error =>
                console.warn(
                  "Autoplay:",
                  error
                )
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

        }
      );


      call.on(
        "close",
        () => {

          setViewerOffline();

        }
      );


      call.on(
        "error",
        error => {

          console.warn(
            "Incoming call error:",
            error
          );

          setViewerOffline();

        }
      );

    }
  );


  peer.on(
    "error",
    error => {

      console.warn(
        "Viewer PeerJS error:",
        error
      );


      $("viewerEmpty")
        .querySelector(
          "strong"
        )
        .textContent =
        "Не вдалося підключитися";


      $("viewerEmpty")
        .querySelector(
          "span"
        )
        .textContent =
        "Перевірте код камери та чи вона онлайн.";


      $("viewerState")
        .textContent =
        "ПОМИЛКА";


      $("viewerDot")
        .classList.remove(
          "active"
        );

    }
  );


  peer.on(
    "disconnected",
    () => {

      console.log(
        "Viewer disconnected"
      );


      try{

        peer.reconnect();

      }
      catch(error){

        console.warn(
          error
        );

      }

    }
  );

}


/* =====================================================
   VIEWER OFFLINE
===================================================== */

function setViewerOffline(){

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
    .querySelector(
      "strong"
    )
    .textContent =
    "Камеру відключено";


  $("viewerEmpty")
    .querySelector(
      "span"
    )
    .textContent =
    "Спробуйте підключитися знову.";

}


/* =====================================================
   VIEWER EVENTS
===================================================== */

function addViewerEvent(
  event
){

  const empty =
    $("viewerEventLog")
      .querySelector(
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
          ${typeName(event.type)}
          ·
          ${event.action}
        </div>

        <span class="event-sub">
          Подія з камери
        </span>

      </div>
    `;


  $("viewerEventLog")
    .prepend(
      row
    );


  $("viewerEventCount")
    .textContent =
    String(
      Number(
        $("viewerEventCount")
          .textContent
      ) + 1
    );

}


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
              item =>
                item.classList.remove(
                  "active"
                )
            );


          button.classList.add(
            "active"
          );


          const tab =
            button.dataset.tab;


          $("cameraPage")
            .classList.toggle(
              "hidden",
              tab !==
              "monitor"
            );


          $("archiveTab")
            .classList.toggle(
              "hidden",
              tab !==
              "archive"
            );


          $("settingsTab")
            .classList.toggle(
              "hidden",
              tab !==
              "settings"
            );

        }
      );

    }
  );


/* =====================================================
   BUTTONS
===================================================== */

$("cameraRoleBtn")
  .addEventListener(
    "click",
    showRoleCamera
  );


$("viewerRoleBtn")
  .addEventListener(
    "click",
    () =>
      initViewer(
        $("manualPeerId")
          .value
          .trim()
      )
  );


$("brandHome")
  .addEventListener(
    "click",
    showHome
  );


$("startBtn")
  .addEventListener(
    "click",
    () =>
      running
        ? stopMonitoring()
        : startMonitoring()
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
    () => {

      zone.enabled =
        $("zoneToggle")
          .checked;


      saveZone();

      updateZoneUI();

    }
  );


$("settingsBtn")
  .addEventListener(
    "click",
    () => {

      document
        .querySelector(
          '.nav-button[data-tab="settings"]'
        )
        .click();

    }
  );


/* =====================================================
   MANUAL VIEWER CONNECT
===================================================== */

$("manualConnectBtn")
  .addEventListener(
    "click",
    () => {

      const id =
        $("manualPeerId")
          .value
          .trim();


      if(!id)
        return;


      connectViewer(
        id
      );

    }
  );


$("viewerReconnectBtn")
  .addEventListener(
    "click",
    () => {

      const id =
        $("manualPeerId")
          .value
          .trim();


      if(!id)
        return;


      connectViewer(
        id
      );

    }
  );


$("viewerBackBtn")
  .addEventListener(
    "click",
    showHome
  );


/* =====================================================
   ARCHIVE
===================================================== */

$("clearArchive")
  .addEventListener(
    "click",
    () => {

      archive =
        [];

      renderArchive();

    }
  );


$("saveSession")
  .addEventListener(
    "click",
    () => {

      const html =
        `
<!doctype html>

<html lang="uk">

<head>

<meta charset="utf-8">

<title>
GHOST Session
</title>

<style>

body{
  font-family:Arial;
  background:#f7f6f2;
  padding:24px
}

main{
  display:grid;
  grid-template-columns:
    repeat(
      auto-fill,
      minmax(220px,1fr)
    );
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

</head>

<body>

<h1>
GHOST Session
</h1>

<main>

${
  archive
    .map(
      item =>
        `
        <article>

          <img
            src="${item.image}"
          >

          <p>

            <b>
              ${typeName(item.type)}
            </b>

            ·

            ${Math.round(item.score*100)}%

          </p>

        </article>
        `
    )
    .join("")
}

</main>

</body>

</html>
        `;


      const blob =
        new Blob(
          [
            html
          ],
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


      a.href =
        url;


      a.download =
        `ghost-session-${Date.now()}.html`;


      a.click();


      setTimeout(
        () =>
          URL.revokeObjectURL(
            url
          ),
        500
      );

    }
  );


/* =====================================================
   STARTUP
===================================================== */

loadZone();

updateZoneUI();


const params =
  new URLSearchParams(
    location.search
  );


if(
  params.get("mode") ===
  "viewer"
){

  initViewer(
    params.get("camera") ||
    ""
  );

}
else{

  showHome();

}