(() => {

  "use strict";


  /* =========================================================
     GHOST SMART CAMERA V3
     ========================================================= */


  const $ = (id) => document.getElementById(id);


  /* =========================================================
     ELEMENTS
     ========================================================= */

  const roleScreen = $("roleScreen");
  const cameraScreen = $("cameraScreen");
  const viewerScreen = $("viewerScreen");

  const cameraRoleBtn = $("cameraRoleBtn");
  const viewerRoleBtn = $("viewerRoleBtn");

  const backFromCamera = $("backFromCamera");
  const backFromViewer = $("backFromViewer");

  const cameraVideo = $("cameraVideo");
  const cameraCanvas = $("cameraCanvas");

  const remoteVideo = $("remoteVideo");
  const viewerCanvas = $("viewerCanvas");

  const cameraStage = $("cameraStage");
  const viewerStage = $("viewerStage");

  const cameraZoneLayer = $("cameraZoneLayer");
  const viewerZoneLayer = $("viewerZoneLayer");

  const startMonitoringBtn = $("startMonitoringBtn");

  const zoneButton = $("zoneButton");
  const viewerZoneButton = $("viewerZoneButton");

  const zoneEnabled = $("zoneEnabled");

  const soundButton = $("soundButton");

  const zoomSlider = $("zoomSlider");
  const zoomPlus = $("zoomPlus");
  const zoomMinus = $("zoomMinus");

  const qrContainer = $("qrContainer");
  const cameraIdElement = $("cameraId");

  const connectionPill = $("connectionPill");
  const connectionText = $("connectionText");

  const cameraObjectCount = $("cameraObjectCount");
  const viewerObjectCount = $("viewerObjectCount");

  const statObjects = $("statObjects");
  const statUnique = $("statUnique");
  const statMoved = $("statMoved");
  const statZone = $("statZone");

  const viewerObjects = $("viewerObjects");
  const viewerMoved = $("viewerMoved");
  const viewerZoneCount = $("viewerZoneCount");

  const activityList = $("activityList");
  const viewerActivityList = $("viewerActivityList");

  const viewerObjectList = $("viewerObjectList");

  const activityStatus = $("activityStatus");

  const cameraTime = $("cameraTime");

  const viewerStatus = $("viewerStatus");
  const viewerStatusSub = $("viewerStatusSub");

  const viewerFullscreenButton = $("viewerFullscreenButton");

  const connectModal = $("connectModal");
  const closeConnectModal = $("closeConnectModal");
  const cameraIdInput = $("cameraIdInput");
  const connectButton = $("connectButton");


  /* =========================================================
     STATE
     ========================================================= */

  let peer = null;

  let localStream = null;

  let model = null;

  let monitoring = false;

  let role = null;

  let cameraPeerId = null;

  let viewerPeerId = null;

  let detectionTimer = null;

  let stateTimer = null;

  let sessionStarted = null;

  let soundEnabled = true;

  let zoneEditing = false;

  let currentZoom = 1;

  let lastDetections = [];

  let nextTrackId = 1;

  let tracks = new Map();

  let uniqueObjects = new Map();

  let movedEvents = 0;

  let zoneEvents = 0;

  let activityEvents = [];

  let connectedViewers = new Map();

  let viewerZonePoints = [];

  let cameraZonePoints = [];

  let zoneState = {
    enabled: true,
    points: [
      { x: 20, y: 30 },
      { x: 80, y: 30 },
      { x: 80, y: 75 },
      { x: 20, y: 75 }
    ]
  };


  /* =========================================================
     STORAGE
     ========================================================= */

  const savedZone = localStorage.getItem("ghost-zone");

  if (savedZone) {

    try {
      zoneState = JSON.parse(savedZone);
    } catch (error) {
      console.warn("Zone restore failed", error);
    }

  }


  function saveZone() {

    localStorage.setItem(
      "ghost-zone",
      JSON.stringify(zoneState)
    );

  }


  /* =========================================================
     UI
     ========================================================= */

  function showScreen(screen) {

    roleScreen.classList.add("hidden");
    cameraScreen.classList.add("hidden");
    viewerScreen.classList.add("hidden");

    screen.classList.remove("hidden");

  }


  function setConnection(connected, text) {

    connectionText.textContent =
      text || (connected ? "Подключено" : "Офлайн");

    connectionPill.classList.toggle(
      "connected",
      !!connected
    );

  }


  function addActivity(title, subtitle) {

    const event = {
      title,
      subtitle,
      time: new Date()
    };

    activityEvents.unshift(event);

    if (activityEvents.length > 30) {
      activityEvents.pop();
    }

    renderActivity();

  }


  function renderActivity() {

    if (!activityList) return;

    activityList.innerHTML = "";

    activityEvents.slice(0, 12).forEach(event => {

      const item = document.createElement("div");

      item.className = "activity-item";

      const dot = document.createElement("span");

      dot.className = "activity-dot";

      const body = document.createElement("div");

      const strong = document.createElement("strong");

      strong.textContent = event.title;

      const small = document.createElement("small");

      small.textContent =
        `${event.subtitle} • ${event.time.toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit"
        })}`;

      body.appendChild(strong);
      body.appendChild(small);

      item.appendChild(dot);
      item.appendChild(body);

      activityList.appendChild(item);

    });

    if (viewerActivityList) {

      viewerActivityList.innerHTML =
        activityList.innerHTML;

    }

  }


  /* =========================================================
     ROLE
     ========================================================= */

  cameraRoleBtn.addEventListener("click", async () => {

    role = "camera";

    showScreen(cameraScreen);

    await startCameraRole();

  });


  viewerRoleBtn.addEventListener("click", () => {

    role = "viewer";

    showScreen(viewerScreen);

    startViewerRole();

  });


  backFromCamera.addEventListener("click", () => {

    stopMonitoring();

    destroyPeer();

    showScreen(roleScreen);

  });


  backFromViewer.addEventListener("click", () => {

    destroyPeer();

    if (remoteVideo.srcObject) {
      remoteVideo.srcObject = null;
    }

    showScreen(roleScreen);

  });


  /* =========================================================
     CAMERA ROLE
     ========================================================= */

  async function startCameraRole() {

    setConnection(false, "Подготовка камеры");

    try {

      await createCameraPeer();

      await loadAIModel();

      await requestCamera();

      renderCameraZone();

      updateStats();

    } catch (error) {

      console.error(error);

      alert(
        "Не удалось запустить камеру.\n\n" +
        error.message
      );

    }

  }


  async function requestCamera() {

    if (!navigator.mediaDevices?.getUserMedia) {

      throw new Error(
        "Браузер не поддерживает доступ к камере."
      );

    }


    localStream =
      await navigator.mediaDevices.getUserMedia({

        audio: false,

        video: {

          facingMode: {
            ideal: "environment"
          },

          width: {
            ideal: 1080
          },

          height: {
            ideal: 1920
          },

          aspectRatio: {
            ideal: 9 / 16
          }

        }

      });


    cameraVideo.srcObject = localStream;

    cameraVideo.setAttribute(
      "playsinline",
      ""
    );

    cameraVideo.muted = true;

    await cameraVideo.play().catch(() => {});


    cameraVideo.addEventListener(
      "loadedmetadata",
      () => {

        resizeCanvas(
          cameraVideo,
          cameraCanvas
        );

      },
      {
        once: true
      }
    );


    updateZoomCapabilities();

  }


  /* =========================================================
     PEER — CAMERA
     ========================================================= */

  function createCameraPeer() {

    return new Promise((resolve, reject) => {

      const id =
        "ghost-" +
        Math.random()
          .toString(36)
          .substring(2, 8);

      peer = new Peer(id, {

        debug: 2,

        config: {

          iceServers: [

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

      });


      peer.on("open", openedId => {

        cameraPeerId = openedId;

        cameraIdElement.textContent =
          openedId;

        createQR();

        setConnection(
          false,
          "Камера готова"
        );

        resolve();

      });


      peer.on("connection", connection => {

        connectedViewers.set(
          connection.peer,
          connection
        );

        connection.on("open", () => {

          connection.send({

            type: "camera-info",

            zone: zoneState,

            monitoring,

            objects: lastDetections

          });

          if (localStream) {

            callViewer(
              connection.peer
            );

          }

          setConnection(
            true,
            "Есть зритель"
          );

        });


        connection.on("data", data => {

          handleViewerMessage(
            connection,
            data
          );

        });


        connection.on("close", () => {

          connectedViewers.delete(
            connection.peer
          );

          if (connectedViewers.size === 0) {

            setConnection(
              false,
              monitoring
                ? "Камера работает"
                : "Камера готова"
            );

          }

        });


        connection.on("error", error => {

          console.error(
            "Data connection error",
            error
          );

        });

      });


      peer.on("error", error => {

        console.error(
          "Peer error",
          error
        );

        setConnection(
          false,
          "Ошибка подключения"
        );

        if (
          error.type === "peer-unavailable"
        ) {

          alert(
            "Камера не найдена. Проверь ID."
          );

        }

        reject(error);

      });


      peer.on("disconnected", () => {

        setConnection(
          false,
          "Переподключение…"
        );

        try {
          peer.reconnect();
        } catch (error) {
          console.warn(error);
        }

      });

    });

  }


  function createQR() {

    if (!qrContainer || !cameraPeerId) {
      return;
    }

    qrContainer.innerHTML = "";

    const url =
      `${location.origin}${location.pathname}` +
      `?mode=viewer&camera=${encodeURIComponent(cameraPeerId)}`;

    new QRCode(qrContainer, {

      text: url,

      width: 140,

      height: 140,

      correctLevel:
        QRCode.CorrectLevel.M

    });

  }


  function callViewer(viewerId) {

    if (!peer || !localStream) {
      return;
    }


    try {

      const call =
        peer.call(
          viewerId,
          localStream,
          {
            metadata: {
              ghost: true
            }
          }
        );


      if (!call) {
        return;
      }


      call.on("close", () => {

        console.log(
          "Viewer call closed:",
          viewerId
        );

      });


      call.on("error", error => {

        console.error(
          "Media call error",
          error
        );

      });

    } catch (error) {

      console.error(
        "callViewer error",
        error
      );

    }

  }


  function callAllViewers() {

    connectedViewers.forEach(
      (_, viewerId) => {

        callViewer(viewerId);

      }
    );

  }


  /* =========================================================
     VIEWER ROLE
     ========================================================= */

  function startViewerRole() {

    setConnection(
      false,
      "Подключение…"
    );


    const params =
      new URLSearchParams(
        location.search
      );

    const cameraFromUrl =
      params.get("camera");


    createViewerPeer()
      .then(() => {

        if (cameraFromUrl) {

          connectToCamera(
            cameraFromUrl
          );

        } else {

          openConnectModal();

        }

      });

  }


  function createViewerPeer() {

    return new Promise((resolve, reject) => {

      peer = new Peer({

        debug: 2,

        config: {

          iceServers: [

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

      });


      peer.on("open", id => {

        viewerPeerId = id;

        console.log(
          "Viewer peer:",
          id
        );

        resolve();

      });


      peer.on("call", call => {

        console.log(
          "Incoming camera call:",
          call.peer
        );

        call.answer();


        call.on("stream", stream => {

          console.log(
            "Remote stream received"
          );

          remoteVideo.srcObject =
            stream;

          remoteVideo.playsInline = true;

          remoteVideo.autoplay = true;

          remoteVideo.muted = true;

          remoteVideo
            .play()
            .catch(error => {

              console.warn(
                "Autoplay blocked:",
                error
              );

            });


          setConnection(
            true,
            "Видеопоток активен"
          );

          viewerStatus.textContent =
            "Камера подключена";

          viewerStatusSub.textContent =
            "AI-аналитика синхронизирована";

          resizeCanvas(
            remoteVideo,
            viewerCanvas
          );

        });


        call.on("close", () => {

          viewerStatus.textContent =
            "Поток завершён";

          viewerStatusSub.textContent =
            "Ожидаем повторное подключение";

        });


        call.on("error", error => {

          console.error(
            "Incoming call error",
            error
          );

          viewerStatus.textContent =
            "Ошибка видеопотока";

        });

      });


      peer.on("error", error => {

        console.error(
          "Viewer peer error",
          error
        );

        setConnection(
          false,
          "Ошибка"
        );

        reject(error);

      });


      peer.on("disconnected", () => {

        setConnection(
          false,
          "Переподключение…"
        );

        try {
          peer.reconnect();
        } catch (error) {
          console.warn(error);
        }

      });

    });

  }


  function connectToCamera(cameraId) {

    if (!peer) {
      return;
    }


    cameraId =
      String(cameraId || "").trim();


    if (!cameraId) {
      return;
    }


    setConnection(
      false,
      "Соединяемся…"
    );


    viewerStatus.textContent =
      "Соединяемся…";

    viewerStatusSub.textContent =
      cameraId;


    const connection =
      peer.connect(
        cameraId,
        {
          reliable: true,
          serialization: "json"
        }
      );


    connection.on("open", () => {

      console.log(
        "Data channel connected"
      );

      setConnection(
        true,
        "Камера найдена"
      );

      viewerStatus.textContent =
        "Камера найдена";

      viewerStatusSub.textContent =
        "Ожидаем видеопоток";


      connection.send({

        type: "viewer-ready",

        viewerId: viewerPeerId

      });


      connection.send({

        type: "request-state"

      });

    });


    connection.on("data", data => {

      handleCameraMessage(
        connection,
        data
      );

    });


    connection.on("close", () => {

      setConnection(
        false,
        "Соединение закрыто"
      );

      viewerStatus.textContent =
        "Соединение закрыто";

    });


    connection.on("error", error => {

      console.error(
        "Viewer connection error",
        error
      );

      setConnection(
        false,
        "Ошибка соединения"
      );

    });

  }


  /* =========================================================
     MESSAGES
     ========================================================= */

  function handleViewerMessage(
    connection,
    data
  ) {

    if (!data || typeof data !== "object") {
      return;
    }


    if (data.type === "request-state") {

      connection.send({

        type: "camera-info",

        zone: zoneState,

        monitoring,

        objects: lastDetections,

        stats: {
          movedEvents,
          zoneEvents,
          unique: uniqueObjects.size
        },

        activities: activityEvents

      });

      return;
    }


    if (data.type === "viewer-ready") {

      if (localStream) {

        callViewer(
          connection.peer
        );

      }

      return;
    }


    if (data.type === "zone-update") {

      if (!data.zone) {
        return;
      }


      zoneState = {

        ...zoneState,

        enabled:
          Boolean(
            data.zone.enabled
          ),

        points:
          Array.isArray(
            data.zone.points
          )
            ? data.zone.points
            : zoneState.points

      };


      saveZone();

      renderCameraZone();

      broadcastState();

      return;
    }


    if (data.type === "zone-toggle") {

      zoneState.enabled =
        Boolean(data.enabled);

      saveZone();

      renderCameraZone();

      broadcastState();

      return;
    }


    if (data.type === "zoom") {

      applyZoom(
        Number(data.value)
      );

      return;
    }

  }


  function handleCameraMessage(
    connection,
    data
  ) {

    if (!data || typeof data !== "object") {
      return;
    }


    if (data.type === "camera-info") {

      if (data.zone) {

        zoneState =
          normalizeZone(
            data.zone
          );

        renderViewerZone();

      }


      if (Array.isArray(data.objects)) {

        renderViewerObjects(
          data.objects
        );

        drawViewerDetections(
          data.objects
        );

      }


      if (data.stats) {

        viewerMoved.textContent =
          data.stats.movedEvents ?? 0;

        viewerZoneCount.textContent =
          data.stats.zoneEvents ?? 0;

      }


      if (Array.isArray(data.activities)) {

        renderViewerActivities(
          data.activities
        );

      }


      return;

    }


    if (data.type === "ai-state") {

      if (Array.isArray(data.objects)) {

        renderViewerObjects(
          data.objects
        );

        drawViewerDetections(
          data.objects
        );

      }


      if (data.stats) {

        viewerObjects.textContent =
          data.stats.objects ?? 0;

        viewerMoved.textContent =
          data.stats.movedEvents ?? 0;

        viewerZoneCount.textContent =
          data.stats.zoneEvents ?? 0;

      }


      if (Array.isArray(data.activities)) {

        renderViewerActivities(
          data.activities
        );

      }

    }

  }


  function broadcastState() {

    connectedViewers.forEach(
      connection => {

        if (
          connection &&
          connection.open
        ) {

          try {

            connection.send({

              type: "ai-state",

              objects: lastDetections,

              zone: zoneState,

              stats: {

                objects:
                  lastDetections.length,

                movedEvents,

                zoneEvents,

                unique:
                  uniqueObjects.size

              },

              activities:
                activityEvents

            });

          } catch (error) {

            console.warn(
              "State send failed",
              error
            );

          }

        }

      }
    );

  }


  /* =========================================================
     AI MODEL
     ========================================================= */

  async function loadAIModel() {

    if (model) {
      return;
    }


    activityStatus.textContent =
      "Загрузка AI";


    addActivity(
      "AI запускается",
      "Загрузка модели"
    );


    model =
      await cocoSsd.load({
        base:
          "mobilenet_v2"
      });


    activityStatus.textContent =
      "Готово";


    addActivity(
      "AI готов",
      "Камера готова к работе"
    );

  }


  /* =========================================================
     MONITORING
     ========================================================= */

  startMonitoringBtn.addEventListener(
    "click",
    async () => {

      if (monitoring) {

        stopMonitoring();

      } else {

        await startMonitoring();

      }

    }
  );


  async function startMonitoring() {

    if (!localStream) {

      await requestCamera();

    }


    if (!model) {

      await loadAIModel();

    }


    monitoring = true;

    sessionStarted =
      Date.now();


    startMonitoringBtn.innerHTML =
      '<span class="button-dot"></span> Остановить мониторинг';


    activityStatus.textContent =
      "Сканирование";


    addActivity(
      "Мониторинг запущен",
      "AI анализирует изображение"
    );


    callAllViewers();


    detectionLoop();

    updateSessionClock();

    stateTimer =
      setInterval(
        broadcastState,
        500
      );

  }


  function stopMonitoring() {

    monitoring = false;


    if (detectionTimer) {

      clearTimeout(
        detectionTimer
      );

      detectionTimer = null;

    }


    if (stateTimer) {

      clearInterval(
        stateTimer
      );

      stateTimer = null;

    }


    startMonitoringBtn.innerHTML =
      '<span class="button-dot"></span> Почати моніторинг';


    activityStatus.textContent =
      "Остановлено";


    addActivity(
      "Мониторинг остановлен",
      "Сессия завершена"
    );


    broadcastState();

  }


  function updateSessionClock() {

    if (!sessionStarted) {
      return;
    }


    const seconds =
      Math.floor(
        (Date.now() - sessionStarted) /
        1000
      );


    const minutes =
      Math.floor(
        seconds / 60
      );

    const secs =
      seconds % 60;


    cameraTime.textContent =
      `${String(minutes).padStart(2, "0")}:` +
      `${String(secs).padStart(2, "0")}`;


    if (monitoring) {

      requestAnimationFrame(
        updateSessionClock
      );

    }

  }


  /* =========================================================
     DETECTION
     ========================================================= */

  async function detectionLoop() {

    if (!monitoring || !model) {
      return;
    }


    try {

      const predictions =
        await model.detect(
          cameraVideo,
          30,
          0.25
        );


      processDetections(
        predictions
      );

    } catch (error) {

      console.error(
        "Detection error",
        error
      );

    }


    detectionTimer =
      setTimeout(
        detectionLoop,
        180
      );

  }


  function processDetections(
    predictions
  ) {

    const now =
      Date.now();


    const detections =
      predictions
        .filter(
          item =>
            item.score >= 0.25
        )
        .map(
          item =>
            createDetection(
              item,
              now
            )
        );


    updateTracking(
      detections,
      now
    );


    lastDetections =
      detections;


    drawCameraDetections(
      detections
    );


    updateStats();

    broadcastState();

  }


  function createDetection(
    prediction,
    now
  ) {

    const [
      x,
      y,
      width,
      height
    ] =
      prediction.bbox;


    const center = {

      x:
        x + width / 2,

      y:
        y + height / 2

    };


    return {

      id: null,

      class:
        prediction.class,

      score:
        prediction.score,

      bbox:
        prediction.bbox,

      center,

      moved: false,

      crossed: false,

      direction: null,

      timestamp: now

    };

  }


  function updateTracking(
    detections,
    now
  ) {

    const previousTracks =
      Array.from(
        tracks.values()
      );


    const used =
      new Set();


    detections.forEach(
      detection => {

        let best = null;

        let bestDistance = Infinity;


        previousTracks.forEach(
          track => {

            if (
              used.has(track.id)
            ) {
              return;
            }


            if (
              track.class !==
              detection.class
            ) {
              return;
            }


            const distance =
              Math.hypot(

                detection.center.x -
                  track.center.x,

                detection.center.y -
                  track.center.y

              );


            if (
              distance < bestDistance
            ) {

              bestDistance =
                distance;

              best =
                track;

            }

          }
        );


        if (
          best &&
          bestDistance < 120
        ) {

          used.add(best.id);

          detection.id =
            best.id;


          const movement =
            Math.hypot(

              detection.center.x -
                best.center.x,

              detection.center.y -
                best.center.y

            );


          detection.moved =
            movement > 18;


          detection.direction =
            getDirection(
              best.center,
              detection.center
            );


          best.center =
            detection.center;

          best.bbox =
            detection.bbox;

          best.lastSeen =
            now;

          best.moved =
            detection.moved;


          if (
            detection.moved &&
            !best.movementReported
          ) {

            movedEvents++;

            best.movementReported =
              true;


            addActivity(
              `Движение: ${detection.class}`,
              "Объект перемещается"
            );

          }

        } else {

          const id =
            nextTrackId++;


          detection.id =
            id;


          tracks.set(
            id,
            {

              id,

              class:
                detection.class,

              center:
                detection.center,

              bbox:
                detection.bbox,

              firstSeen:
                now,

              lastSeen:
                now,

              movementReported:
                false

            }
          );


          uniqueObjects.set(
            id,
            detection.class
          );


          addActivity(
            `Обнаружен: ${detection.class}`,
            `${Math.round(
              detection.score * 100
            )}% уверенности`
          );

        }


        detection.crossed =
          checkZoneCrossing(
            detection
          );

      }
    );


    for (
      const [id, track]
      of tracks
    ) {

      if (
        now - track.lastSeen >
        2500
      ) {

        tracks.delete(id);

      }

    }

  }


  function getDirection(
    oldPoint,
    newPoint
  ) {

    const dx =
      newPoint.x -
      oldPoint.x;

    const dy =
      newPoint.y -
      oldPoint.y;


    if (
      Math.abs(dx) <
        8 &&
      Math.abs(dy) <
        8
    ) {

      return null;

    }


    if (
      Math.abs(dx) >
      Math.abs(dy)
    ) {

      return dx > 0
        ? "right"
        : "left";

    }


    return dy > 0
      ? "down"
      : "up";

  }


  /* =========================================================
     ZONE
     ========================================================= */

  function normalizeZone(zone) {

    return {

      enabled:
        zone.enabled !== false,

      points:
        Array.isArray(zone.points)
          ? zone.points
          : zoneState.points

    };

  }


  function checkZoneCrossing(
    detection
  ) {

    if (
      !zoneState.enabled
    ) {
      return false;
    }


    const p =
      detection.center;


    const stageWidth =
      cameraVideo.videoWidth ||
      1;

    const stageHeight =
      cameraVideo.videoHeight ||
      1;


    const normalized = {

      x:
        p.x /
        stageWidth *
        100,

      y:
        p.y /
        stageHeight *
        100

    };


    const inside =
      pointInPolygon(
        normalized,
        zoneState.points
      );


    const track =
      tracks.get(
        detection.id
      );


    if (!track) {
      return false;
    }


    const wasInside =
      track.insideZone === true;


    track.insideZone =
      inside;


    if (
      inside &&
      !wasInside
    ) {

      zoneEvents++;

      detection.crossed =
        true;


      addActivity(
        `Зона: ${detection.class}`,
        "Объект вошёл в область"
      );


      if (soundEnabled) {
        playAlert();
      }


      if (
        navigator.vibrate
      ) {

        navigator.vibrate(
          [80, 50, 80]
        );

      }


      return true;

    }


    return false;

  }


  function pointInPolygon(
    point,
    polygon
  ) {

    let inside = false;


    for (
      let i = 0,
          j = polygon.length - 1;
      i < polygon.length;
      j = i++
    ) {

      const xi =
        polygon[i].x;

      const yi =
        polygon[i].y;

      const xj =
        polygon[j].x;

      const yj =
        polygon[j].y;


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
          (xj - xi) *
          (point.y - yi) /
          (yj - yi) +
          xi
        );


      if (intersect) {
        inside = !inside;
      }

    }


    return inside;

  }


  /* =========================================================
     ZONE RENDER
     ========================================================= */

  function renderCameraZone() {

    renderZone(
      cameraZoneLayer,
      true
    );

  }


  function renderViewerZone() {

    renderZone(
      viewerZoneLayer,
      zoneEditing
    );

  }


  function renderZone(
    container,
    editable
  ) {

    if (!container) {
      return;
    }


    container.innerHTML = "";


    if (
      !zoneState.enabled
    ) {
      return;
    }


    const polygon =
      document.createElement(
        "div"
      );

    polygon.className =
      "zone-polygon";


    polygon.style.setProperty(
      "--p1x",
      `${zoneState.points[0].x}%`
    );

    polygon.style.setProperty(
      "--p1y",
      `${zoneState.points[0].y}%`
    );

    polygon.style.setProperty(
      "--p2x",
      `${zoneState.points[1].x}%`
    );

    polygon.style.setProperty(
      "--p2y",
      `${zoneState.points[1].y}%`
    );

    polygon.style.setProperty(
      "--p3x",
      `${zoneState.points[2].x}%`
    );

    polygon.style.setProperty(
      "--p3y",
      `${zoneState.points[2].y}%`
    );

    polygon.style.setProperty(
      "--p4x",
      `${zoneState.points[3].x}%`
    );

    polygon.style.setProperty(
      "--p4y",
      `${zoneState.points[3].y}%`
    );


    container.appendChild(
      polygon
    );


    if (!editable) {
      return;
    }


    zoneState.points.forEach(
      (point, index) => {

        const handle =
          document.createElement(
            "div"
          );

        handle.className =
          "zone-point";

        handle.dataset.index =
          index;

        handle.style.left =
          `${point.x}%`;

        handle.style.top =
          `${point.y}%`;


        enableDrag(
          handle,
          container,
          index
        );


        container.appendChild(
          handle
        );

      }
    );

  }


  function enableDrag(
    element,
    container,
    index
  ) {

    let dragging = false;


    const move = event => {

      if (!dragging) {
        return;
      }


      const rect =
        container.getBoundingClientRect();


      let clientX;
      let clientY;


      if (
        event.touches &&
        event.touches.length
      ) {

        clientX =
          event.touches[0].clientX;

        clientY =
          event.touches[0].clientY;

      } else {

        clientX =
          event.clientX;

        clientY =
          event.clientY;

      }


      const x =
        Math.max(
          0,
          Math.min(
            100,
            (
              (clientX - rect.left) /
              rect.width
            ) * 100
          )
        );


      const y =
        Math.max(
          0,
          Math.min(
            100,
            (
              (clientY - rect.top) /
              rect.height
            ) * 100
          )
        );


      zoneState.points[index] = {
        x,
        y
      };


      renderZone(
        container,
        true
      );


      saveZone();

      broadcastState();

    };


    const start = event => {

      event.preventDefault();

      dragging = true;

    };


    const stop = () => {

      dragging = false;

    };


    element.addEventListener(
      "pointerdown",
      start
    );

    window.addEventListener(
      "pointermove",
      move
    );

    window.addEventListener(
      "pointerup",
      stop
    );

  }


  zoneButton.addEventListener(
    "click",
    () => {

      zoneEditing =
        !zoneEditing;


      zoneButton.textContent =
        zoneEditing
          ? "✓ Готово"
          : "◇ Зона";


      renderCameraZoneEditable();

    }
  );


  function renderCameraZoneEditable() {

    renderZone(
      cameraZoneLayer,
      zoneEditing
    );

  }


  viewerZoneButton.addEventListener(
    "click",
    () => {

      zoneEditing =
        !zoneEditing;


      viewerZoneButton.textContent =
        zoneEditing
          ? "✓ Готово"
          : "◇ Управлять зоной";


      renderViewerZone();

    }
  );


  zoneEnabled.addEventListener(
    "change",
    () => {

      zoneState.enabled =
        zoneEnabled.checked;

      saveZone();

      renderCameraZone();

      renderViewerZone();

      broadcastState();

    }
  );


  /* =========================================================
     DRAW CAMERA AI
     ========================================================= */

  function resizeCanvas(
    video,
    canvas
  ) {

    const width =
      video.videoWidth ||
      720;

    const height =
      video.videoHeight ||
      1280;


    canvas.width =
      width;

    canvas.height =
      height;

  }


  function drawCameraDetections(
    detections
  ) {

    resizeCanvas(
      cameraVideo,
      cameraCanvas
    );


    const ctx =
      cameraCanvas.getContext("2d");


    ctx.clearRect(
      0,
      0,
      cameraCanvas.width,
      cameraCanvas.height
    );


    detections.forEach(
      detection => {

        drawDetection(
          ctx,
          detection
        );

      }
    );

  }


  function drawViewerDetections(
    detections
  ) {

    resizeCanvas(
      remoteVideo,
      viewerCanvas
    );


    const ctx =
      viewerCanvas.getContext("2d");


    ctx.clearRect(
      0,
      0,
      viewerCanvas.width,
      viewerCanvas.height
    );


    detections.forEach(
      detection => {

        drawDetection(
          ctx,
          detection
        );

      }
    );

  }


  function drawDetection(
    ctx,
    detection
  ) {

    const [
      x,
      y,
      width,
      height
    ] =
      detection.bbox;


    ctx.lineWidth =
      3;


    ctx.strokeStyle =
      detection.crossed
        ? "#ff4f67"
        : "#6c63ff";


    ctx.strokeRect(
      x,
      y,
      width,
      height
    );


    const label =
      `${detection.class} ` +
      `${Math.round(
        detection.score * 100
      )}%`;


    ctx.font =
      "bold 15px -apple-system, BlinkMacSystemFont, sans-serif";


    const metrics =
      ctx.measureText(label);


    ctx.fillStyle =
      "rgba(255,255,255,.92)";


    ctx.fillRect(
      x,
      Math.max(
        0,
        y - 28
      ),
      metrics.width + 14,
      26
    );


    ctx.fillStyle =
      "#161616";


    ctx.fillText(
      label,
      x + 7,
      Math.max(
        18,
        y - 10
      )
    );


    if (
      detection.moved
    ) {

      ctx.fillStyle =
        "#23b26d";


      ctx.beginPath();

      ctx.arc(
        x + width - 9,
        y + 9,
        5,
        0,
        Math.PI * 2
      );

      ctx.fill();

    }

  }


  /* =========================================================
     VIEWER OBJECTS
     ========================================================= */

  function renderViewerObjects(
    detections
  ) {

    viewerObjectList.innerHTML = "";


    viewerObjectCount.textContent =
      detections.length;

    viewerObjects.textContent =
      detections.length;


    detections.forEach(
      detection => {

        const item =
          document.createElement(
            "div"
          );

        item.className =
          "object-item";


        const dot =
          document.createElement(
            "span"
          );

        dot.className =
          "activity-dot";


        const body =
          document.createElement(
            "div"
          );


        const strong =
          document.createElement(
            "strong"
          );

        strong.textContent =
          detection.class;


        const small =
          document.createElement(
            "small"
          );

        small.textContent =
          `${Math.round(
            detection.score * 100
          )}%` +
          (
            detection.moved
              ? " • движение"
              : ""
          );


        body.appendChild(
          strong
        );

        body.appendChild(
          small
        );


        item.appendChild(
          dot
        );

        item.appendChild(
          body
        );


        viewerObjectList.appendChild(
          item
        );

      }
    );

  }


  function renderViewerActivities(
    activities
  ) {

    viewerActivityList.innerHTML = "";


    activities
      .slice(0, 12)
      .forEach(event => {

        const item =
          document.createElement(
            "div"
          );

        item.className =
          "activity-item";


        const dot =
          document.createElement(
            "span"
          );

        dot.className =
          "activity-dot";


        const body =
          document.createElement(
            "div"
          );


        const strong =
          document.createElement(
            "strong"
          );

        strong.textContent =
          event.title;


        const small =
          document.createElement(
            "small"
          );

        small.textContent =
          event.subtitle;


        body.appendChild(
          strong
        );

        body.appendChild(
          small
        );


        item.appendChild(
          dot
        );

        item.appendChild(
          body
        );


        viewerActivityList.appendChild(
          item
        );

      });

  }


  /* =========================================================
     STATS
     ========================================================= */

  function updateStats() {

    statObjects.textContent =
      lastDetections.length;

    statUnique.textContent =
      uniqueObjects.size;

    statMoved.textContent =
      movedEvents;

    statZone.textContent =
      zoneEvents;

    cameraObjectCount.textContent =
      lastDetections.length;

  }


  /* =========================================================
     SOUND
     ========================================================= */

  soundButton.addEventListener(
    "click",
    () => {

      soundEnabled =
        !soundEnabled;


      soundButton.textContent =
        soundEnabled
          ? "🔔 Звук"
          : "🔕 Без звука";

    }
  );


  function playAlert() {

    try {

      const AudioContext =
        window.AudioContext ||
        window.webkitAudioContext;


      if (!AudioContext) {
        return;
      }


      const audio =
        new AudioContext();


      const oscillator =
        audio.createOscillator();


      const gain =
        audio.createGain();


      oscillator.frequency.value =
        760;

      oscillator.type =
        "sine";


      gain.gain.setValueAtTime(
        .0001,
        audio.currentTime
      );


      gain.gain.exponentialRampToValueAtTime(
        .15,
        audio.currentTime + .02
      );


      gain.gain.exponentialRampToValueAtTime(
        .0001,
        audio.currentTime + .18
      );


      oscillator.connect(
        gain
      );

      gain.connect(
        audio.destination
      );


      oscillator.start();

      oscillator.stop(
        audio.currentTime + .2
      );

    } catch (error) {

      console.warn(
        "Audio alert failed",
        error
      );

    }

  }


  /* =========================================================
     ZOOM
     ========================================================= */

  async function updateZoomCapabilities() {

    if (!localStream) {
      return;
    }


    const track =
      localStream.getVideoTracks()[0];


    if (!track) {
      return;
    }


    const capabilities =
      track.getCapabilities
        ? track.getCapabilities()
        : {};


    if (
      capabilities.zoom
    ) {

      zoomSlider.min =
        capabilities.zoom.min;

      zoomSlider.max =
        capabilities.zoom.max;

      zoomSlider.step =
        capabilities.zoom.step || .1;

      currentZoom =
        capabilities.zoom.min;

      zoomSlider.value =
        currentZoom;

    }

  }


  zoomSlider.addEventListener(
    "input",
    () => {

      currentZoom =
        Number(
          zoomSlider.value
        );


      applyZoom(
        currentZoom
      );

    }
  );


  zoomPlus.addEventListener(
    "click",
    () => {

      applyZoom(
        currentZoom + .2
      );

    }
  );


  zoomMinus.addEventListener(
    "click",
    () => {

      applyZoom(
        currentZoom - .2
      );

    }
  );


  async function applyZoom(
    value
  ) {

    if (!localStream) {
      return;
    }


    const track =
      localStream.getVideoTracks()[0];


    if (!track) {
      return;
    }


    const capabilities =
      track.getCapabilities
        ? track.getCapabilities()
        : {};


    if (!capabilities.zoom) {
      return;
    }


    const min =
      capabilities.zoom.min;

    const max =
      capabilities.zoom.max;

    const step =
      capabilities.zoom.step || .1;


    value =
      Math.max(
        min,
        Math.min(
          max,
          value
        )
      );


    value =
      Math.round(
        value / step
      ) * step;


    currentZoom =
      value;


    zoomSlider.value =
      value;


    try {

      await track.applyConstraints({

        advanced: [
          {
            zoom: value
          }
        ]

      });

    } catch (error) {

      console.warn(
        "Zoom failed",
        error
      );

    }

  }


  /* =========================================================
     FULLSCREEN VIEWER
     ========================================================= */

  viewerFullscreenButton.addEventListener(
    "click",
    async () => {

      try {

        if (
          viewerStage.requestFullscreen
        ) {

          await viewerStage.requestFullscreen();

        } else if (
          remoteVideo.webkitEnterFullscreen
        ) {

          remoteVideo.webkitEnterFullscreen();

        }

      } catch (error) {

        console.warn(
          "Fullscreen failed",
          error
        );

      }

    }
  );


  /* =========================================================
     PEER DESTROY
     ========================================================= */

  function destroyPeer() {

    connectedViewers.clear();


    if (peer) {

      try {
        peer.destroy();
      } catch (error) {
        console.warn(error);
      }

    }


    peer = null;

    cameraPeerId = null;

    viewerPeerId = null;

  }


  /* =========================================================
     AUTO VIEWER MODE
     ========================================================= */

  const initialParams =
    new URLSearchParams(
      location.search
    );


  if (
    initialParams.get("mode") ===
    "viewer"
  ) {

    role = "viewer";

    showScreen(
      viewerScreen
    );

    startViewerRole();

  }


  /* =========================================================
     INITIAL UI
     ========================================================= */

  zoneEnabled.checked =
    zoneState.enabled;

  renderCameraZone();

  renderViewerZone();

  setConnection(
    false,
    "Офлайн"
  );


})();