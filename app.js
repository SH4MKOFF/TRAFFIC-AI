/* =========================================================
   GHOST — Smart Camera
   =========================================================

   Features:
   - Camera mode
   - Viewer mode
   - COCO-SSD local AI
   - Object detection
   - Session-local tracking
   - Unique object tracking
   - Movement detection
   - Detection zone
   - Zone crossing events
   - Sound alerts
   - Vibration alerts
   - Local snapshots
   - Local archive
   - QR pairing
   - Manual pairing code
   - PeerJS/WebRTC live video
   - Remote zone control
   - Camera zoom when supported

   Important:
   This prototype uses browser APIs and PeerJS.
   It does NOT require a custom backend for the first
   local/Wi-Fi prototype.
========================================================= */

(() => {

  "use strict";


  /* =========================================================
     HELPERS
  ========================================================== */

  const $ = id => document.getElementById(id);

  const clamp = (
    n,
    min,
    max
  ) =>
    Math.max(
      min,
      Math.min(
        max,
        n
      )
    );


  const nowTime = () =>
    new Date().toLocaleTimeString(
      [],
      {
        hour:"2-digit",
        minute:"2-digit",
        second:"2-digit"
      }
    );


  const uid = () =>
    Math.random()
      .toString(36)
      .slice(2,8);


  /* =========================================================
     STATE
  ========================================================== */

  let role = "";

  let stream = null;

  let model = null;

  let peer = null;

  let peerId = "";

  let viewerConn = null;

  let running = false;

  let detecting = false;

  let detectTimer = null;

  let sessionStartedAt = 0;

  let sessionTimer = null;


  /* SETTINGS */

  let detectionThreshold =
    Number(
      localStorage.getItem(
        "ghost-confidence"
      ) || "0.25"
    );

  let soundEnabled =
    localStorage.getItem(
      "ghost-sound"
    ) !== "0";

  let vibrationEnabled =
    localStorage.getItem(
      "ghost-vibration"
    ) !== "0";

  let snapshotsEnabled =
    localStorage.getItem(
      "ghost-snapshots"
    ) !== "0";

  let alertProfile = localStorage.getItem("ghost-alert-profile") || "standard";
  let alertObjectFilter = localStorage.getItem("ghost-alert-object") || "all";
  let dwellSeconds = Number(localStorage.getItem("ghost-dwell-seconds") || "15");


  /* ARCHIVE */

  let archive =
    loadJSON(
      "ghost-archive",
      []
    );


  /* ZONE */

  let zone =
    loadJSON(
      "ghost-zone",
      null
    ) ||
    {
      enabled:false,

      name:"Detection zone",

      points:[
        {
          x:.12,
          y:.18
        },
        {
          x:.88,
          y:.18
        },
        {
          x:.88,
          y:.82
        },
        {
          x:.12,
          y:.82
        }
      ]
    };


  let zoneEditing = false;


  /* VIEWER ZONE */

  let viewerZone = {
    ...zone,

    points:
      zone.points.map(
        p => ({...p})
      )
  };

  let viewerZoneEditing = false;


  /* TRACKING */

  let tracks = [];

  let nextTrackId = 1;

  let uniqueClasses =
    new Set();

  let uniqueObjectIds =
    new Set();

  let movedTrackIds =
    new Set();

  let movedCount = 0;

  let zoneEntries = 0;


  /* EVENTS */

  let events = [];

  let viewerEvents = 0;

  /*
    Remote detections received by Viewer.
    This is kept separate from Camera-local detections so
    the Viewer render loop never loses the remote boxes.
  */
  let viewerTracks = [];

  let lastDetectionState = [];

  let lastEventAt = 0;


  /* AUDIO */

  let audioContext = null;


  /* VIEWER DRAW LOOP */

  let viewerRAF = 0;

  let ghostDBPromise = null;
  let proZoneState = new Map();
  let proActivity = Array(30).fill(0);
  let proActivityEpoch = Date.now();
  let proLastActivityBucket = -1;
  let proLastPeopleAlertAt = 0;
  let proLastHealthAt = 0;
  let proArchiveFilter = "all";
  let proWakeLock = null;
  let proViewerReconnectAttempts = 0;
  let proViewerReconnectTimer = null;


  /* =========================================================
     DOM
  ========================================================== */

  const video =
    $("video");

  const canvas =
    $("canvas");

  const ctx =
    canvas.getContext(
      "2d"
    );


  const remoteVideo =
    $("remoteVideo");

  const viewerCanvas =
    $("viewerCanvas");

  const viewerCtx =
    viewerCanvas.getContext(
      "2d"
    );


  /* =========================================================
     STORAGE
  ========================================================== */

  function loadJSON(
    key,
    fallback
  ){

    try{

      return (
        JSON.parse(
          localStorage.getItem(
            key
          )
        ) ??
        fallback
      );

    }catch{

      return fallback;

    }

  }


  function saveJSON(
    key,
    value
  ){

    try{

      localStorage.setItem(
        key,
        JSON.stringify(
          value
        )
      );

    }catch(error){

      console.warn(
        "Storage error",
        error
      );

    }

  }


  /* =========================================================
     INDEXEDDB LOCAL ARCHIVE
  ========================================================== */

  function openGhostDB(){
    if(ghostDBPromise) return ghostDBPromise;
    ghostDBPromise = new Promise(resolve=>{
      if(!window.indexedDB){ resolve(null); return; }
      const r=indexedDB.open("ghost-db",1);
      r.onupgradeneeded=()=>{const db=r.result;if(!db.objectStoreNames.contains("archive"))db.createObjectStore("archive",{keyPath:"id"});};
      r.onsuccess=()=>resolve(r.result); r.onerror=()=>resolve(null);
    });
    return ghostDBPromise;
  }
  async function idbPut(item){const db=await openGhostDB();if(!db||!item)return;try{const tx=db.transaction("archive","readwrite");tx.objectStore("archive").put({...item,createdAt:item.createdAt||Date.now()});}catch{}}
  async function idbAll(){const db=await openGhostDB();if(!db)return [];return new Promise(resolve=>{try{const r=db.transaction("archive","readonly").objectStore("archive").getAll();r.onsuccess=()=>resolve(r.result||[]);r.onerror=()=>resolve([]);}catch{resolve([]);}});}
  async function idbClear(){const db=await openGhostDB();if(!db)return;try{db.transaction("archive","readwrite").objectStore("archive").clear();}catch{}}
  async function hydrateArchive(){const rows=await idbAll();if(rows.length){archive=rows.sort((a,b)=>(b.createdAt||0)-(a.createdAt||0)).slice(0,120);renderArchive();}}

  /* =========================================================
     UI
  ========================================================== */

  function toast(
    message
  ){

    const el =
      $("toast");

    el.textContent =
      message;

    el.classList.add(
      "show"
    );

    clearTimeout(
      toast.timer
    );

    toast.timer =
      setTimeout(
        () =>
          el.classList.remove(
            "show"
          ),
        2200
      );

  }


  function setGlobalStatus(
    state,
    text,
    sub
  ){

    const el =
      $("globalStatus");

    el.classList.remove(
      "live",
      "alert",
      "ready"
    );

    el.classList.add(
      state ||
      "ready"
    );

    $("globalStatusText")
      .textContent =
      text;

    $("globalStatusSub")
      .textContent =
      sub;

  }


  function formatDuration(
    seconds
  ){

    seconds =
      Math.max(
        0,
        Math.floor(
          seconds
        )
      );

    const h =
      Math.floor(
        seconds / 3600
      );

    const m =
      Math.floor(
        (seconds % 3600) / 60
      );

    const s =
      seconds % 60;


    if(h){

      return (
        String(h).padStart(2,"0") +
        ":" +
        String(m).padStart(2,"0") +
        ":" +
        String(s).padStart(2,"0")
      );

    }


    return (
      String(m).padStart(2,"0") +
      ":" +
      String(s).padStart(2,"0")
    );

  }


  /* =========================================================
     OBJECT NAMES
  ========================================================== */

  function typeName(
    type
  ){

    const names = {

      person:"Person",

      car:"Car",

      truck:"Truck",

      bus:"Bus",

      bicycle:"Bicycle",

      motorcycle:"Motorcycle",

      dog:"Dog",

      cat:"Cat",

      bird:"Bird",

      backpack:"Backpack",

      handbag:"Handbag",

      suitcase:"Suitcase",

      laptop:"Laptop",

      cell_phone:"Phone"

    };


    return (
      names[type] ||
      type
        .replaceAll(
          "_",
          " "
        )
        .replace(
          /\b\w/g,
          c =>
            c.toUpperCase()
        )
    );

  }


  function iconFor(
    type
  ){

    const icons = {

      person:"●",

      car:"▣",

      truck:"▤",

      bus:"▤",

      bicycle:"◌",

      motorcycle:"◉",

      dog:"◆",

      cat:"◇",

      bird:"◈"

    };


    return (
      icons[type] ||
      "✦"
    );

  }


  /* =========================================================
     ESCAPE HTML
  ========================================================== */

  function escapeHTML(
    value
  ){

    return String(
      value
    ).replace(
      /[&<>'"]/g,
      c =>
        ({
          "&":"&amp;",
          "<":"&lt;",
          ">":"&gt;",
          "'":"&#39;",
          '"':"&quot;"
        }[c])
    );

  }


  /* =========================================================
     NAVIGATION
  ========================================================== */

  function showHome(){

    document.body.classList.add("home-mode");

    stopMonitoring();

    closePeer();

    role = "";

    $("viewerPage")?.classList.remove("connected-viewer");
    $("roleChooser")
      .classList
      .remove(
        "hidden"
      );

    $("cameraPage")
      .classList
      .add(
        "hidden"
      );

    $("viewerPage")
      .classList
      .add(
        "hidden"
      );

    $("bottomNav")
      .classList
      .add(
        "hidden"
      );

    $("archiveTab")
      .classList
      .add(
        "hidden"
      );

    $("settingsTab")
      .classList
      .add(
        "hidden"
      );

    setGlobalStatus(
      "ready",
      "READY",
      "Camera inactive"
    );

    $("sessionTime")
      .textContent =
      "00:00";

  }


  function setCameraSetupVisible(visible){
    const setup = $("cameraSetup");
    const layout = document.querySelector(".camera-layout");
    if(!setup || !layout) return;
    setup.classList.toggle("hidden", !visible);
    setup.classList.toggle("setup-live-hidden", !visible);
    layout.style.display = visible ? "none" : "";
  }

  function showCamera(){

    document.body.classList.remove("home-mode");

    role =
      "camera";

    $("roleChooser")
      .classList
      .add(
        "hidden"
      );

    $("viewerPage")
      .classList
      .add(
        "hidden"
      );

    $("cameraPage")
      .classList
      .remove(
        "hidden"
      );

    setCameraSetupVisible(!running);

    $("bottomNav")
      .classList
      .remove(
        "hidden"
      );

    loadCameraSettingsUI();

    loadZoneUI();

    if(!peer){

      startPeerCamera();

    }

  }


  function showViewer(
    initialId = ""
  ){

    document.body.classList.remove("home-mode");

    role =
      "viewer";

    $("roleChooser")
      .classList
      .add(
        "hidden"
      );

    $("cameraPage")
      .classList
      .add(
        "hidden"
      );

    $("bottomNav")
      .classList
      .add(
        "hidden"
      );

    $("archiveTab")
      .classList
      .add(
        "hidden"
      );

    $("settingsTab")
      .classList
      .add(
        "hidden"
      );

    $("viewerPage")
      .classList
      .remove(
        "hidden"
      );


    if(initialId){

      $("manualPeerId")
        .value =
        initialId;

      connectViewer(
        initialId
      );

    }

  }


  /* =========================================================
     CAMERA
  ========================================================== */

  async function startMonitoring(){

    if(running)
      return;


    try{

      setGlobalStatus(
        "ready",
        "STARTING",
        "Requesting camera access…"
      );


      $("startBtn")
        .disabled =
        true;


      /* CAMERA */

      if(!stream){

        stream =
          await navigator.mediaDevices
            .getUserMedia(
              {
                video:{
                  facingMode:{
                    ideal:
                      "environment"
                  },

                  width:{
                    ideal:1080
                  },

                  height:{
                    ideal:1920
                  },

                  aspectRatio:{
                    ideal:
                      9 / 16
                  }
                },

                audio:false
              }
            );

      }


      video.srcObject =
        stream;


      await video
        .play()
        .catch(
          () => {}
        );

      resizeCameraCanvas();

      positionZoneHandles();

      setCameraSetupVisible(false);


      running =
        true;

      proActivity=Array(30).fill(0);
      proZoneState.clear();
      renderActivityGraph();
      if(navigator.wakeLock?.request)navigator.wakeLock.request("screen").then(x=>proWakeLock=x).catch(()=>{});

      sessionStartedAt =
        Date.now();


      sessionTimer =
        setInterval(
          () => {

            $("sessionTime")
              .textContent =
              formatDuration(
                (
                  Date.now() -
                  sessionStartedAt
                ) / 1000
              );

          },
          500
        );


      $("cameraEmpty")
        .classList
        .add(
          "hidden"
        );


      $("recText")
        .textContent =
        "LIVE";


      $("recDot")
        .parentElement
        .classList
        .add(
          "live"
        );


      $("startBtn")
        .innerHTML =
        "<span>■</span> Stop monitoring";


      $("zoomSlider")
        .disabled =
        false;


      configureZoom();


      setGlobalStatus(
        "live",
        "LIVE",
        "AI monitoring active"
      );


      /* AI */

      if(!model){

        toast(
          "Loading AI model…"
        );

        model =
          await cocoSsd.load(
            {
              base:
                "mobilenet_v2"
            }
          );

      }


      toast(
        "GHOST is watching"
      );


      /*
        IMPORTANT:
        If the Viewer connected before the camera
        started, send the video now.
      */

      if(
        viewerConn?.open
      ){

        callViewer(
          viewerConn.peer
        );

      }


      detectionLoop();


    }catch(error){

      console.error(
        error
      );


      setGlobalStatus(
        "alert",
        "CAMERA ERROR",
        error.name ===
        "NotAllowedError"
          ? "Camera permission denied"
          : "Could not start camera"
      );


      toast(
        error.name ===
        "NotAllowedError"
          ? "Allow camera access in Safari settings."
          : "Could not start the camera."
      );


    }finally{

      $("startBtn")
        .disabled =
        false;

    }

  }


  function stopMonitoring(){

    running =
      false;

    try{proWakeLock?.release?.();}catch{}
    proWakeLock=null;
    proZoneState.clear();

    detecting =
      false;


    clearTimeout(
      detectTimer
    );

    clearInterval(
      sessionTimer
    );

    sessionTimer =
      null;


    if(stream){

      stream
        .getTracks()
        .forEach(
          track =>
            track.stop()
        );

      stream =
        null;

    }


    video.srcObject =
      null;


    $("cameraEmpty")
      .classList
      .remove(
        "hidden"
      );


    $("recText")
      .textContent =
      "OFFLINE";


    $("recDot")
      .parentElement
      .classList
      .remove(
        "live"
      );


    $("startBtn")
      .innerHTML =
      "<span>●</span> Start monitoring";


    $("zoomSlider")
      .disabled =
      true;


    $("sessionTime")
      .textContent =
      "00:00";

    if(role === "camera"){
      setCameraSetupVisible(true);
    }


    setGlobalStatus(
      "ready",
      "READY",
      "Camera inactive"
    );


    ctx.clearRect(
      0,
      0,
      canvas.width,
      canvas.height
    );


    sendPeer(
      {
        kind:
          "state",

        tracks:[],

        zone,

        stats:
          statsPayload()
      }
    );

  }


  /* =========================================================
     AI LOOP
  ========================================================== */

  async function detectionLoop(){

    if(
      !running ||
      !model ||
      detecting
    ){

      return;

    }


    detecting =
      true;


    try{

      if(
        video.readyState >= 2 &&
        video.videoWidth > 0
      ){

        resizeCameraCanvas();


        const predictions =
          await model.detect(
            video,
            20,
            detectionThreshold
          );


        processDetections(
          predictions || []
        );

      }


    }catch(error){

      console.warn(
        "Detection error",
        error
      );


    }finally{

      detecting =
        false;


      if(running){

        detectTimer =
          setTimeout(
            detectionLoop,
            180
          );

      }

    }

  }


  /*
    DISPLAY GEOMETRY
    ----------------
    The video uses object-fit: cover inside the portrait stage.
    COCO-SSD returns bbox coordinates in SOURCE video pixels.
    We map source pixels to the exact visible STAGE coordinates
    for both Camera and Viewer overlays.
  */

  function coverTransform(
    sourceW,
    sourceH,
    stageW,
    stageH
  ){

    const sw =
      Math.max(
        1,
        Number(sourceW) || 1
      );

    const sh =
      Math.max(
        1,
        Number(sourceH) || 1
      );

    const dw =
      Math.max(
        1,
        Number(stageW) || 1
      );

    const dh =
      Math.max(
        1,
        Number(stageH) || 1
      );

    const scale =
      Math.max(
        dw / sw,
        dh / sh
      );

    return {
      scale,
      offsetX:
        (dw - sw * scale) / 2,
      offsetY:
        (dh - sh * scale) / 2,
      sourceW:sw,
      sourceH:sh,
      stageW:dw,
      stageH:dh
    };
  }


  function resizeOverlayCanvas(
    targetCanvas,
    stageEl
  ){

    const rect =
      stageEl.getBoundingClientRect();

    const width =
      Math.max(
        1,
        Math.round(
          rect.width
        )
      );

    const height =
      Math.max(
        1,
        Math.round(
          rect.height
        )
      );

    const dpr =
      Math.max(
        1,
        Math.min(
          2,
          window.devicePixelRatio || 1
        )
      );

    targetCanvas.width =
      Math.max(
        1,
        Math.round(
          width * dpr
        )
      );

    targetCanvas.height =
      Math.max(
        1,
        Math.round(
          height * dpr
        )
      );

    const context =
      targetCanvas === canvas
        ? ctx
        : viewerCtx;

    context.setTransform(
      dpr,
      0,
      0,
      dpr,
      0,
      0
    );

    return {
      width,
      height,
      dpr
    };
  }


  function sourcePointToStage(
    x,
    y,
    transform
  ){

    return {
      x:
        x * transform.scale +
        transform.offsetX,

      y:
        y * transform.scale +
        transform.offsetY
    };
  }


  function sourceBoxToStage(
    bbox,
    transform
  ){

    const [
      x,
      y,
      width,
      height
    ] =
      bbox || [0,0,0,0];

    const point =
      sourcePointToStage(
        x,
        y,
        transform
      );

    return {
      x:
        point.x,

      y:
        point.y,

      width:
        width *
        transform.scale,

      height:
        height *
        transform.scale
    };
  }


  function normalizedPointToStage(
    point,
    transform
  ){

    return sourcePointToStage(
      point.x *
        transform.sourceW,
      point.y *
        transform.sourceH,
      transform
    );
  }


  function stagePointToNormalized(
    clientX,
    clientY,
    stageEl,
    sourceW,
    sourceH
  ){

    const rect =
      stageEl.getBoundingClientRect();

    const transform =
      coverTransform(
        sourceW || 1080,
        sourceH || 1920,
        rect.width,
        rect.height
      );

    const displayX =
      clientX -
      rect.left;

    const displayY =
      clientY -
      rect.top;

    return {
      x:
        clamp(
          (
            displayX -
            transform.offsetX
          ) /
          transform.scale /
          transform.sourceW,
          0,
          1
        ),

      y:
        clamp(
          (
            displayY -
            transform.offsetY
          ) /
          transform.scale /
          transform.sourceH,
          0,
          1
        )
    };
  }


  function resizeCameraCanvas(){

    return resizeOverlayCanvas(
      canvas,
      $("cameraStage")
    );
  }


  /* =========================================================
     TRACKING HELPERS
  ========================================================== */

  function centerOf(
    bbox
  ){

    return {
      x:
        bbox[0] +
        bbox[2] / 2,

      y:
        bbox[1] +
        bbox[3] / 2
    };

  }


  function distance(
    a,
    b
  ){

    return Math.hypot(
      a.x - b.x,
      a.y - b.y
    );

  }


  /* =========================================================
     POINT IN ZONE
  ========================================================== */

  function pointInside(
    p,
    polygon
  ){

    let inside =
      false;


    for(
      let i = 0,
          j = polygon.length - 1;

      i < polygon.length;

      j = i++
    ){

      const xi =
        polygon[i].x;

      const yi =
        polygon[i].y;

      const xj =
        polygon[j].x;

      const yj =
        polygon[j].y;


      const hit =
        (
          (yi > p.y) !==
          (yj > p.y)
        ) &&
        (
          p.x <
          (
            (xj - xi) *
            (p.y - yi)
          ) /
          (yj - yi) +
          xi
        );


      if(hit){

        inside =
          !inside;

      }

    }


    return inside;

  }


  function zonePolygonPixels(){

    return zone.points.map(
      p => ({
        x:
          p.x *
          canvas.width,

        y:
          p.y *
          canvas.height
      })
    );

  }


  /* =========================================================
     PROCESS DETECTIONS
  ========================================================== */

  function processDetections(
    predictions
  ){

    const current =
      predictions.map(
        p => ({

          class:
            p.class,

          score:
            p.score,

          bbox:
            p.bbox,

          center:
            centerOf(
              p.bbox
            ),

          id:
            null,

          inside:
            false,

          moved:
            false

        })
      );


    const maxMatch =
      Math.max(
        canvas.width,
        canvas.height
      ) * .12;


    const used =
      new Set();


    /* MATCH OBJECTS */

    current.forEach(
      obj => {

        let best =
          null;

        let bestDist =
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
              track.class !==
              obj.class
            )
              return;


            const d =
              distance(
                track.center,
                obj.center
              );


            if(
              d < bestDist &&
              d < maxMatch
            ){

              best =
                track;

              bestDist =
                d;

            }

          }
        );


        if(best){

          used.add(
            best.id
          );


          obj.id =
            best.id;


          obj.moved =
            bestDist >
            Math.max(
              22,
              Math.min(
                canvas.width,
                canvas.height
              ) * .025
            );


          if(
            obj.moved &&
            !movedTrackIds.has(
              obj.id
            )
          ){

            movedTrackIds.add(
              obj.id
            );

            movedCount++;

          }


        }else{

          obj.id =
            nextTrackId++;


          uniqueClasses.add(
            obj.class
          );


          uniqueObjectIds.add(
            obj.id
          );


          tracks.push(
            {
              id:
                obj.id,

              class:
                obj.class,

              center:
                obj.center,

              lastSeen:
                Date.now(),

              inside:
                false
            }
          );

        }


        obj.inside =
          pointInside(
            obj.center,
            zonePolygonPixels()
          );

      }
    );


    const previousTracks =
      new Map(
        tracks.map(
          t => [
            t.id,
            t
          ]
        )
      );


    /* UPDATE TRACKS */

    current.forEach(
      obj => {

        const previous =
          previousTracks.get(
            obj.id
          );


        if(
          previous &&
          zone.enabled &&
          obj.inside &&
          !previous.inside
        ){

          zoneEntries++;


          createEvent(
            obj,
            "entered zone",
            true
          );

        }


        const track =
          tracks.find(
            t =>
              t.id ===
              obj.id
          );


        if(track){

          track.center =
            obj.center;

          track.lastSeen =
            Date.now();

          track.inside =
            obj.inside;

        }

      }
    );


    /* REMOVE OLD TRACKS */

    tracks =
      tracks.filter(
        track =>
          Date.now() -
          track.lastSeen <
          1800
      );


    /* DRAW */

    drawDetections(
      current
    );


    renderStats(
      current.length
    );


    renderObjects(
      current
    );


    sendDetectionState(
      current
    );


    /* GENERAL EVENT */

    const significant =
      current.filter(
        o =>
          o.score >=
          Math.max(
            detectionThreshold,
            .5
          )
      );


    if(
      significant.length &&
      Date.now() -
      lastEventAt >
      3000
    ){

      const target =
        significant.find(
          o =>
            [
              "person",
              "car",
              "truck",
              "bus",
              "motorcycle"
            ].includes(
              o.class
            )
        ) ||
        significant[0];


      createEvent(
        target,
        target.moved
          ? "movement detected"
          : "detected",
        false
      );

    }


    lastDetectionState =
      current;

    proEventEngine(current);

  }


  /* =========================================================
     PRODUCT EVENT ENGINE
  ========================================================== */
  function renderActivityGraph(){const el=$("activityGraph");if(!el)return;const max=Math.max(2,...proActivity);el.innerHTML=proActivity.map((v,i)=>`<i class="activity-bar ${i===29?"hot":""}" style="--h:${Math.max(4,Math.round(v/max*100))}%"></i>`).join("");const b=$("activityNow");if(b){b.textContent=proActivity[29]>0?"ACTIVE":"QUIET";b.classList.toggle("active",proActivity[29]>0);}}
  async function updateProHealth(){if(Date.now()-proLastHealthAt<1000)return;proLastHealthAt=Date.now();if($("healthState"))$("healthState").textContent=running?"LIVE":"READY";if($("healthFps"))$("healthFps").textContent=running?"~5":"—";if($("healthNetwork"))$("healthNetwork").textContent=navigator.onLine?"ONLINE":"OFFLINE";try{const b=await navigator.getBattery?.();if($("healthBattery"))$("healthBattery").textContent=b?`${Math.round(b.level*100)}%`:"—";}catch{}}
  function proEventEngine(items){const now=Date.now();const seen=new Set();items.forEach(obj=>{const t=tracks.find(x=>x.id===obj.id);if(!t)return;seen.add(obj.id);let m=proZoneState.get(obj.id);if(!m){m={inside:false,since:0,dwell:false,loiter:false};proZoneState.set(obj.id,m);}const inside=!!(zone.enabled&&obj.inside);if(inside&&!m.inside){m.inside=true;m.since=now;m.dwell=false;m.loiter=false;}if(!inside&&m.inside){m.inside=false;m.since=0;m.dwell=false;m.loiter=false;createEvent(obj,"left zone",true);}if(inside&&m.since){const sec=(now-m.since)/1000;if(!m.dwell&&sec>=dwellSeconds){m.dwell=true;createEvent(obj,`inside zone ${dwellSeconds}s`,true);}if(!m.loiter&&sec>=Math.max(30,dwellSeconds*2)){m.loiter=true;createEvent(obj,"loitering",true);}}});for(const [id] of proZoneState)if(!seen.has(id)&&!tracks.some(t=>t.id===id))proZoneState.delete(id);const people=items.filter(x=>x.class==="person").length;if(people>=2&&now-proLastPeopleAlertAt>30000){proLastPeopleAlertAt=now;createEvent(items.find(x=>x.class==="person")||items[0],"multiple people",true);}const activity=Math.min(12,items.length+items.filter(x=>x.moved).length*2);proActivity[29]=Math.max(proActivity[29],activity);renderActivityGraph();updateProHealth();}

  /* =========================================================
     DRAW DETECTIONS
  ========================================================== */

  function drawDetections(
    items
  ){

    const size =
      resizeOverlayCanvas(
        canvas,
        $("cameraStage")
      );

    ctx.clearRect(
      0,
      0,
      size.width,
      size.height
    );

    const transform =
      coverTransform(
        video.videoWidth || 1080,
        video.videoHeight || 1920,
        size.width,
        size.height
      );

    ctx.lineWidth =
      Math.max(
        1.5,
        Math.min(
          3,
          Math.min(
            size.width,
            size.height
          ) / 240
        )
      );

    items.forEach(
      o => {

        const box =
          sourceBoxToStage(
            o.bbox,
            transform
          );

        ctx.strokeStyle =
          "#6c63ff";

        ctx.strokeRect(
          box.x,
          box.y,
          box.width,
          box.height
        );

        const label =
          `${typeName(
            o.class
          )} ${Math.round(
            o.score * 100
          )}%`;

        ctx.font =
          `${Math.max(
            9,
            Math.min(
              13,
              size.width / 35
            )
          )}px -apple-system,BlinkMacSystemFont,sans-serif`;

        const labelW =
          ctx.measureText(
            label
          ).width + 12;

        const labelH =
          21;

        const labelX =
          clamp(
            box.x,
            0,
            Math.max(
              0,
              size.width -
              labelW
            )
          );

        const labelY =
          Math.max(
            0,
            box.y -
            labelH
          );

        ctx.fillStyle =
          "#fffdf9";

        ctx.fillRect(
          labelX,
          labelY,
          labelW,
          labelH
        );

        ctx.fillStyle =
          "#5e56dc";

        ctx.fillText(
          label,
          labelX + 6,
          labelY + 14.5
        );
      }
    );

    drawZone(
      ctx,
      size.width,
      size.height,
      zone,
      zoneEditing,
      transform
    );
  }


  /* =========================================================
     DRAW ZONE
  ========================================================== */

  function drawZone(
    context,
    w,
    h,
    z,
    editing = false
  ){

    if(
      !z ||
      !z.enabled
    )
      return;


    const pts =
      z.points.map(
        p => ({
          x:
            p.x * w,

          y:
            p.y * h
        })
      );


    context.save();


    context.beginPath();


    context.moveTo(
      pts[0].x,
      pts[0].y
    );


    pts
      .slice(1)
      .forEach(
        p =>
          context.lineTo(
            p.x,
            p.y
          )
      );


    context.closePath();


    context.fillStyle =
      editing

        ? "rgba(139,99,255,.11)"

        : "rgba(139,99,255,.07)";


    context.fill();


    context.strokeStyle =
      "rgba(179,140,255,.9)";


    context.lineWidth =
      Math.max(
        2,
        w / 700
      );


    context.setLineDash(
      editing
        ? [8,8]
        : []
    );


    context.stroke();


    context.restore();

  }


  /* =========================================================
     STATS
  ========================================================== */

  function renderStats(
    visible
  ){

    $("visibleCount")
      .textContent =
      visible;


    $("uniqueCount")
      .textContent =
      uniqueObjectIds.size;


    $("movedCount")
      .textContent =
      movedCount;


    $("zoneCount")
      .textContent =
      zoneEntries;


    $("objectCountLabel")
      .textContent =
      visible;

  }


  /* =========================================================
     OBJECT LIST
  ========================================================== */

  function renderObjects(
    items
  ){

    const el =
      $("objectList");


    if(
      !items.length
    ){

      el.innerHTML =
        '<div class="empty">No objects detected yet.</div>';

      return;

    }


    const counts =
      {};


    items.forEach(
      o => {

        counts[o.class] =
          Math.max(
            counts[o.class] || 0,
            o.score
          );

      }
    );


    el.innerHTML =
      Object.entries(
        counts
      )
      .sort(
        (a,b) =>
          b[1] -
          a[1]
      )
      .map(
        ([type,score]) =>
          `
          <div class="object-card">

            <strong>
              ${escapeHTML(
                typeName(type)
              )}
            </strong>

            <small>
              ${Math.round(
                score * 100
              )}% confidence
            </small>

            <div class="score-bar">
              <i
                style="width:${Math.round(
                  score * 100
                )}%"
              ></i>
            </div>

          </div>
          `
      )
      .join("");

  }


  /* =========================================================
     EVENTS
  ========================================================== */

  function createEvent(
    obj,
    action,
    force
  ){

    const stamp =
      Date.now();


    if(
      !force &&
      stamp -
      lastEventAt <
      3000
    ){

      return;

    }


    lastEventAt =
      stamp;


    const event =
      {
        id:
          uid(),

        time:
          nowTime(),

        type:
          obj.class,

        action,

        score:
          obj.score,

        bbox:
          obj.bbox,

        image:
          null,

        preview:
          null
      };


    events.unshift(
      event
    );


    if(
      events.length >
      80
    ){

      events.length =
        80;

    }


    event.preview =
      createEventPreview(
        event
      );


    renderEventLog();


    $("eventCount")
      .textContent =
      String(
        events.length
      );


    $("lastEvent")
      .classList
      .remove(
        "hidden"
      );


    $("lastEventText")
      .textContent =
      `${typeName(
        obj.class
      )} · ${action}`;


    setGlobalStatus(
      "alert",
      "ALERT",
      `${typeName(
        obj.class
      )} ${action}`
    );


    setTimeout(
      () => {

        if(running){

          setGlobalStatus(
            "live",
            "LIVE",
            "AI monitoring active"
          );

        }

      },
      1500
    );


    alertFeedback(obj.class,action);


    if(
      snapshotsEnabled
    ){

      captureSnapshot(
        event
      );

    }


    sendPeer(
      {
        kind:
          "event",

        event:
          {
            ...event,
            image:null,
            preview:
              event.preview ||
              null
          }
      }
    );

  }


  function renderEventLog(){

    const el =
      $("eventLog");


    if(
      !events.length
    ){

      el.innerHTML =
        '<div class="empty">Waiting for activity</div>';

      return;

    }


    el.innerHTML =
      events
        .slice(
          0,
          12
        )
        .map(
          e =>
            `
            <div class="event-row">

              <div class="event-time">
                ${escapeHTML(e.time)}
              </div>

              <div class="event-icon">
                ${e.preview ? `<img class="event-thumb" src="${e.preview}" alt="">` : iconFor(e.type)}
              </div>

              <div>

                <div class="event-main">
                  ${escapeHTML(
                    typeName(e.type)
                  )}
                  ·
                  ${escapeHTML(
                    e.action
                  )}
                </div>

                <span class="event-sub">
                  ${Math.round(
                    e.score * 100
                  )}% confidence
                </span>

              </div>

            </div>
            `
        )
        .join("");

  }


  /* =========================================================
     ALERT FEEDBACK
  ========================================================== */

  function alertFeedback(objectType="all", action="detected"){

    if(alertProfile === "silent" || (alertObjectFilter !== "all" && objectType !== alertObjectFilter)) return;
    const aggressive = alertProfile === "aggressive";

    /* SOUND */

    if(soundEnabled){

      try{

        audioContext ||=
          new (
            window.AudioContext ||
            window.webkitAudioContext
          )();


        if(
          audioContext.state ===
          "suspended"
        ){

          audioContext.resume();

        }


        const osc =
          audioContext.createOscillator();


        const gain =
          audioContext.createGain();


        osc.frequency.value =
          aggressive ? 920 : 720;


        gain.gain.setValueAtTime(
          .0001,
          audioContext.currentTime
        );


        gain.gain.exponentialRampToValueAtTime(
          .06,
          audioContext.currentTime +
          .01
        );


        gain.gain.exponentialRampToValueAtTime(
          .0001,
          audioContext.currentTime +
          .13
        );


        osc
          .connect(gain)
          .connect(
            audioContext.destination
          );


        osc.start();


        osc.stop(
          audioContext.currentTime +
          .14
        );

      }catch{

        /* Audio unsupported */

      }

    }


    /* VIBRATION */

    if(
      vibrationEnabled &&
      navigator.vibrate
    ){

      navigator.vibrate(
        [
          70,
          40,
          70
        ]
      );

    }

  }


  /* =========================================================
     SNAPSHOT
  ========================================================== */

  function createEventPreview(
    event
  ){

    if(
      !video.videoWidth ||
      !video.videoHeight
    ){

      return null;
    }

    try{

      const sourceW =
        video.videoWidth;

      const sourceH =
        video.videoHeight;

      const maxWidth =
        280;

      const scale =
        Math.min(
          1,
          maxWidth /
          sourceW
        );

      const preview =
        document.createElement(
          "canvas"
        );

      preview.width =
        Math.max(
          1,
          Math.round(
            sourceW * scale
          )
        );

      preview.height =
        Math.max(
          1,
          Math.round(
            sourceH * scale
          )
        );

      const pctx =
        preview.getContext(
          "2d"
        );

      pctx.drawImage(
        video,
        0,
        0,
        preview.width,
        preview.height
      );

      const [
        x,
        y,
        width,
        height
      ] =
        event.bbox ||
        [0,0,0,0];

      pctx.strokeStyle =
        "#6c63ff";

      pctx.lineWidth =
        Math.max(
          2,
          preview.width / 180
        );

      pctx.strokeRect(
        x * scale,
        y * scale,
        width * scale,
        height * scale
      );

      return preview.toDataURL(
        "image/jpeg",
        .42
      );

    }catch(error){

      console.warn(
        "Preview error",
        error
      );

      return null;
    }
  }


  function captureSnapshot(
    event
  ){

    if(
      !video.videoWidth ||
      !video.videoHeight
    ){

      return;

    }


    const c =
      document.createElement(
        "canvas"
      );


    c.width =
      video.videoWidth;

    c.height =
      video.videoHeight;


    const cctx =
      c.getContext(
        "2d"
      );


    cctx.drawImage(
      video,
      0,
      0,
      c.width,
      c.height
    );


    cctx.strokeStyle =
      "#b38cff";


    cctx.lineWidth =
      Math.max(
        2,
        c.width / 500
      );


    cctx.strokeRect(
      ...event.bbox
    );


    event.image =
      c.toDataURL(
        "image/jpeg",
        .72
      );


    archive.unshift(
      {
        id:
          event.id,

        time:
          event.time,

        type:
          event.type,

        score:
          event.score,

        image:
          event.image,

        action:
          event.action,

        createdAt:
          Date.now()
      }
    );


    archive =
      archive.slice(
        0,
        80
      );


    saveJSON(
      "ghost-archive",
      archive
    );

    idbPut(archive[0]);

    renderArchive();

  }


  /* =========================================================
     STATS PAYLOAD
  ========================================================== */

  function statsPayload(){

    return {

      visible:
        lastDetectionState.length,

      unique:
        uniqueObjectIds.size,

      moved:
        movedCount,

      entries:
        zoneEntries,

      session:
        sessionStartedAt
          ? Date.now() -
            sessionStartedAt
          : 0

    };

  }


  /* =========================================================
     SEND AI STATE
  ========================================================== */

  function sendDetectionState(
    items = lastDetectionState
  ){

    sendPeer(
      {
        kind:
          "state",

        tracks:
          items.map(
            o =>
              ({
                id:
                  o.id,

                class:
                  o.class,

                score:
                  o.score,

                bbox:
                  o.bbox
              })
          ),

        zone,

        stats:
          statsPayload()
      }
    );
  }


  /*
    Event history is sent only on connection/state requests.
    Do NOT attach photos to the 5x-per-second detection state.
  */

  function sendRecentEvents(){

    if(
      !viewerConn?.open
    ){

      return;
    }

    sendPeer({
      kind:
        "recent-events",

      events:
        events
          .slice(
            0,
            8
          )
          .map(
            e =>
              ({
                id:
                  e.id,

                time:
                  e.time,

                type:
                  e.type,

                action:
                  e.action,

                score:
                  e.score,

                preview:
                  e.preview ||
                  null
              })
          )
    });
  }


  /* =========================================================
     ZONE UI
  ========================================================== */

  function loadZoneUI(){

    $("zoneToggle")
      .checked =
      !!zone.enabled;


    $("zoneName")
      .textContent =
      zone.enabled
        ? zone.name
        : "Zone disabled";


    $("zoneStatus")
      .textContent =
      zone.enabled
        ? "Crossing detection is active"
        : "Crossing detection is off";


    $("zoneOverlayLabel")
      .textContent =
      zone.name;


    positionZoneHandles();


    $("zoneOverlay")
      .classList
      .add(
        "hidden"
      );


    $("zoneEditor")
      .classList
      .toggle(
        "hidden",
        !zoneEditing
      );

  }


  function positionZoneHandles(){

    const cameraRect =
      $("cameraStage")
        .getBoundingClientRect();

    const cameraTransform =
      coverTransform(
        video.videoWidth || 1080,
        video.videoHeight || 1920,
        cameraRect.width,
        cameraRect.height
      );

    document
      .querySelectorAll(
        "#zoneEditor .zone-handle"
      )
      .forEach(
        handle => {

          const p =
            zone.points[
              Number(
                handle.dataset.corner
              )
            ];

          if(!p)
            return;

          const point =
            normalizedPointToStage(
              p,
              cameraTransform
            );

          handle.style.left =
            `${point.x}px`;

          handle.style.top =
            `${point.y}px`;
        }
      );


    const viewerRect =
      $("viewerStage")
        .getBoundingClientRect();

    const viewerTransform =
      coverTransform(
        remoteVideo.videoWidth || 1080,
        remoteVideo.videoHeight || 1920,
        viewerRect.width,
        viewerRect.height
      );

    document
      .querySelectorAll(
        "#viewerZoneEditor .zone-handle"
      )
      .forEach(
        handle => {

          const p =
            viewerZone.points[
              Number(
                handle.dataset.corner
              )
            ];

          if(!p)
            return;

          const point =
            normalizedPointToStage(
              p,
              viewerTransform
            );

          handle.style.left =
            `${point.x}px`;

          handle.style.top =
            `${point.y}px`;
        }
      );
  }


  function toggleZoneEditor(){

    zoneEditing =
      !zoneEditing;


    loadZoneUI();


    resizeCameraCanvas();


    if(running){

      drawDetections(
        lastDetectionState
      );

    }

  }


  /* =========================================================
     ZONE DRAG
  ========================================================== */

  function initZoneDrag(){

    document
      .querySelectorAll(
        "#zoneEditor .zone-handle"
      )
      .forEach(
        handle => {

          handle.addEventListener(
            "pointerdown",
            e => {

              handle.setPointerCapture(
                e.pointerId
              );


              const move =
                ev => {

                  zone.points[
                    Number(
                      handle.dataset.corner
                    )
                  ] =
                    stagePointToNormalized(
                      ev.clientX,
                      ev.clientY,
                      $("cameraStage"),
                      video.videoWidth || 1080,
                      video.videoHeight || 1920
                    );


                  positionZoneHandles();

                };


              const up =
                () => {

                  handle.removeEventListener(
                    "pointermove",
                    move
                  );


                  handle.removeEventListener(
                    "pointerup",
                    up
                  );


                  saveJSON(
                    "ghost-zone",
                    zone
                  );


                  if(running){

                    drawDetections(
                      lastDetectionState
                    );

                  }


                  sendPeer(
                    {
                      kind:
                        "zone",

                      zone
                    }
                  );

                };


              handle.addEventListener(
                "pointermove",
                move
              );


              handle.addEventListener(
                "pointerup",
                up
              );

            }
          );

        }
      );

  }


  /* =========================================================
     CAMERA ZOOM
  ========================================================== */

  function configureZoom(){

    if(!stream)
      return;


    const track =
      stream.getVideoTracks()[0];


    if(!track)
      return;


    const caps =
      track.getCapabilities?.() ||
      {};


    if(caps.zoom){

      $("zoomSlider")
        .min =
        String(
          caps.zoom.min ??
          1
        );


      $("zoomSlider")
        .max =
        String(
          caps.zoom.max ??
          1
        );


      $("zoomSlider")
        .step =
        String(
          caps.zoom.step ??
          .1
        );


      $("zoomSlider")
        .value =
        String(
          caps.zoom.min ??
          1
        );


      $("zoomValue")
        .textContent =
        `${Number(
          $("zoomSlider").value
        ).toFixed(1)}×`;

    }else{

      /*
        Fallback slider.

        Some browsers do not expose optical zoom.
        The slider remains available visually,
        but applyConstraints may simply fail.
      */

      $("zoomSlider")
        .min =
        "1";

      $("zoomSlider")
        .max =
        "3";

      $("zoomSlider")
        .step =
        "0.1";

      $("zoomSlider")
        .value =
        "1";

    }

  }


  async function applyZoom(
    value
  ){

    if(!stream)
      return;


    const track =
      stream.getVideoTracks()[0];


    if(!track)
      return;


    const num =
      Number(value);


    $("zoomValue")
      .textContent =
      `${num.toFixed(1)}×`;


    try{

      await track.applyConstraints(
        {
          advanced:[
            {
              zoom:
                num
            }
          ]
        }
      );

    }catch{

      /*
        Optical zoom unsupported.
      */

    }

  }


  $("zoomSlider")
    .addEventListener(
      "input",
      e =>
        applyZoom(
          e.target.value
        )
    );


  $("zoomPlus")
    .addEventListener(
      "click",
      () => {

        const s =
          $("zoomSlider");


        s.value =
          String(
            clamp(
              Number(
                s.value
              ) +
              Number(
                s.step ||
                .1
              ),

              Number(
                s.min
              ),

              Number(
                s.max
              )
            )
          );


        applyZoom(
          s.value
        );

      }
    );


  $("zoomMinus")
    .addEventListener(
      "click",
      () => {

        const s =
          $("zoomSlider");


        s.value =
          String(
            clamp(
              Number(
                s.value
              ) -
              Number(
                s.step ||
                .1
              ),

              Number(
                s.min
              ),

              Number(
                s.max
              )
            )
          );


        applyZoom(
          s.value
        );

      }
    );


  /* =========================================================
     PEERJS
  ========================================================== */

  function makePeerId(){

    return (
      "ghost-" +
      Math.random()
        .toString(36)
        .slice(2,6)
    );

  }


  function peerConfig(){

    return {

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

    };

  }


  /* =========================================================
     CAMERA PEER
  ========================================================== */

  function startPeerCamera(){

    if(
      peer ||
      role !==
      "camera"
    ){

      return;

    }


    peer =
      new Peer(
        makePeerId(),
        peerConfig()
      );


    peer.on(
      "open",
      id => {

        peerId =
          id;


        $("peerIdField")
          .value =
          id;


        $("connectionState")
          .textContent =
          "READY";


        $("connectionState")
          .classList
          .add(
            "online"
          );


        renderQR(
          id
        );

      }
    );


    peer.on(
      "connection",
      conn =>
        setupCameraConnection(
          conn
        )
    );


    peer.on(
      "call",
      call => {

        if(stream){

          call.answer(
            stream
          );

        }else{

          call.answer();

        }

      }
    );


    peer.on(
      "error",
      error => {

        console.warn(
          "PeerJS camera",
          error
        );


        $("connectionState")
          .textContent =
          "ERROR";


        $("connectionState")
          .classList
          .remove(
            "online"
          );

      }
    );

  }


  /* =========================================================
     CAMERA DATA CONNECTION
  ========================================================== */

  function setupCameraConnection(
    conn
  ){

    viewerConn =
      conn;


    conn.on(
      "open",
      () => {

        $("connectionState")
          .textContent =
          "CONNECTED";


        $("connectionState")
          .classList
          .add(
            "online"
          );


        conn.send(
          {
            kind:
              "hello",

            name:
              $("cameraTitle")
                .textContent
          }
        );


        sendDetectionState();

        sendRecentEvents();


        conn.send(
          {
            kind:
              "zone",

            zone
          }
        );


        /*
          Important:
          if camera is already running,
          immediately send the media stream.
        */

        if(stream){

          callViewer(
            conn.peer
          );

        }

      }
    );


    conn.on(
      "data",
      data => {

        if(
          !data ||
          typeof data !==
          "object"
        ){

          return;

        }


        /* STREAM REQUEST */

        if(
          data.kind ===
          "request-stream" &&
          stream
        ){

          callViewer(
            conn.peer
          );

        }


        /* STATE REQUEST */

        if(
          data.kind ===
          "request-state"
        ){

          sendDetectionState();

          sendRecentEvents();

        }


        /* REMOTE ZONE TOGGLE */

        if(
          data.kind ===
          "set-zone-enabled"
        ){

          zone.enabled =
            !!data.enabled;


          saveJSON(
            "ghost-zone",
            zone
          );


          loadZoneUI();


          sendDetectionState();

        }


        /* REMOTE ZONE EDIT */

        if(
          data.kind ===
          "set-zone" &&
          Array.isArray(
            data.zone?.points
          )
        ){

          zone =
            {
              ...zone,

              ...data.zone,

              points:
                data.zone.points
                  .slice(0,4)
                  .map(
                    p =>
                      ({
                        x:
                          clamp(
                            Number(
                              p.x
                            ),
                            0,
                            1
                          ),

                        y:
                          clamp(
                            Number(
                              p.y
                            ),
                            0,
                            1
                          )
                      })
                  )
            };


          saveJSON(
            "ghost-zone",
            zone
          );


          loadZoneUI();


          sendDetectionState();

        }

      }
    );


    conn.on(
      "close",
      () => {

        $("connectionState")
          .textContent =
          "READY";


        $("connectionState")
          .classList
          .remove(
            "online"
          );

      }
    );


    conn.on(
      "error",
      console.warn
    );

  }


  /* =========================================================
     CALL VIEWER
  ========================================================== */

  function callViewer(
    id
  ){

    if(
      !peer ||
      !stream ||
      !id
    ){

      return;

    }


    try{

      const call =
        peer.call(
          id,
          stream,
          {
            metadata:{
              ghost:true
            }
          }
        );


      call.on(
        "error",
        console.warn
      );

    }catch(error){

      console.warn(
        error
      );

    }

  }


  /* =========================================================
     CLOSE PEER
  ========================================================== */

  function closePeer(){

    if(peer){

      try{

        peer.destroy();

      }catch{

        /* ignore */

      }

    }


    peer =
      null;


    peerId =
      "";


    viewerConn =
      null;

  }


  /* =========================================================
     SEND DATA
  ========================================================== */

  function sendPeer(
    data
  ){

    if(
      viewerConn?.open
    ){

      try{

        viewerConn.send(
          data
        );

      }catch(error){

        console.warn(
          error
        );

      }

    }

  }


  /* =========================================================
     QR
  ========================================================== */

  function renderQR(
    id
  ){

    $("qrCode")
      .innerHTML =
      "";


    if(
      !window.QRCode
    ){

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

        width:
          115,

        height:
          115,

        colorDark:
          "#09080f",

        colorLight:
          "#ffffff",

        correctLevel:
          QRCode.CorrectLevel.M
      }
    );

  }


  /* =========================================================
     VIEWER CONNECT
  ========================================================== */

  function connectViewer(
    id
  ){

    id =
      (id || "")
        .trim();

    $("viewerPage")?.classList.add("connected-viewer");


    if(!id){

      toast(
        "Enter a camera code first."
      );

      return;

    }


    $("manualPeerId")
      .value =
      id;


    if(peer){

      try{

        peer.destroy();

      }catch{

        /* ignore */

      }


      peer =
        null;

    }


    $("viewerState")
      .textContent =
      "CONNECTING";


    $("viewerDot")
      .parentElement
      .classList
      .remove(
        "live"
      );


    $("viewerEmpty")
      .classList
      .remove(
        "hidden"
      );


    $("viewerEmpty")
      .querySelector(
        "strong"
      )
      .textContent =
      "Connecting…";


    $("viewerEmpty")
      .querySelector(
        "span"
      )
      .textContent =
      "Finding the camera on the network.";


    peer =
      new Peer(
        makePeerId(),
        peerConfig()
      );


    /* PEER READY */

    peer.on(
      "open",
      () => {

        const conn =
          peer.connect(
            id,
            {
              reliable:true,

              serialization:
                "json"
            }
          );


        setupViewerConnection(
          conn
        );

      }
    );


    /* INCOMING VIDEO */

    peer.on(
      "call",
      call => {

        call.answer();


        call.on(
          "stream",
          remoteStream => {

            remoteVideo.srcObject =
              remoteStream;


            remoteVideo
              .play()
              .catch(
                () => {}
              );


            $("viewerEmpty")
              .classList
              .add(
                "hidden"
              );


            $("viewerState")
              .textContent =
              "LIVE";


            $("viewerDot")
              .parentElement
              .classList
              .add(
                "live"
              );


            resizeViewerCanvas();

            positionZoneHandles();


            startViewerRAF();

          }
        );


        call.on(
          "error",
          error => {

            console.warn(
              "Media call",
              error
            );


            viewerConnectionError(
              "Media connection failed."
            );

          }
        );

      }
    );


    /* PEER ERROR */

    peer.on(
      "error",
      error => {

        console.warn(
          "PeerJS viewer",
          error
        );


        viewerConnectionError(
          peerErrorText(
            error
          )
        );

      }
    );

  }


  /* =========================================================
     PEER ERROR TEXT
  ========================================================== */

  function peerErrorText(
    error
  ){

    if(
      error?.type ===
      "peer-unavailable"
    ){

      return (
        "Camera code was not found or is offline."
      );

    }


    if(
      error?.type ===
      "network"
    ){

      return (
        "Network connection to the signaling service failed."
      );

    }


    if(
      error?.type ===
      "webrtc"
    ){

      return (
        "WebRTC could not establish the video connection."
      );

    }


    return (
      "Could not connect to the camera. Check the code and Wi-Fi."
    );

  }


  /* =========================================================
     VIEWER CONNECTION ERROR
  ========================================================== */

  function viewerConnectionError(
    message
  ){

    $("viewerState")
      .textContent =
      "ERROR";


    $("viewerEmpty")
      .classList
      .remove(
        "hidden"
      );


    $("viewerEmpty")
      .querySelector(
        "strong"
      )
      .textContent =
      "Connection failed";


    $("viewerEmpty")
      .querySelector(
        "span"
      )
      .textContent =
      message;


    $("viewerConnectionHint")
      .textContent =
      message;


    toast(
      message
    );

  }


  /* =========================================================
     VIEWER DATA CONNECTION
  ========================================================== */

  function setupViewerConnection(
    conn
  ){

    viewerConn =
      conn;


    conn.on(
      "open",
      () => {

        $("viewerState")
          .textContent =
          "CONNECTED";


        conn.send(
          {
            kind:
              "request-stream"
          }
        );


        conn.send(
          {
            kind:
              "request-state"
          }
        );


        $("viewerConnectionHint")
          .textContent =
          "Connected. Waiting for live video…";

      }
    );


    conn.on(
      "data",
      data => {

        if(
          !data ||
          typeof data !==
          "object"
        ){

          return;

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
          "zone"
        ){

          applyViewerZone(
            data.zone
          );

        }


        if(
          data.kind ===
          "recent-events" &&
          Array.isArray(
            data.events
          )
        ){

          data.events
            .slice()
            .reverse()
            .forEach(
              e =>
                addViewerEvent(
                  e
                )
            );

        }


        if(
          data.kind ===
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


          drawViewerState(
            data.tracks ||
              [],

            data.zone,

            data.stats
          );

        }

      }
    );


    conn.on(
      "close",
      () => {

        $("viewerState")
          .textContent =
          "OFFLINE";


        $("viewerDot")
          .parentElement
          .classList
          .remove(
            "live"
          );


        $("viewerEmpty")
          .classList
          .remove(
            "hidden"
          );


        $("viewerEmpty")
          .querySelector(
            "strong"
          )
          .textContent =
          "Camera disconnected";


        $("viewerEmpty")
          .querySelector(
            "span"
          )
          .textContent =
          "Waiting for the camera to come back online.";

      }
    );


    conn.on(
      "error",
      error =>
        console.warn(
          error
        )
    );

  }


  /* =========================================================
     APPLY VIEWER ZONE
  ========================================================== */

  function applyViewerZone(
    z
  ){

    if(!z)
      return;


    viewerZone =
      {
        ...z,

        points:
          (
            z.points ||
            viewerZone.points
          )
          .map(
            p =>
              ({
                x:
                  Number(
                    p.x
                  ),

                y:
                  Number(
                    p.y
                  )
              })
          )
      };


    $("viewerZoneToggle")
      .checked =
      !!viewerZone.enabled;


    $("viewerZoneStatus")
      .textContent =
      viewerZone.enabled
        ? "Active · crossings tracked"
        : "Disabled";


    $("viewerZoneLabel")
      .textContent =
      viewerZone.name ||
      "Detection zone";


    positionZoneHandles();


    $("viewerZoneOverlay")
      .classList
      .add(
        "hidden"
      );

  }


  /* =========================================================
     VIEWER CANVAS
  ========================================================== */

  function resizeViewerCanvas(){

    return resizeOverlayCanvas(
      viewerCanvas,
      $("viewerStage")
    );
  }


  function startViewerRAF(){

    cancelAnimationFrame(
      viewerRAF
    );

    const loop =
      () => {

        if(
          remoteVideo.srcObject
        ){

          drawViewerState(
            viewerTracks,
            viewerZone
          );

          viewerRAF =
            requestAnimationFrame(
              loop
            );
        }
      };

    loop();
  }


  /* =========================================================
     DRAW VIEWER
  ========================================================== */

  function drawViewerState(
    tracksArg=viewerTracks,
    zoneArg=viewerZone
  ){

    const size =
      resizeViewerCanvas();

    const items =
      Array.isArray(
        tracksArg
      )
        ? tracksArg
        : viewerTracks;

    const z =
      zoneArg ||
      viewerZone;

    viewerCtx.clearRect(
      0,
      0,
      size.width,
      size.height
    );

    const transform =
      coverTransform(
        remoteVideo.videoWidth || 1080,
        remoteVideo.videoHeight || 1920,
        size.width,
        size.height
      );

    viewerCtx.lineWidth =
      Math.max(
        1.5,
        Math.min(
          3,
          Math.min(
            size.width,
            size.height
          ) / 240
        )
      );

    items.forEach(
      o => {

        const box =
          sourceBoxToStage(
            o.bbox,
            transform
          );

        viewerCtx.strokeStyle =
          "#6c63ff";

        viewerCtx.strokeRect(
          box.x,
          box.y,
          box.width,
          box.height
        );

        const label =
          `${typeName(
            o.class
          )} ${Math.round(
            (o.score || 0) * 100
          )}%`;

        viewerCtx.font =
          `${Math.max(
            9,
            Math.min(
              13,
              size.width / 35
            )
          )}px -apple-system,BlinkMacSystemFont,sans-serif`;

        const labelW =
          viewerCtx.measureText(
            label
          ).width + 12;

        const labelH =
          21;

        const labelX =
          clamp(
            box.x,
            0,
            Math.max(
              0,
              size.width -
              labelW
            )
          );

        const labelY =
          Math.max(
            0,
            box.y -
            labelH
          );

        viewerCtx.fillStyle =
          "#fffdf9";

        viewerCtx.fillRect(
          labelX,
          labelY,
          labelW,
          labelH
        );

        viewerCtx.fillStyle =
          "#5e56dc";

        viewerCtx.fillText(
          label,
          labelX + 6,
          labelY + 14.5
        );
      }
    );

    drawZone(
      viewerCtx,
      size.width,
      size.height,
      z,
      viewerZoneEditing,
      transform
    );
  }


  /* =========================================================
     VIEWER EVENTS
  ========================================================== */

  function addViewerEvent(
    event
  ){

    if(!event)
      return;

    const eventId =
      event.id ||
      uid();

    if(
      document.querySelector(
        `[data-ghost-event-id="${CSS.escape(
          eventId
        )}"]`
      )
    ){

      return;
    }

    viewerEvents++;

    $("viewerEventCount")
      .textContent =
      String(
        viewerEvents
      );

    const el =
      $("viewerEventLog");

    if(
      el.querySelector(
        ".empty"
      )
    ){

      el.innerHTML =
        "";
    }

    const photo =
      event.preview ||
      event.image ||
      "";

    el.insertAdjacentHTML(
      "afterbegin",

      `
      <div
        class="event-row viewer-event-row"
        data-ghost-event-id="${escapeHTML(
          eventId
        )}"
      >

        <div class="event-time">
          ${escapeHTML(
            event.time ||
            nowTime()
          )}
        </div>

        <div class="event-icon">
          ${iconFor(
            event.type
          )}
        </div>

        <div>

          <div class="event-main">
            ${escapeHTML(
              typeName(
                event.type
              )
            )}
            ·
            ${escapeHTML(
              event.action ||
              "detected"
            )}
          </div>

          <span class="event-sub">
            Remote camera event
          </span>

          ${
            photo
              ? `
                <img
                  class="event-photo"
                  src="${photo}"
                  alt="Detected object"
                >
              `
              : ""
          }

        </div>

      </div>
      `
    );
  }


  /* =========================================================
     VIEWER ZONE EDITOR
  ========================================================== */

  function toggleViewerZoneEditor(){

    viewerZoneEditing =
      !viewerZoneEditing;


    $("viewerZoneEditor")
      .classList
      .toggle(
        "hidden",
        !viewerZoneEditing
      );


    $("viewerZoneOverlay")
      .classList
      .add(
        "hidden"
      );


    positionZoneHandles();

  }


  function initViewerZoneDrag(){

    document
      .querySelectorAll(
        "#viewerZoneEditor .zone-handle"
      )
      .forEach(
        handle => {

          handle.addEventListener(
            "pointerdown",
            e => {

              handle.setPointerCapture(
                e.pointerId
              );


              const move =
                ev => {

                  viewerZone.points[
                    Number(
                      handle.dataset.corner
                    )
                  ] =
                    stagePointToNormalized(
                      ev.clientX,
                      ev.clientY,
                      $("viewerStage"),
                      remoteVideo.videoWidth || 1080,
                      remoteVideo.videoHeight || 1920
                    );


                  positionZoneHandles();


                  drawViewerState();

                };


              const up =
                () => {

                  handle.removeEventListener(
                    "pointermove",
                    move
                  );


                  handle.removeEventListener(
                    "pointerup",
                    up
                  );


                  sendPeer(
                    {
                      kind:
                        "set-zone",

                      zone:
                        viewerZone
                    }
                  );

                };


              handle.addEventListener(
                "pointermove",
                move
              );


              handle.addEventListener(
                "pointerup",
                up
              );

            }
          );

        }
      );

  }


  /* =========================================================
     ARCHIVE
  ========================================================== */

  function renderArchive(){

    $("archiveCount")
      .textContent =
      String(
        archive.length
      );


    const el =
      $("archiveGrid");


    if(
      !archive.length
    ){

      el.innerHTML =
        '<div class="empty">No saved snapshots.</div>';

      return;

    }


    el.innerHTML =
      archive
        .slice(
          0,
          30
        )
        .map(
          a =>
            `
            <article class="archive-item">

              <img
                src="${a.image}"
                alt=""
              >

              <div>

                <strong>
                  ${escapeHTML(
                    typeName(
                      a.type
                    )
                  )}
                </strong>

                <small>
                  ${escapeHTML(
                    a.time
                  )}
                  ·
                  ${Math.round(
                    a.score * 100
                  )}%
                </small>

              </div>

            </article>
            `
        )
        .join("");

  }


  /* =========================================================
     SETTINGS
  ========================================================== */

  function loadCameraSettingsUI(){

    $("soundToggle")
      .checked =
      soundEnabled;


    $("vibrationToggle")
      .checked =
      vibrationEnabled;


    $("snapshotToggle")
      .checked =
      snapshotsEnabled;


    $("confidenceSelect")
      .value =
      String(
        detectionThreshold
      );

    if($("alertProfileSelect"))$("alertProfileSelect").value=alertProfile;
    if($("alertObjectSelect"))$("alertObjectSelect").value=alertObjectFilter;
    if($("dwellSelect"))$("dwellSelect").value=String(dwellSeconds);

  }


  /* =========================================================
     UI EVENTS
  ========================================================== */

  $("brandHome")
    .addEventListener(
      "click",
      showHome
    );


  $("cameraRoleBtn")
    .addEventListener(
      "click",
      showCamera
    );


  $("viewerRoleBtn")
    .addEventListener(
      "click",
      () =>
        showViewer(
          $("manualPeerId").value
        )
    );


  $("cameraBackBtn")
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
      e => {

        zone.enabled =
          e.target.checked;


        saveJSON(
          "ghost-zone",
          zone
        );


        loadZoneUI();


        sendDetectionState();

      }
    );


  $("copyPeerBtn")
    .addEventListener(
      "click",
      async () => {

        try{

          await navigator.clipboard
            .writeText(
              peerId
            );


          $("copyPeerBtn")
            .textContent =
            "Copied ✓";


          setTimeout(
            () =>
              $("copyPeerBtn")
                .textContent =
                "Copy code",

            1400
          );

        }catch{

          toast(
            `Camera code: ${peerId}`
          );

        }

      }
    );


  $("manualConnectBtn")
    .addEventListener(
      "click",
      () =>
        connectViewer(
          $("manualPeerId")
            .value
        )
    );


  $("manualPeerId")
    .addEventListener(
      "keydown",
      e => {

        if(
          e.key ===
          "Enter"
        ){

          connectViewer(
            $("manualPeerId")
              .value
          );

        }

      }
    );


  $("viewerReconnectBtn")
    .addEventListener(
      "click",
      () =>
        connectViewer(
          $("manualPeerId")
            .value
        )
    );


  $("cameraSetupStart")?.addEventListener("click", () => {
    startMonitoring();
  });

  $("cameraSetupBack")?.addEventListener("click", () => {
    showHome();
  });

  $("pairViewerBtn")?.addEventListener("click", () => {
    openQRSheet();
  });

  $("viewerConnectFocusBtn")?.addEventListener("click", () => {
    $("manualPeerId")?.focus();
    $("viewerPage")?.classList.add("connected-viewer");
    document.querySelectorAll(".nav-button").forEach(b => b.classList.remove("active"));
  });

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
      e => {

        viewerZone.enabled =
          e.target.checked;


        $("viewerZoneStatus")
          .textContent =
          viewerZone.enabled
            ? "Active · crossings tracked"
            : "Disabled";


        sendPeer(
          {
            kind:
              "set-zone-enabled",

            enabled:
              viewerZone.enabled
          }
        );

      }
    );


  $("viewerFullscreenBtn")
    .addEventListener(
      "click",
      () => {

        const target =
          $("viewerStage");


        if(
          document.fullscreenElement
        ){

          document
            .exitFullscreen?.();

        }else{

          target
            .requestFullscreen?.()
            .catch(
              () => {}
            );

        }

      }
    );


  $("settingsBtn")
    .addEventListener(
      "click",
      () =>
        document
          .querySelector(
            '.nav-button[data-tab="settings"]'
          )
          .click()
    );


  /* =========================================================
     SETTINGS EVENTS
  ========================================================== */

  $("soundToggle")
    .addEventListener(
      "change",
      e => {

        soundEnabled =
          e.target.checked;


        localStorage.setItem(
          "ghost-sound",
          soundEnabled
            ? "1"
            : "0"
        );

      }
    );


  $("vibrationToggle")
    .addEventListener(
      "change",
      e => {

        vibrationEnabled =
          e.target.checked;


        localStorage.setItem(
          "ghost-vibration",
          vibrationEnabled
            ? "1"
            : "0"
        );

      }
    );


  $("snapshotToggle")
    .addEventListener(
      "change",
      e => {

        snapshotsEnabled =
          e.target.checked;


        localStorage.setItem(
          "ghost-snapshots",
          snapshotsEnabled
            ? "1"
            : "0"
        );

      }
    );


  $("confidenceSelect")
    .addEventListener(
      "change",
      e => {

        detectionThreshold =
          Number(
            e.target.value
          );


        localStorage.setItem(
          "ghost-confidence",
          String(
            detectionThreshold
          )
        );


        toast(
          `Detection confidence: ${Math.round(
            detectionThreshold * 100
          )}%`
        );

      }
    );


  $("alertProfileSelect")?.addEventListener("change",e=>{alertProfile=e.target.value;localStorage.setItem("ghost-alert-profile",alertProfile);});
  $("alertObjectSelect")?.addEventListener("change",e=>{alertObjectFilter=e.target.value;localStorage.setItem("ghost-alert-object",alertObjectFilter);});
  $("dwellSelect")?.addEventListener("change",e=>{dwellSeconds=Number(e.target.value)||15;localStorage.setItem("ghost-dwell-seconds",String(dwellSeconds));});

  /* =========================================================
     NAV
  ========================================================== */

  document
    .querySelectorAll(
      ".nav-button"
    )
    .forEach(
      btn => {

        btn.addEventListener(
          "click",
          () => {

            document
              .querySelectorAll(
                ".nav-button"
              )
              .forEach(
                b =>
                  b.classList
                    .remove(
                      "active"
                    )
              );


            btn.classList
              .add(
                "active"
              );


            const tab =
              btn.dataset.tab;


            $("cameraPage")
              .classList
              .toggle(
                "hidden",
                tab !==
                "monitor"
              );


            $("archiveTab")
              .classList
              .toggle(
                "hidden",
                tab !==
                "archive"
              );


            $("settingsTab")
              .classList
              .toggle(
                "hidden",
                tab !==
                "settings"
              );

          }
        );

      }
    );


  /* =========================================================
     ARCHIVE ACTIONS
  ========================================================== */

  $("clearArchive")
    .addEventListener(
      "click",
      () => {

        archive =
          [];

        idbClear();

        saveJSON(
          "ghost-archive",
          archive
        );


        renderArchive();


        toast(
          "Archive cleared"
        );

      }
    );


  $("saveSession")
    .addEventListener(
      "click",
      () => {

        const html =
          `
          <!doctype html>

          <html>

          <head>

            <meta charset="utf-8">

            <title>
              GHOST Session
            </title>

            <style>

              body{
                font-family:Arial,sans-serif;
                background:#09080f;
                color:#fff;
                padding:30px;
              }

              main{
                display:grid;
                grid-template-columns:
                  repeat(
                    auto-fill,
                    minmax(
                      220px,
                      1fr
                    )
                  );
                gap:14px;
              }

              article{
                background:#171521;
                border-radius:16px;
                overflow:hidden;
              }

              img{
                width:100%;
                display:block;
              }

              p{
                padding:
                  0
                  12px
                  12px;
              }

            </style>

          </head>

          <body>

            <h1>
              GHOST Session
            </h1>

            <p>
              Exported
              ${escapeHTML(
                new Date()
                  .toLocaleString()
              )}
            </p>

            <main>

              ${
                archive
                  .map(
                    a =>
                      `
                      <article>

                        <img
                          src="${a.image}"
                          alt=""
                        >

                        <p>

                          <b>
                            ${escapeHTML(
                              typeName(
                                a.type
                              )
                            )}
                          </b>

                          ·

                          ${Math.round(
                            a.score * 100
                          )}%

                          ·

                          ${escapeHTML(
                            a.time
                          )}

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
          1000
        );

      }
    );


  function renderFilteredArchive(){const list=archive.filter(a=>{if(proArchiveFilter==="all")return true;if(proArchiveFilter==="motion")return /motion|moved|movement/i.test(a.action||"");if(proArchiveFilter==="zone")return /zone|loiter/i.test(a.action||"");return a.type===proArchiveFilter;});const el=$("archiveGrid");if(!el)return;if(!list.length){el.innerHTML='<div class="empty">No events in this filter.</div>';return;}el.innerHTML=list.slice(0,40).map(a=>`<article class="archive-item"><img src="${a.image||a.preview||""}" alt=""><div><strong>${escapeHTML(typeName(a.type))}</strong><small>${escapeHTML(a.time||"")} · ${Math.round((a.score||0)*100)}%</small><div class="archive-action">${escapeHTML(a.action||"detected")}</div></div></article>`).join("");}
  function openQRSheet(){const s=$("qrSheet"),t=$("qrSheetCode");if(!s||!t||!peerId)return;t.innerHTML="";if(window.QRCode){const u=new URL(location.href);u.search="";u.hash="";u.searchParams.set("mode","viewer");u.searchParams.set("camera",peerId);new QRCode(t,{text:u.toString(),width:206,height:206,colorDark:"#09080f",colorLight:"#fff",correctLevel:QRCode.CorrectLevel.M});}$("qrSheetPeerText").textContent=peerId;s.classList.remove("hidden");}
  $("showQRBtn")?.addEventListener("click",openQRSheet);$("qrSheetClose")?.addEventListener("click",()=>$("qrSheet").classList.add("hidden"));$("qrSheet")?.addEventListener("click",e=>{if(e.target===$("qrSheet"))$("qrSheet").classList.add("hidden");});
  document.querySelectorAll("[data-event-filter]").forEach(b=>b.addEventListener("click",()=>{proArchiveFilter=b.dataset.eventFilter||"all";document.querySelectorAll("[data-event-filter]").forEach(x=>x.classList.toggle("active",x===b));renderFilteredArchive();}));
  window.addEventListener("online",()=>{if($("healthNetwork"))$("healthNetwork").textContent="ONLINE";});window.addEventListener("offline",()=>{if($("healthNetwork"))$("healthNetwork").textContent="OFFLINE";});
  document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible"&&running&&navigator.wakeLock?.request)navigator.wakeLock.request("screen").then(x=>proWakeLock=x).catch(()=>{});});

  /* =========================================================
     INITIALIZATION
  ========================================================== */

  window.addEventListener(
    "resize",
    () => {

      if(role === "camera"){

        resizeCameraCanvas();
        positionZoneHandles();

        if(running){

          drawDetections(
            lastDetectionState
          );
        }
      }

      if(role === "viewer"){

        resizeViewerCanvas();
        positionZoneHandles();

        drawViewerState(
          viewerTracks,
          viewerZone
        );
      }
    }
  );


  window.addEventListener(
    "orientationchange",
    () => {

      setTimeout(
        () =>
          window.dispatchEvent(
            new Event(
              "resize"
            )
          ),
        160
      );
    }
  );


  initZoneDrag();

  initViewerZoneDrag();

  renderArchive();
  renderActivityGraph();
  hydrateArchive().then(renderFilteredArchive).catch(()=>{});

  loadCameraSettingsUI();



  if(/iphone|ipad|ipod/i.test(navigator.userAgent) && !navigator.standalone){setTimeout(()=>$("installHint")?.classList.remove("hidden"),3000);}
  $("installHintClose")?.addEventListener("click",()=>$("installHint").classList.add("hidden"));

  /* =========================================================
     QR AUTO-VIEWER
  ========================================================== */

  const params =
    new URLSearchParams(
      location.search
    );


  if(
    params.get(
      "mode"
    ) ===
    "viewer"
  ){

    showViewer(
      params.get(
        "camera"
      ) || ""
    );

  }else{

    showHome();

  }

})();