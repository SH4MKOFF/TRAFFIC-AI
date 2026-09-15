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

  let cameraVideoFrames = 0;
  let cameraVideoFps = 0;
  let cameraAiFps = 0;
  let cameraAiFrameCount = 0;
  let cameraAiFpsWindowStarted = Date.now();
  let cameraLastResolution = "—";
  let healthTimer = null;
  let viewerLastStatsAt = 0;



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

  function cameraErrorMessage(error){
    const name=error?.name || "UnknownError";
    if(name === "NotAllowedError" || name === "PermissionDeniedError") return "Camera permission denied. Allow Camera access for GHOST in Safari/iOS Settings.";
    if(name === "NotFoundError" || name === "DevicesNotFoundError") return "No usable camera was found on this device.";
    if(name === "NotReadableError" || name === "TrackStartError") return "Camera is busy or unavailable. Close other apps/tabs using the camera and try again.";
    if(name === "OverconstrainedError") return "The requested camera mode is not supported by this device. Retrying with automatic camera settings.";
    if(name === "SecurityError") return "Camera access is blocked by the browser. Open GHOST from HTTPS and allow Camera access.";
    if(name === "AbortError") return "Camera startup was interrupted. Try again.";
    if(name === "TypeError") return "Camera API is unavailable in this browser/context.";
    return error?.message || "Could not start the camera.";
  }

  async function waitForVideoMetadata(mediaEl, timeoutMs=2500){
    if(!mediaEl) return false;
    if(mediaEl.videoWidth>0 && mediaEl.videoHeight>0) return true;
    return await new Promise(resolve=>{
      let done=false;
      const finish=ok=>{
        if(done)return;
        done=true;
        clearTimeout(timer);
        mediaEl.removeEventListener("loadedmetadata",onMeta);
        resolve(ok);
      };
      const onMeta=()=>finish(true);
      const timer=setTimeout(()=>finish(Boolean(mediaEl.videoWidth>0 && mediaEl.videoHeight>0)),timeoutMs);
      mediaEl.addEventListener("loadedmetadata",onMeta,{once:true});
    });
  }

  async function acquireCameraStream(){
    if(!navigator.mediaDevices?.getUserMedia){
      throw new DOMException("Camera API unavailable. Open GHOST over HTTPS.", "TypeError");
    }

    /*
      iPhone/Safari is much happier when we do NOT force a portrait
      resolution or an aspect ratio. We ask for an environment camera
      and let the device choose its native mode, then fall back to
      progressively simpler constraints.
    */
    const attempts=[
      {video:{facingMode:{ideal:"environment"}},audio:false},
      {video:{facingMode:"environment"},audio:false},
      {video:{width:{ideal:1280},height:{ideal:720}},audio:false},
      {video:true,audio:false}
    ];

    let lastError=null;
    for(const constraints of attempts){
      try{
        const candidate=await navigator.mediaDevices.getUserMedia(constraints);
        const track=candidate.getVideoTracks?.()[0];
        if(track){
          /* Do not reject a valid iOS track just because readyState updates a tick later. */
          if(track.readyState!=="live") await new Promise(r=>setTimeout(r,120));
          if(track.readyState==="live") return candidate;
          candidate.getTracks?.().forEach(t=>t.stop?.());
        }
        lastError=new DOMException("Camera track did not become live.","NotReadableError");
      }catch(error){
        lastError=error;
        console.warn("GHOST camera attempt failed",constraints,error?.name,error?.message);
      }
    }
    throw lastError || new DOMException("Could not start camera.","NotReadableError");
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


      /* CAMERA ONLY — keep camera startup independent from AI/network loading */
      if(!stream){
        try{
          stream=await acquireCameraStream();
        }catch(cameraError){
          console.error("GHOST camera startup failed", cameraError);
          setGlobalStatus("alert","CAMERA ERROR",cameraErrorMessage(cameraError));
          toast(cameraErrorMessage(cameraError));
          return;
        }
      }

      video.srcObject=stream;
      video.setAttribute("playsinline","");
      video.muted=true;

      await video.play().catch(playError => {
        console.warn("GHOST video.play warning", playError);
      });

      await waitForVideoMetadata(video, 2500);
      syncCameraStageForOrientation();
      resizeCameraCanvas();
      positionZoneHandles();
      setCameraSetupVisible(false);

      // Start a fresh tracking session without carrying old IDs/motion flags forward.
      tracks=[];
      nextTrackId=1;
      uniqueClasses.clear();
      uniqueObjectIds.clear();
      movedTrackIds.clear();
      movedCount=0;
      zoneEntries=0;
      lastDetectionState=[];
      lastEventAt=0;
      eventActionCooldowns.clear();

      running=true;

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


      /* AI — a model/network failure must NOT turn into a camera error */
      try{
        if(!model){
          toast("Loading AI model…");
          if(!window.cocoSsd || typeof cocoSsd.load !== "function") throw new Error("AI library is unavailable.");
          model=await cocoSsd.load({base:"mobilenet_v2"});
        }
      }catch(aiError){
        console.error("GHOST AI startup failed", aiError);
        setGlobalStatus("live","LIVE","Camera active • AI unavailable");
        toast("Camera is live, but AI could not load. Check internet and reload GHOST to retry.");
        updateCameraFrameMetrics();
        updateProHealth();
        return;
      }

      toast("GHOST is watching");


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

      if(running){
        stopMonitoring();
      }


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

    /* Hard stop: stop every track owned by the camera session, detach the
       media element, pause playback, and force the browser to release the
       capture device. This is intentionally idempotent. */
    running = false;
    detecting = false;

    try{proWakeLock?.release?.();}catch{}
    proWakeLock=null;
    proZoneState.clear();

    clearTimeout(detectTimer);
    clearInterval(sessionTimer);
    sessionTimer=null;

    const activeStream = stream;
    stream = null;
    if(activeStream){
      try{ activeStream.getTracks().forEach(track=>{ try{ track.stop(); }catch{} }); }catch{}
    }
    try{
      video.pause?.();
      video.srcObject = null;
      video.removeAttribute("src");
      video.load?.();
    }catch{}



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

  function getMediaSourceSize(mediaEl, mediaStream){
    const w = Number(mediaEl?.videoWidth || 0);
    const h = Number(mediaEl?.videoHeight || 0);
    if(w > 0 && h > 0) return { width:w, height:h };
    try{
      const settings = mediaStream?.getVideoTracks?.()[0]?.getSettings?.();
      if(Number(settings?.width) > 0 && Number(settings?.height) > 0){
        return { width:Number(settings.width), height:Number(settings.height) };
      }
    }catch{}
    return { width:1280, height:720 };
  }

  function mediaSizeLabel(mediaEl, mediaStream){
    const size = getMediaSourceSize(mediaEl, mediaStream);
    return `${size.width}×${size.height}`;
  }

  function getLiveSessionLabel(startedAt){
    return startedAt ? formatDuration((Date.now()-startedAt)/1000) : "INACTIVE";
  }

  function updateStageAspect(mediaEl, stageEl){
    if(!mediaEl || !stageEl) return;
    const size=getMediaSourceSize(mediaEl, mediaEl.srcObject);
    if(!size.width || !size.height) return;
    const ratio=(size.width/size.height).toFixed(6);
    stageEl.style.setProperty("--ghost-video-ratio", `${ratio}`);
  }

  function syncCameraStageForOrientation(){
    const stage=$("cameraStage");
    const media=$("video");
    if(!stage || !media)return;

    const w=Number(media.videoWidth||0);
    const h=Number(media.videoHeight||0);
    if(w<=0 || h<=0)return;

    const viewportLandscape=window.innerWidth>window.innerHeight;
    const rawRatio=w/h;
    /* Always make the stage orientation follow the phone orientation.
       We only choose the portrait/landscape form of the real camera ratio;
       we never invent a fixed 9:16 or 16:9 resolution. */
    let ratio = viewportLandscape ? Math.max(rawRatio,1/rawRatio) : Math.min(rawRatio,1/rawRatio);
    if(!Number.isFinite(ratio) || ratio<=0) ratio=viewportLandscape ? 16/9 : 9/16;

    stage.style.setProperty("--ghost-video-ratio",String(ratio));
    stage.dataset.orientation=viewportLandscape?"landscape":"portrait";
  }

  function syncVideoGeometry(){
    syncCameraStageForOrientation();
    updateStageAspect($("remoteVideo"), $("viewerStage"));
    resizeCameraCanvas();
    resizeViewerCanvas();
    positionZoneHandles();
  }

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
        sourceW || 1280,
        sourceH || 720,
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
     TRACKING / STABILITY 2.0
  ========================================================== */

  function bboxIoU(a,b){
    if(!a || !b) return 0;
    const ax=a[0], ay=a[1], aw=Math.max(0,a[2]), ah=Math.max(0,a[3]);
    const bx=b[0], by=b[1], bw=Math.max(0,b[2]), bh=Math.max(0,b[3]);
    const left=Math.max(ax,bx), top=Math.max(ay,by);
    const right=Math.min(ax+aw,bx+bw), bottom=Math.min(ay+ah,by+bh);
    const iw=Math.max(0,right-left), ih=Math.max(0,bottom-top);
    const inter=iw*ih;
    const union=aw*ah+bw*bh-inter;
    return union>0 ? inter/union : 0;
  }

  function smoothValue(prev,next,alpha=.34){
    return prev + (next-prev)*alpha;
  }

  function smoothBBox(prev,next){
    if(!prev) return next.slice();
    return [
      smoothValue(prev[0],next[0]),
      smoothValue(prev[1],next[1]),
      smoothValue(prev[2],next[2]),
      smoothValue(prev[3],next[3])
    ];
  }

  function median(values){
    if(!values.length) return 0;
    const a=values.slice().sort((x,y)=>x-y);
    return a[Math.floor(a.length/2)] || 0;
  }

  function processDetections(predictions){
    markAiFrame();
    updateCameraFrameMetrics();
    const now=Date.now();
    const minDim=Math.min(canvas.width || 1080,canvas.height || 1920);
    const moveThreshold=Math.max(12,minDim*.015);
    const matchDistance=Math.max(90,minDim*.22);
    const staleMs=2600;

    const current=(Array.isArray(predictions)?predictions:[])
      .filter(p=>p && Array.isArray(p.bbox) && p.bbox.length>=4 && Number(p.score)>=detectionThreshold)
      .map(p=>({
        class:p.class,
        score:Number(p.score),
        bbox:p.bbox.slice(),
        center:centerOf(p.bbox),
        id:null,
        inside:false,
        moved:false,
        newlyConfirmed:false,
        eventEligible:false
      }));

    const candidates=[];
    for(const obj of current){
      for(const track of tracks){
        if(track.class!==obj.class || (track.missed||0)>2) continue;
        const d=distance(track.center,obj.center);
        const iou=bboxIoU(track.bbox,obj.bbox);
        const s1=Math.max(track.bbox[2],track.bbox[3],1);
        const s2=Math.max(obj.bbox[2],obj.bbox[3],1);
        const sizeRatio=Math.max(s1/s2,s2/s1);
        if(d>matchDistance && iou<.02) continue;
        const cost=(d/Math.max(minDim,1))*.72+(1-iou)*.23+Math.min(sizeRatio-1,.8)*.05;
        candidates.push({obj,track,d,iou,cost});
      }
    }
    candidates.sort((a,b)=>a.cost-b.cost);

    const usedObjects=new Set();
    const usedTracks=new Set();
    const associations=[];
    for(const c of candidates){
      if(usedObjects.has(c.obj) || usedTracks.has(c.track.id)) continue;
      usedObjects.add(c.obj);
      usedTracks.add(c.track.id);
      associations.push(c);
    }

    const motionVectors=[];

    // Update matched tracks, but delay the final MOVED decision until
    // a global camera-shake test has been made.
    for(const a of associations){
      const {obj,track,d}=a;
      const previousCenter={x:track.center.x,y:track.center.y};
      const previousInside=!!track.inside;

      motionVectors.push({dx:obj.center.x-previousCenter.x,dy:obj.center.y-previousCenter.y,trackId:track.id});

      obj.id=track.id;
      obj.bbox=smoothBBox(track.bbox,obj.bbox);
      obj.center=centerOf(obj.bbox);
      track.previousCenter=previousCenter;
      track.bbox=obj.bbox.slice();
      track.center=obj.center;
      track.lastSeen=now;
      track.missed=0;
      track.hits=(track.hits||0)+1;
      track.age=(track.age||0)+1;
      track.confirmed=!!track.confirmed || track.hits>=2;
      track.lastDisplacement=d;

      track.inside=pointInside(obj.center,zonePolygonPixels());
      obj.inside=track.inside;

      // Low-pass bbox motion. A single detector wobble cannot trigger movement.
      if(d>=moveThreshold){
        track.motionFrames=Math.min(8,(track.motionFrames||0)+1);
        track.motionScore=Math.min(10,(track.motionScore||0)+1);
      }else{
        track.motionFrames=Math.max(0,(track.motionFrames||0)-1);
        track.motionScore=Math.max(0,(track.motionScore||0)-.6);
      }
      track.pendingMoved=track.confirmed && track.motionFrames>=3 && track.motionScore>=2;
      track.newlyConfirmed=!track.uniqueCounted && track.confirmed;

      if(track.newlyConfirmed){
        track.uniqueCounted=true;
        uniqueObjectIds.add(track.id);
        uniqueClasses.add(track.class);
        obj.newlyConfirmed=true;
      }

      obj.eventEligible=obj.newlyConfirmed;

      if(zone.enabled && track.confirmed && obj.inside && !previousInside){
        zoneEntries++;
        createEvent(obj,"entered zone",true);
      }
    }

    // New detections become tentative tracks. They must survive to the next
    // detector cycle before counting as a unique object.
    for(const obj of current){
      if(obj.id!==null) continue;
      const id=nextTrackId++;
      obj.id=id;
      const inside=pointInside(obj.center,zonePolygonPixels());
      obj.inside=inside;
      tracks.push({
        id,
        class:obj.class,
        bbox:obj.bbox.slice(),
        center:{...obj.center},
        previousCenter:{...obj.center},
        lastSeen:now,
        inside,
        missed:0,
        hits:1,
        age:1,
        confirmed:false,
        uniqueCounted:false,
        movementCounted:false,
        movementEventSent:false,
        motionFrames:0,
        motionScore:0,
        pendingMoved:false,
        lastDisplacement:0
      });
    }

    const associatedTrackIds=new Set(associations.map(a=>a.track.id));
    for(const track of tracks){
      if(!associatedTrackIds.has(track.id)){
        track.missed=(track.missed||0)+1;
        track.age=(track.age||0)+1;
      }
    }
    tracks=tracks.filter(track=>now-track.lastSeen<staleMs && (track.missed||0)<=5);

    // If several tracked objects all shift in roughly the same direction and
    // amount, treat that as camera movement rather than object movement.
    let globalCameraShift=false;
    if(motionVectors.length>=3){
      const medX=median(motionVectors.map(v=>v.dx));
      const medY=median(motionVectors.map(v=>v.dy));
      const residuals=motionVectors.map(v=>Math.hypot(v.dx-medX,v.dy-medY));
      const medianResidual=median(residuals);
      const shift=Math.hypot(medX,medY);
      globalCameraShift=shift>=minDim*.012 && medianResidual<=Math.max(10,minDim*.025);
    }

    for(const obj of current){
      const track=tracks.find(t=>t.id===obj.id);
      if(!track) continue;
      obj.moved=!!track.pendingMoved && !globalCameraShift;
      if(obj.moved){
        obj.eventEligible=true;
        if(!track.movementCounted){
          track.movementCounted=true;
          movedCount++;
        }
      }else if(track.lastDisplacement<moveThreshold){
        track.movementCounted=false;
        track.movementEventSent=false;
      }
    }

    drawDetections(current);
    renderStats(current.length);
    renderObjects(current);
    sendDetectionState(current);

    const eventTarget=current.find(o=>o.eventEligible && o.score>=Math.max(detectionThreshold,.5));
    if(eventTarget){
      const track=tracks.find(t=>t.id===eventTarget.id);
      if(eventTarget.moved){
        if(track && !track.movementEventSent){
          track.movementEventSent=true;
          createEvent(eventTarget,"movement detected",false);
        }
      }else if(eventTarget.newlyConfirmed){
        createEvent(eventTarget,"new object",false);
      }
    }

    lastDetectionState=current;
    proEventEngine(current);
  }

  /* =========================================================
     PRODUCT EVENT ENGINE
  ========================================================== */
  function renderActivityGraph(){const el=$("activityGraph");if(!el)return;const max=Math.max(2,...proActivity);el.innerHTML=proActivity.map((v,i)=>`<i class="activity-bar ${i===29?"hot":""}" style="--h:${Math.max(4,Math.round(v/max*100))}%"></i>`).join("");const b=$("activityNow");if(b){b.textContent=proActivity[29]>0?"ACTIVE":"QUIET";b.classList.toggle("active",proActivity[29]>0);}}
  async function updateProHealth(){
    if(Date.now()-proLastHealthAt<500) return;
    proLastHealthAt=Date.now();
    if($("healthState")) $("healthState").textContent=running?"LIVE":"READY";
    if($("healthVideoFps")) $("healthVideoFps").textContent=running?`${Math.round(cameraVideoFps)} fps`:"—";
    if($("healthFps")) $("healthFps").textContent=running?`${cameraAiFps.toFixed(1)} fps`:"—";
    if($("healthResolution")) $("healthResolution").textContent=cameraLastResolution;
    if($("healthNetwork")) $("healthNetwork").textContent=navigator.onLine?"ONLINE":"OFFLINE";
    try{const b=await navigator.getBattery?.();if($("healthBattery")) $("healthBattery").textContent=b?`${Math.round(b.level*100)}%`:"—";}catch{}
  }

  function updateCameraFrameMetrics(){
    const v=$("video");
    const size=getMediaSourceSize(v, stream);
    if(size.width>0 && size.height>0) cameraLastResolution=`${size.width}×${size.height}`;
    try{
      const track=stream?.getVideoTracks?.()[0];
      const settings=track?.getSettings?.();
      if(Number.isFinite(settings?.frameRate) && settings.frameRate>0 && cameraVideoFps<=1) cameraVideoFps=settings.frameRate;
    }catch{}
    const now=performance.now();
    if(!window.__ghostVideoSampleAt) window.__ghostVideoSampleAt=now;
    const delta=(now-window.__ghostVideoSampleAt)/1000;
    cameraVideoFrames++;
    if(delta>=1){
      cameraVideoFps=cameraVideoFrames/delta; cameraVideoFrames=0; window.__ghostVideoSampleAt=now;
    }
  }

  function markAiFrame(){
    cameraAiFrameCount++;
    const now=Date.now(); const delta=(now-cameraAiFpsWindowStarted)/1000;
    if(delta>=1){ cameraAiFps=cameraAiFrameCount/delta; cameraAiFrameCount=0; cameraAiFpsWindowStarted=now; }
  }
  function proEventEngine(items){
    const now=Date.now();
    const seen=new Set();

    const emitOnce=(obj, action, cooldownMs=15000, force=false)=>{
      if(!obj) return;
      const key=`${obj.id}:${obj.class}:${action}`;
      const last=eventActionCooldowns.get(key)||0;
      if(!force && now-last<cooldownMs) return;
      eventActionCooldowns.set(key,now);
      createEvent(obj,action,true);
    };

    items.forEach(obj=>{
      const t=tracks.find(x=>x.id===obj.id);
      if(!t) return;
      seen.add(obj.id);
      let m=proZoneState.get(obj.id);
      if(!m){
        m={inside:false,since:0,dwell:false,loiter:false};
        proZoneState.set(obj.id,m);
      }

      const inside=!!(zone.enabled&&obj.inside);
      if(inside&&!m.inside){
        m.inside=true;
        m.since=now;
        m.dwell=false;
        m.loiter=false;
        emitOnce(obj,"entered zone",30000);
      }

      if(!inside&&m.inside){
        m.inside=false;
        m.since=0;
        m.dwell=false;
        m.loiter=false;
        emitOnce(obj,"left zone",30000);
      }

      if(inside&&m.since){
        const sec=(now-m.since)/1000;
        if(!m.dwell&&sec>=dwellSeconds){
          m.dwell=true;
          emitOnce(obj,`inside zone ${dwellSeconds}s`,60000);
        }
        if(!m.loiter&&sec>=Math.max(30,dwellSeconds*2)){
          m.loiter=true;
          emitOnce(obj,"loitering",120000);
        }
      }
    });

    for(const [id] of proZoneState){
      if(!seen.has(id)&&!tracks.some(t=>t.id===id)) proZoneState.delete(id);
    }

    const people=items.filter(x=>x.class==="person").length;
    if(people>=2&&now-proLastPeopleAlertAt>30000){
      proLastPeopleAlertAt=now;
      emitOnce(items.find(x=>x.class==="person")||items[0],"multiple people",30000);
    }

    const activity=Math.min(12,items.length+items.filter(x=>x.moved).length*2);
    proActivity[29]=Math.max(proActivity[29],activity);
    renderActivityGraph();
    updateProHealth();
  }

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
        getMediaSourceSize(video, stream).width,
        getMediaSourceSize(video, stream).height,
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

    const stableKey = `${obj?.id ?? "x"}:${obj?.class ?? "unknown"}:${action}`;
    const dedupeWindow = action === "new object" ? 60000 : 30000;
    const lastStable = eventActionCooldowns.get(`created:${stableKey}`) || 0;
    if(stamp-lastStable < dedupeWindow) return;
    eventActionCooldowns.set(`created:${stableKey}`, stamp);


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
          : 0,

      videoFps: Number(cameraVideoFps.toFixed(1)),
      aiFps: Number(cameraAiFps.toFixed(1)),
      resolution: cameraLastResolution,
      network: navigator.onLine ? "ONLINE" : "OFFLINE",
      device: navigator.userAgentData?.model || /iPhone/i.test(navigator.userAgent) ? "iPhone" : /Android/i.test(navigator.userAgent) ? "Android" : "Camera",
      timestamp: Date.now()

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
      .toggle(
        "hidden",
        !zone.enabled
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
        getMediaSourceSize(video, stream).width,
        getMediaSourceSize(video, stream).height,
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
        getMediaSourceSize(remoteVideo, remoteVideo.srcObject).width,
        getMediaSourceSize(remoteVideo, remoteVideo.srcObject).height,
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

    const fallbackIceServers = [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" }
    ];

    const configuredIceServers =
      Array.isArray(window.GHOST_ICE_SERVERS) &&
      window.GHOST_ICE_SERVERS.length
        ? window.GHOST_ICE_SERVERS
        : fallbackIceServers;

    return {

      debug: 1,

      config:{
        iceServers: configuredIceServers,
        iceCandidatePoolSize: 4,
        sdpSemantics: "unified-plan"
      }

    };

  }


  /* =========================================================
     WEBRTC QUALITY
  ========================================================== */

  let lastRemoteStateAt = 0;
  let lastViewerStats = null;

  async function reportPeerQuality(peerInstance, label){
    if(!peerInstance || !peerInstance._connections) return;
    try{
      const pcs=[];
      Object.values(peerInstance._connections).forEach(list=>{
        (Array.isArray(list)?list:[list]).forEach(conn=>{
          const pc=conn && (conn._pc || conn.peerConnection);
          if(pc && typeof pc.getStats === "function" && !pcs.includes(pc)) pcs.push(pc);
        });
      });
      for(const pc of pcs){
        const stats=await pc.getStats();
        let selected=null; const candidates=new Map();
        stats.forEach(r=>{
          if(r.type==="candidate-pair" && (r.selected || r.nominated)) selected=r;
          if(r.type==="local-candidate" || r.type==="remote-candidate") candidates.set(r.id,r);
        });
        if(selected){
          const local=candidates.get(selected.localCandidateId);
          const remote=candidates.get(selected.remoteCandidateId);
          const relay=(local?.candidateType==="relay" || remote?.candidateType==="relay");
          const quality=relay ? "RELAY" : (local?.candidateType==="host" && remote?.candidateType==="host" ? "LOCAL" : "P2P");
          if(label==="viewer" && $("viewerHealthQuality")) $("viewerHealthQuality").textContent=quality;
          return {quality, rtt:Number(selected.currentRoundTripTime||0)*1000};
        }
      }
    }catch(e){ console.debug("Peer quality",e); }
    return null;
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
        const qrSheet=$('qrSheet');
        if(qrSheet && !qrSheet.classList.contains('hidden')) openQRSheet();

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
        if($("healthState")) $("healthState").textContent="ERROR";


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


  $("video")?.addEventListener("loadedmetadata", syncVideoGeometry);
  $("remoteVideo")?.addEventListener("loadedmetadata", syncVideoGeometry);
  window.addEventListener("resize", ()=>setTimeout(syncVideoGeometry,50), {passive:true});
  window.addEventListener("orientationchange", ()=>setTimeout(syncVideoGeometry,180), {passive:true});

  setInterval(()=>{
    if(role==="camera" && running){ updateCameraFrameMetrics(); updateProHealth(); updateStageAspect($("video"), $("cameraStage")); }
    if(role==="viewer" && viewerConn?.open){
      updateStageAspect($("remoteVideo"), $("viewerStage"));
      reportPeerQuality(peer,"viewer");
      const age=Date.now()-lastRemoteStateAt;
      if($("viewerHealthConnection")) $("viewerHealthConnection").textContent=age>4000?"STALE":"CONNECTED";
      if($("viewerHealthLatency") && lastRemoteStateAt) $("viewerHealthLatency").textContent=age<1000?`${age} ms`:`${(age/1000).toFixed(1)} s`;
      if($("viewerHealthSession") && lastRemoteStateAt) $("viewerHealthSession").textContent=age>4000?"STALE":"ACTIVE";
    }
  },1000);

  function stopViewerConnection(){
    if(proViewerReconnectTimer){clearTimeout(proViewerReconnectTimer);proViewerReconnectTimer=null;}
    proViewerReconnectAttempts=0;
    if(peer){try{peer.destroy();}catch{} peer=null;}
    viewerConn=null;
    stopQRScanner();
    if(remoteVideo){remoteVideo.srcObject=null;}
    viewerTracks=[];
    cancelAnimationFrame(viewerRAF);
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

      setViewerIntroMode("code");
      $("viewerIntroPeerId")?.focus();
      toast(
        "Enter a camera code first."
      );

      return;

    }

    $("viewerPage")?.classList.add("connected-viewer");
    if($("viewerIntroPeerId")) $("viewerIntroPeerId").value=id;


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

            updateStageAspect(remoteVideo, $("viewerStage"));


            $("viewerEmpty")
              .classList
              .add(
                "hidden"
              );


            $("viewerState")
              .textContent =
              "LIVE";
            if($("viewerHealthConnection")) $("viewerHealthConnection").textContent="CONNECTED";
            if($("viewerHealthSession") && !$("viewerHealthSession").textContent.includes("CONNECT")) $("viewerHealthSession").textContent="ACTIVE";
            if($("viewerHealthDevice") && $("viewerHealthDevice").textContent==="—") $("viewerHealthDevice").textContent="CAMERA";
            $("viewerChangeConnectionBtn")?.classList.remove("hidden");


            $("viewerDot")
              .parentElement
              .classList
              .add(
                "live"
              );


            resizeViewerCanvas();

            positionZoneHandles();


            startViewerRAF();

            setTimeout(()=>reportPeerQuality(peer, "viewer"),1200);

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

    if($("viewerHealthConnection")) $("viewerHealthConnection").textContent="ERROR";
    if($("viewerHealthQuality")) $("viewerHealthQuality").textContent="—";
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
        if($("viewerHealthConnection")) $("viewerHealthConnection").textContent="CONNECTED";
        if($("viewerHealthQuality")) $("viewerHealthQuality").textContent="CONNECTING";
        if($("viewerHealthSession")) $("viewerHealthSession").textContent="CONNECTING";


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

          updateViewerStats(data.stats);

        }

      }
    );


    conn.on(
      "close",
      () => {

        $("viewerState")
          .textContent =
          "OFFLINE";
        if($("viewerHealthConnection")) $("viewerHealthConnection").textContent="OFFLINE";
        if($("viewerHealthSession")) $("viewerHealthSession").textContent="INACTIVE";


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
        !viewerZone.enabled
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
     VIEWER REMOTE HEALTH
  ========================================================== */

  function updateViewerStats(stats){
    if(!stats) return;
    if($("viewerVisibleCount")) $("viewerVisibleCount").textContent=stats.visible ?? 0;
    if($("viewerUniqueCount")) $("viewerUniqueCount").textContent=stats.unique ?? 0;
    if($("viewerMovedCount")) $("viewerMovedCount").textContent=stats.moved ?? 0;
    if($("viewerZoneCount")) $("viewerZoneCount").textContent=stats.entries ?? 0;
    if($("viewerHealthFps")) $("viewerHealthFps").textContent=stats.videoFps!=null ? `${Number(stats.videoFps).toFixed(1)} fps` : "—";
    if($("viewerHealthAiFps")) $("viewerHealthAiFps").textContent=stats.aiFps!=null ? `${Number(stats.aiFps).toFixed(1)} fps` : "—";
    if($("viewerHealthResolution")) $("viewerHealthResolution").textContent=stats.resolution || "—";
    if($("viewerHealthLatency")) { const age=stats.timestamp ? Math.max(0,Date.now()-stats.timestamp) : 0; $("viewerHealthLatency").textContent=age<1000?`${age} ms`:`${(age/1000).toFixed(1)} s`; }
    if($("viewerHealthConnection")) $("viewerHealthConnection").textContent="CONNECTED";
    if($("viewerHealthDevice")) $("viewerHealthDevice").textContent=stats.device || "CAMERA";
    if($("viewerHealthSession")) $("viewerHealthSession").textContent=stats.session ? formatDuration(Number(stats.session)/1000) : "INACTIVE";
    lastRemoteStateAt=Date.now();
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
        getMediaSourceSize(remoteVideo, remoteVideo.srcObject).width,
        getMediaSourceSize(remoteVideo, remoteVideo.srcObject).height,
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
      () => showViewer("")
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


  $("cameraSetupStart")?.addEventListener("click", async () => {
    setCameraSetupVisible(false);
    await startMonitoring();
    if(!running){
      setCameraSetupVisible(true);
    }
  });

  $("cameraSetupBack")?.addEventListener("click", () => {
    showHome();
  });

  $("pairViewerBtn")?.addEventListener("click", () => {
    openQRSheet();
  });



  /* =========================================================
     VIEWER CONNECT FLOW / QR SCANNER
  ========================================================== */

  function setViewerIntroMode(mode){
    const entry=$("viewerCodeEntry");
    if(entry) entry.classList.toggle("open",mode==="code");
  }

  function applyScannedCameraCode(rawValue){
    if(!rawValue) return false;
    try{
      const u=new URL(rawValue,location.href);
      const mode=u.searchParams.get("mode");
      const camera=u.searchParams.get("camera");
      if((mode==="viewer" || camera) && camera){
        stopQRScanner();
        showViewer(camera);
        return true;
      }
    }catch{
      /* Not a URL; continue below. */
    }
    const match=String(rawValue).match(/(?:^|[?&])camera=([^&#]+)/i);
    if(match){
      const id=decodeURIComponent(match[1]);
      stopQRScanner();
      showViewer(id);
      return true;
    }
    // Accept a plain GHOST peer code as well.
    if(/^ghost-[a-z0-9]{3,}$/i.test(String(rawValue).trim())){
      const id=String(rawValue).trim();
      stopQRScanner();
      showViewer(id);
      return true;
    }
    return false;
  }

  let qrScanStream=null;
  let qrScanRAF=0;
  let qrScanCanvas=null;
  let qrScanCtx=null;
  let qrScanBusy=false;
  let qrScanLastValue="";
  let qrScanLastAt=0;
  let barcodeDetectorInstance=null;

  async function openQRScanner(){
    const sheet=$("qrScannerSheet");
    const v=$("qrScannerVideo");
    if(!sheet || !v) return;
    sheet.classList.remove("hidden");
    $("qrScannerStatus").textContent="Starting camera…";
    qrScanLastValue="";
    qrScanLastAt=0;
    try{
      if(!navigator.mediaDevices?.getUserMedia){
        throw new Error("Camera scanner is unavailable in this browser.");
      }
      qrScanStream=await navigator.mediaDevices.getUserMedia({
        video:{facingMode:{ideal:"environment"},width:{ideal:1280},height:{ideal:720}},
        audio:false
      });
      v.srcObject=qrScanStream;
      await v.play().catch(()=>{});
      qrScanCanvas=qrScanCanvas||document.createElement("canvas");
      qrScanCtx=qrScanCanvas.getContext("2d",{willReadFrequently:true});

      if("BarcodeDetector" in window){
        try{
          const formats=await BarcodeDetector.getSupportedFormats();
          if(formats.includes("qr_code")) barcodeDetectorInstance=new BarcodeDetector({formats:["qr_code"]});
        }catch{ barcodeDetectorInstance=null; }
      }

      $("qrScannerStatus").textContent=barcodeDetectorInstance||window.jsQR?"Scanning…":"QR scanning is not supported here."
      qrScanRAF=requestAnimationFrame(scanQRFrame);
    }catch(error){
      $("qrScannerStatus").textContent=error.name==="NotAllowedError"?"Camera permission denied.":"Could not start the scanner.";
      toast(error.name==="NotAllowedError"?"Allow camera access to scan a QR.":"Could not start QR scanner.");
    }
  }

  async function scanQRFrame(){
    if(!qrScanStream || qrScanBusy){
      if(qrScanStream) qrScanRAF=requestAnimationFrame(scanQRFrame);
      return;
    }
    const v=$("qrScannerVideo");
    if(!v || v.readyState<2){ qrScanRAF=requestAnimationFrame(scanQRFrame); return; }
    qrScanBusy=true;
    try{
      let raw="";
      if(barcodeDetectorInstance){
        const codes=await barcodeDetectorInstance.detect(v);
        raw=codes?.find(x=>x.rawValue)?.rawValue || "";
      }
      if(!raw && window.jsQR){
        const w=Math.min(900,v.videoWidth||0);
        const h=Math.max(1,Math.round((v.videoHeight||1)*(w/(v.videoWidth||1))));
        qrScanCanvas.width=w;
        qrScanCanvas.height=h;
        qrScanCtx.drawImage(v,0,0,w,h);
        const imageData=qrScanCtx.getImageData(0,0,w,h);
        const result=window.jsQR(imageData.data,w,h,{inversionAttempts:"attemptBoth"});
        raw=result?.data || "";
      }
      if(raw){
        const now=Date.now();
        if(raw!==qrScanLastValue || now-qrScanLastAt>1200){
          qrScanLastValue=raw;
          qrScanLastAt=now;
          if(applyScannedCameraCode(raw)) return;
          $("qrScannerStatus").textContent="QR found, but it is not a GHOST camera code.";
        }
      }
    }catch(error){
      /* Keep scanning; transient detector errors are harmless. */
    }finally{
      qrScanBusy=false;
      if(qrScanStream) qrScanRAF=requestAnimationFrame(scanQRFrame);
    }
  }

  function stopQRScanner(){
    cancelAnimationFrame(qrScanRAF);
    qrScanRAF=0;
    if(qrScanStream){
      qrScanStream.getTracks().forEach(t=>t.stop());
      qrScanStream=null;
    }
    const v=$("qrScannerVideo");
    if(v) v.srcObject=null;
    const sheet=$("qrScannerSheet");
    if(sheet) sheet.classList.add("hidden");
    qrScanBusy=false;
  }

  $("viewerScanQRBtn")?.addEventListener("click",openQRScanner);
  $("qrScannerClose")?.addEventListener("click",stopQRScanner);
  $("qrScannerManualBtn")?.addEventListener("click",()=>{
    stopQRScanner();
    setViewerIntroMode("code");
    $("viewerIntroPeerId")?.focus();
  });
  $("viewerEnterCodeBtn")?.addEventListener("click",()=>{
    setViewerIntroMode("code");
    $("viewerIntroPeerId")?.focus();
  });
  $("viewerIntroConnectBtn")?.addEventListener("click",()=>{
    const id=$("viewerIntroPeerId")?.value?.trim()||"";
    $("manualPeerId").value=id;
    connectViewer(id);
  });
  $("viewerIntroPeerId")?.addEventListener("keydown",e=>{
    if(e.key==="Enter") $("viewerIntroConnectBtn")?.click();
  });
  $("viewerChangeConnectionBtn")?.addEventListener("click",()=>{
    stopViewerConnection();
    $("viewerPage")?.classList.remove("connected-viewer");
    setViewerIntroMode("code");
    $("viewerIntroPeerId").value=$("manualPeerId")?.value||"";
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
  function openQRSheet(){
    const s=$("qrSheet"),t=$("qrSheetCode");
    if(!s||!t)return;
    t.innerHTML="";
    if(!peerId){
      $("qrSheetPeerText").textContent="Connecting…";
      s.classList.remove("hidden");
      return;
    }
    if(window.QRCode){
      const u=new URL(location.href);
      u.search="";
      u.hash="";
      u.searchParams.set("mode","viewer");
      u.searchParams.set("camera",peerId);
      new QRCode(t,{text:u.toString(),width:280,height:280,colorDark:"#09080f",colorLight:"#fff",correctLevel:QRCode.CorrectLevel.M});
    }
    $("qrSheetPeerText").textContent=peerId;
    s.classList.remove("hidden");
  }
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

        syncCameraStageForOrientation();
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