/* GHOST — Smart Camera prototype
   Local AI + WebRTC/PeerJS viewer mode.
   Camera and AI stay in the browser. Video is shared only after a viewer connects.
*/
(() => {
  "use strict";

  const $ = id => document.getElementById(id);
  const clamp = (n,min,max) => Math.max(min,Math.min(max,n));
  const nowTime = () => new Date().toLocaleTimeString([],{
    hour:"2-digit",
    minute:"2-digit",
    second:"2-digit"
  });
  const uid = () => Math.random().toString(36).slice(2,8);

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

  let archive =
    loadJSON(
      "ghost-archive",
      []
    );

  let zone =
    loadJSON(
      "ghost-zone",
      null
    ) || {
      enabled:false,
      name:"Detection zone",
      points:[
        {x:.12,y:.18},
        {x:.88,y:.18},
        {x:.88,y:.82},
        {x:.12,y:.82}
      ]
    };

  let zoneEditing = false;

  let viewerZone = {
    ...zone,
    points:
      zone.points.map(
        p => ({...p})
      )
  };

  let viewerZoneEditing = false;

  let tracks = [];
  let nextTrackId = 1;

  let uniqueClasses = new Set();
  let uniqueObjectIds = new Set();
  let movedTrackIds = new Set();
  let movedCount = 0;
  let zoneEntries = 0;

  let events = [];
  let viewerEvents = 0;

  /*
    IMPORTANT FIX #2:
    Keep the AI tracks received by the Viewer in a dedicated state.
    Previously the animation loop could overwrite them with the
    Camera's local state and the boxes disappeared.
  */
  let viewerTracks = [];

  let lastDetectionState = [];
  let lastEventAt = 0;
  let audioContext = null;
  let viewerRAF = 0;

  const video = $("video");
  const canvas = $("canvas");
  const ctx = canvas.getContext("2d");

  const remoteVideo = $("remoteVideo");
  const viewerCanvas = $("viewerCanvas");
  const viewerCtx = viewerCanvas.getContext("2d");


  function loadJSON(key,fallback){
    try{
      return JSON.parse(
        localStorage.getItem(key)
      ) ?? fallback;
    }catch{
      return fallback;
    }
  }


  function saveJSON(key,value){
    try{
      localStorage.setItem(
        key,
        JSON.stringify(value)
      );
    }catch(error){
      console.warn(
        "Storage error",
        error
      );
    }
  }


  function toast(message){
    const el = $("toast");

    el.textContent = message;

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
      state || "ready"
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

    return h
      ? `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`
      : `${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
  }


  function typeName(type){
    return ({
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
    })[type] ||
      type
        .replaceAll("_"," ")
        .replace(
          /\b\w/g,
          c =>
            c.toUpperCase()
        );
  }


  function iconFor(type){
    return ({
      person:"●",
      car:"▣",
      truck:"▤",
      bus:"▤",
      bicycle:"◌",
      motorcycle:"◉",
      dog:"◆",
      cat:"◇",
      bird:"◈"
    })[type] || "✦";
  }


  function escapeHTML(value){
    return String(value).replace(
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


  function showHome(){

    stopMonitoring();
    closePeer();

    role = "";

    $("roleChooser")
      .classList
      .remove("hidden");

    $("cameraPage")
      .classList
      .add("hidden");

    $("viewerPage")
      .classList
      .add("hidden");

    $("bottomNav")
      .classList
      .add("hidden");

    $("archiveTab")
      .classList
      .add("hidden");

    $("settingsTab")
      .classList
      .add("hidden");

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
      .add("hidden");

    $("viewerPage")
      .classList
      .add("hidden");

    $("cameraPage")
      .classList
      .remove("hidden");

    $("bottomNav")
      .classList
      .remove("hidden");

    loadCameraSettingsUI();
    loadZoneUI();

    if(!peer){
      startPeerCamera();
    }
  }


  function showViewer(initialId=""){

    role =
      "viewer";

    $("roleChooser")
      .classList
      .add("hidden");

    $("cameraPage")
      .classList
      .add("hidden");

    $("bottomNav")
      .classList
      .add("hidden");

    $("archiveTab")
      .classList
      .add("hidden");

    $("settingsTab")
      .classList
      .add("hidden");

    $("viewerPage")
      .classList
      .remove("hidden");

    if(initialId){

      $("manualPeerId")
        .value =
        initialId;

      connectViewer(
        initialId
      );
    }
  }


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

      if(!stream){

        stream =
          await navigator.mediaDevices
            .getUserMedia({
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
        .add("hidden");

      $("recText")
        .textContent =
        "LIVE";

      $("recDot")
        .parentElement
        .classList
        .add("live");

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

      if(!model){

        toast(
          "Loading AI model…"
        );

        model =
          await cocoSsd.load({
            base:"mobilenet_v2"
          });
      }

      toast(
        "GHOST is watching"
      );

      /*
        If Viewer connected before Camera started,
        send its stream now.
      */

      if(viewerConn?.open){

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
      .remove("hidden");

    $("recText")
      .textContent =
      "OFFLINE";

    $("recDot")
      .parentElement
      .classList
      .remove("live");

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

    sendPeer({
      kind:"state",
      tracks:[],
      zone,
      stats:statsPayload()
    });
  }


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


  function centerOf(bbox){
    return {
      x:
        bbox[0] +
        bbox[2] / 2,

      y:
        bbox[1] +
        bbox[3] / 2
    };
  }


  function distance(a,b){
    return Math.hypot(
      a.x - b.x,
      a.y - b.y
    );
  }


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

          id:null,
          inside:false,
          moved:false
        })
      );

    const maxMatch =
      Math.max(
        canvas.width,
        canvas.height
      ) * .12;

    const used =
      new Set();

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
              ) ||
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

          tracks.push({
            id:
              obj.id,

            class:
              obj.class,

            center:
              obj.center,

            lastSeen:
              Date.now(),

            inside:false
          });
        }

        obj.inside =
          pointInside(
            obj.center,
            zonePolygonPixels()
          );
      }
    );


    const prevById =
      new Map(
        tracks.map(
          t =>
            [
              t.id,
              t
            ]
        )
      );


    current.forEach(
      obj => {

        const prev =
          prevById.get(
            obj.id
          );

        if(
          prev &&
          zone.enabled &&
          obj.inside &&
          !prev.inside
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


    tracks =
      tracks.filter(
        t =>
          Date.now() -
          t.lastSeen <
          1800
      );


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
          `${typeName(
            o.class
          )} ${Math.round(
            o.score * 100
          )}%`;

        ctx.font =
          `${Math.max(
            12,
            canvas.width / 75
          )}px -apple-system,BlinkMacSystemFont,sans-serif`;

        const tw =
          ctx.measureText(
            label
          ).width +
          14;

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


  function drawZone(
    context,
    w,
    h,
    z,
    editing=false
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

        image:null,

        preview:null
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


    /*
      IMPORTANT FIX #2:
      Send the small preview to the Viewer.
      Full-resolution image stays local only.
    */

    sendPeer({
      kind:"event",
      event:{
        ...event,
        image:null,
        preview:
          event.preview ||
          null
      }
    });
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


  function alertFeedback(){

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
          audioContext
            .createOscillator();

        const gain =
          audioContext
            .createGain();

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
      }
    }


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


    /*
      Full-resolution local archive image.
    */

    event.image =
      c.toDataURL(
        "image/jpeg",
        .72
      );


    /*
      Small network preview.
      This prevents large base64 payloads over the
      WebRTC data channel.
    */

    const maxWidth =
      480;

    const scale =
      Math.min(
        1,
        maxWidth /
          c.width
      );

    const preview =
      document.createElement(
        "canvas"
      );

    preview.width =
      Math.max(
        1,
        Math.round(
          c.width *
          scale
        )
      );

    preview.height =
      Math.max(
        1,
        Math.round(
          c.height *
          scale
        )
      );

    const pctx =
      preview.getContext(
        "2d"
      );

    pctx.drawImage(
      c,
      0,
      0,
      preview.width,
      preview.height
    );

    event.preview =
      preview.toDataURL(
        "image/jpeg",
        .58
      );


    archive.unshift({
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
    });

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


  function sendDetectionState(
    items=lastDetectionState
  ){

    sendPeer({
      kind:"state",

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
    });
  }


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


  function initZoneDrag(){

    document
      .querySelectorAll(
        "#zoneEditor .zone-handle"
      )
      .forEach(
        handle =>
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

                  sendPeer({
                    kind:"zone",
                    zone
                  });
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
          )
      );
  }


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

      await track.applyConstraints({
        advanced:[
          {
            zoom:
              num
          }
        ]
      });

    }catch{
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


  function makePeerId(){

    return `ghost-${Math.random()
      .toString(36)
      .slice(2,6)}`;
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


  function startPeerCamera(){

    if(
      peer ||
      role !== "camera"
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
      e => {

        console.warn(
          "PeerJS camera",
          e
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

        conn.send({
          kind:"hello",
          name:
            $("cameraTitle")
              .textContent
        });

        sendDetectionState();

        conn.send({
          kind:"zone",
          zone
        });

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
        )
          return;

        if(
          data.kind ===
          "request-stream" &&
          stream
        ){

          callViewer(
            conn.peer
          );
        }

        if(
          data.kind ===
          "request-state"
        ){

          sendDetectionState();
        }

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
                  .slice(
                    0,
                    4
                  )
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


  function callViewer(
    id
  ){

    if(
      !peer ||
      !stream ||
      !id
    )
      return;

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


  function closePeer(){

    if(peer){

      try{
        peer.destroy();
      }catch{
      }
    }

    peer =
      null;

    peerId =
      "";

    viewerConn =
      null;
  }


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


  /*
    IMPORTANT FIX #1:
    Render QR in a larger source resolution and let CSS
    scale it down into the padded QR box.
  */

  function renderQR(id){

    $("qrCode")
      .innerHTML =
      "";

    if(!window.QRCode)
      return;

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
          220,

        height:
          220,

        colorDark:
          "#09080f",

        colorLight:
          "#ffffff",

        correctLevel:
          QRCode.CorrectLevel.M
      }
    );
  }


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
      }

      peer =
        null;
    }


    /*
      Clear stale remote tracks before a new connection.
    */

    viewerTracks =
      [];

    lastDetectionState =
      [];


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


    peer.on(
      "open",
      () => {

        const conn =
          peer.connect(
            id,
            {
              reliable:true,
              serialization:"json"
            }
          );

        setupViewerConnection(
          conn
        );
      }
    );


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
          e => {

            console.warn(
              "Media call",
              e
            );

            viewerConnectionError(
              "Media connection failed."
            );
          }
        );
      }
    );


    peer.on(
      "error",
      e => {

        console.warn(
          "PeerJS viewer",
          e
        );

        viewerConnectionError(
          peerErrorText(e)
        );
      }
    );
  }


  function peerErrorText(e){

    if(
      e?.type ===
      "peer-unavailable"
    ){

      return(
        "Camera code was not found or is offline."
      );
    }

    if(
      e?.type ===
      "network"
    ){

      return(
        "Network connection to the signaling service failed."
      );
    }

    if(
      e?.type ===
      "webrtc"
    ){

      return(
        "WebRTC could not establish the video connection."
      );
    }

    return(
      "Could not connect to the camera. Check the code and Wi-Fi."
    );
  }


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


  function setupViewerConnection(
    conn
  ){

    viewerConn =
      conn;

    /*
      Reset remote detection state for this connection.
    */

    viewerTracks =
      [];


    conn.on(
      "open",
      () => {

        $("viewerState")
          .textContent =
          "CONNECTED";

        conn.send({
          kind:
            "request-stream"
        });

        conn.send({
          kind:
            "request-state"
        });

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
        )
          return;


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

          /*
            IMPORTANT FIX #2:
            Preserve remote tracks for the animation loop.
          */

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
            viewerTracks,
            data.zone,
            data.stats
          );
        }
      }
    );


    conn.on(
      "close",
      () => {

        viewerTracks =
          [];

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

        drawViewerState(
          [],
          viewerZone
        );
      }
    );


    conn.on(
      "error",
      e =>
        console.warn(e)
    );
  }


  function applyViewerZone(z){

    if(!z)
      return;

    viewerZone =
      {
        ...z,

        points:
          (
            z.points ||
            viewerZone.points
          ).map(
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


  /*
    IMPORTANT FIX #2:
    Always redraw the stored remote tracks.
  */

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


  function drawViewerState(
    tracksArg=viewerTracks,
    zoneArg=viewerZone
  ){

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
          [0,0,0,0];

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
            (o.score || 0) *
            100
          )}%`;

        viewerCtx.font =
          `${Math.max(
            12,
            viewerCanvas.width / 75
          )}px -apple-system,BlinkMacSystemFont,sans-serif`;

        const tw =
          viewerCtx.measureText(
            label
          ).width +
          14;

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


  /*
    IMPORTANT FIX #2:
    Remote Viewer event log now displays the event photo preview.
  */

  function addViewerEvent(e){

    if(!e)
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


    const photo =
      e.preview ||
      "";


    el.insertAdjacentHTML(
      "afterbegin",

      `
      <div class="event-row viewer-event-row">

        <div class="event-time">
          ${escapeHTML(
            e.time ||
            nowTime()
          )}
        </div>

        <div class="event-icon">
          ${iconFor(e.type)}
        </div>

        <div>

          <div class="event-main">
            ${escapeHTML(
              typeName(
                e.type
              )
            )}
            ·
            ${escapeHTML(
              e.action ||
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
                  loading="lazy"
                >
              `
              : ""
          }

        </div>

      </div>
      `
    );
  }


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
        handle =>
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

                  sendPeer({
                    kind:
                      "set-zone",

                    zone:
                      viewerZone
                  });
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
          )
      );
  }


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
          $("manualPeerId")
            .value
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

        sendPeer({
          kind:
            "set-zone-enabled",

          enabled:
            viewerZone.enabled
        });
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


  document
    .querySelectorAll(
      ".nav-button"
    )
    .forEach(
      btn =>
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
        )
    );


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


  initZoneDrag();
  initViewerZoneDrag();
  renderArchive();
  loadCameraSettingsUI();


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