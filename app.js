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

  let lastDetectionState = [];

  let lastEventAt = 0;


  /* AUDIO */

  let audioContext = null;


  /* VIEWER DRAW LOOP */

  let viewerRAF = 0;


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

    stopMonitoring();

    closePeer();

    role = "";

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


  function showCamera(){

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


      running =
        true;


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


  function resizeCameraCanvas(){

    const w =
      video.videoWidth ||
      1080;

    const h =
      video.videoHeight ||
      1920;


    if(
      canvas.width !== w ||
      canvas.height !== h
    ){

      canvas.width =
        w;

      canvas.height =
        h;

    }

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

  }


  /* =========================================================
     DRAW DETECTIONS
  ========================================================== */

  function drawDetections(
    items
  ){

    ctx.clearRect(
      0,
      0,
      canvas.width,
      canvas.height
    );


    ctx.lineWidth =
      Math.max(
        2,
        canvas.width / 500
      );


    items.forEach(
      o => {

        const [
          x,
          y,
          w,
          h
        ] =
          o.bbox;


        ctx.strokeStyle =
          o.inside &&
          zone.enabled

            ? "#b38cff"

            : "rgba(179,140,255,.9)";


        ctx.strokeRect(
          x,
          y,
          w,
          h
        );


        const label =
          `${typeName(o.class)} ${Math.round(o.score * 100)}%`;


        ctx.font =
          `${Math.max(
            12,
            canvas.width / 75
          )}px -apple-system,BlinkMacSystemFont,sans-serif`;


        const tw =
          ctx.measureText(
            label
          ).width + 14;


        ctx.fillStyle =
          "rgba(9,8,15,.86)";


        ctx.fillRect(
          x,
          Math.max(
            0,
            y - 27
          ),
          tw,
          24
        );


        ctx.fillStyle =
          "#efe8ff";


        ctx.fillText(
          label,
          x + 7,
          Math.max(
            16,
            y - 10
          )
        );

      }
    );


    drawZone(
      ctx,
      canvas.width,
      canvas.height,
      zone,
      zoneEditing
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


    alertFeedback();


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
            image:null
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
                ${iconFor(e.type)}
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

  function alertFeedback(){

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
          720;


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
          event.image
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
      .toggle(
        "hidden",
        !zone.enabled ||
        zoneEditing
      );


    $("zoneEditor")
      .classList
      .toggle(
        "hidden",
        !zoneEditing
      );

  }


  function positionZoneHandles(){

    document
      .querySelectorAll(
        "#zoneEditor .zone-handle"
      )
      .forEach(
        h => {

          const p =
            zone.points[
              Number(
                h.dataset.corner
              )
            ];


          h.style.left =
            `${p.x * 100}%`;


          h.style.top =
            `${p.y * 100}%`;

        }
      );


    document
      .querySelectorAll(
        "#viewerZoneEditor .zone-handle"
      )
      .forEach(
        h => {

          const p =
            viewerZone.points[
              Number(
                h.dataset.corner
              )
            ];


          h.style.left =
            `${p.x * 100}%`;


          h.style.top =
            `${p.y * 100}%`;

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

                  const r =
                    $("cameraStage")
                      .getBoundingClientRect();


                  zone.points[
                    Number(
                      handle.dataset.corner
                    )
                  ] =
                    {
                      x:
                        clamp(
                          (
                            ev.clientX -
                            r.left
                          ) /
                          r.width,
                          .02,
                          .98
                        ),

                      y:
                        clamp(
                          (
                            ev.clientY -
                            r.top
                          ) /
                          r.height,
                          .02,
                          .98
                        )
                    };


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
          "state"
        ){

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
      .toggle(
        "hidden",
        !viewerZone.enabled ||
        viewerZoneEditing
      );

  }


  /* =========================================================
     VIEWER CANVAS
  ========================================================== */

  function resizeViewerCanvas(){

    const w =
      remoteVideo.videoWidth ||
      1080;


    const h =
      remoteVideo.videoHeight ||
      1920;


    if(
      viewerCanvas.width !== w ||
      viewerCanvas.height !== h
    ){

      viewerCanvas.width =
        w;

      viewerCanvas.height =
        h;

    }

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

          resizeViewerCanvas();

          drawViewerState();

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
    tracksArg = [],
    zoneArg = viewerZone
  ){

    resizeViewerCanvas();


    const items =
      tracksArg.length
        ? tracksArg
        : lastDetectionState;


    const z =
      zoneArg ||
      viewerZone;


    viewerCtx.clearRect(
      0,
      0,
      viewerCanvas.width,
      viewerCanvas.height
    );


    viewerCtx.lineWidth =
      Math.max(
        2,
        viewerCanvas.width / 500
      );


    items.forEach(
      o => {

        const [
          x,
          y,
          w,
          h
        ] =
          o.bbox ||
          [
            0,
            0,
            0,
            0
          ];


        viewerCtx.strokeStyle =
          "#b38cff";


        viewerCtx.strokeRect(
          x,
          y,
          w,
          h
        );


        const label =
          `${typeName(
            o.class
          )} ${Math.round(
            (o.score || 0) * 100
          )}%`;


        viewerCtx.font =
          `${Math.max(
            12,
            viewerCanvas.width / 75
          )}px -apple-system,BlinkMacSystemFont,sans-serif`;


        const tw =
          viewerCtx.measureText(
            label
          ).width + 14;


        viewerCtx.fillStyle =
          "rgba(9,8,15,.86)";


        viewerCtx.fillRect(
          x,
          Math.max(
            0,
            y - 27
          ),
          tw,
          24
        );


        viewerCtx.fillStyle =
          "#efe8ff";


        viewerCtx.fillText(
          label,
          x + 7,
          Math.max(
            16,
            y - 10
          )
        );

      }
    );


    drawZone(
      viewerCtx,
      viewerCanvas.width,
      viewerCanvas.height,
      z,
      viewerZoneEditing
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


    el.insertAdjacentHTML(
      "afterbegin",

      `
      <div class="event-row">

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
      .toggle(
        "hidden",
        !viewerZone.enabled ||
        viewerZoneEditing
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

                  const r =
                    $("viewerStage")
                      .getBoundingClientRect();


                  viewerZone.points[
                    Number(
                      handle.dataset.corner
                    )
                  ] =
                    {
                      x:
                        clamp(
                          (
                            ev.clientX -
                            r.left
                          ) /
                          r.width,
                          .02,
                          .98
                        ),

                      y:
                        clamp(
                          (
                            ev.clientY -
                            r.top
                          ) /
                          r.height,
                          .02,
                          .98
                        )
                    };


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


  /* =========================================================
     INITIALIZATION
  ========================================================== */

  initZoneDrag();

  initViewerZoneDrag();

  renderArchive();

  loadCameraSettingsUI();


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