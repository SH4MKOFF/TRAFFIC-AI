const video =
    document.getElementById("camera");

const canvas =
    document.getElementById("overlay");

const ctx =
    canvas.getContext("2d");


const startButton =
    document.getElementById("startCamera");

const statusPill =
    document.getElementById("statusPill");

const bootMessage =
    document.getElementById("bootMessage");


const visibleCountEl =
    document.getElementById("visibleCount");

const uniqueCountEl =
    document.getElementById("uniqueCount");

const movedCountEl =
    document.getElementById("movedCount");

const crossedCountEl =
    document.getElementById("crossedCount");


const objectList =
    document.getElementById("objectList");

const eventLog =
    document.getElementById("eventLog");

const eventCountEl =
    document.getElementById("eventCount");


const sessionTimeEl =
    document.getElementById("sessionTime");

const durationText =
    document.getElementById("durationText");


const fpsText =
    document.getElementById("fpsText");

const modelText =
    document.getElementById("modelText");


const activityBars =
    document.getElementById("activityBars");


const zoomSlider =
    document.getElementById("zoomSlider");

const zoomValue =
    document.getElementById("zoomValue");

const zoomStatus =
    document.getElementById("zoomStatus");


const archiveGrid =
    document.getElementById("archiveGrid");

const saveSessionButton =
    document.getElementById("saveSession");

const clearArchiveButton =
    document.getElementById("clearArchive");


/* =========================
   CONFIG
========================= */

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


const MATCH_DISTANCE = 90;

const MOVEMENT_DISTANCE = 28;

const MAX_TRACK_AGE = 900;

const LINE_X = 0.5;


/* =========================
   STATE
========================= */

let model = null;

let stream = null;

let videoTrack = null;

let running = false;

let tracks = [];

let nextTrackId = 1;

let uniqueSeen = 0;

let movedTotal = 0;

let crossedTotal = 0;

let eventTotal = 0;

let startTime = null;

let detectionCount = 0;

let fpsStart =
    performance.now();

let activityHistory = [];


/* =========================
   ZOOM
========================= */

let zoomSupported = false;

let zoomMin = 1;

let zoomMax = 5;

let currentZoom = 1;


/* =========================
   OBJECT ARCHIVE
========================= */

let objectArchive = [];


/* =========================
   TIME
========================= */

function formatTime(seconds) {

    const min =
        Math.floor(seconds / 60);

    const sec =
        seconds % 60;


    return (
        String(min).padStart(2, "0") +
        ":" +
        String(sec).padStart(2, "0")
    );
}


function getCurrentTime() {

    return new Date().toLocaleTimeString(
        "uk-UA",
        {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit"
        }
    );
}


/* =========================
   DISTANCE
========================= */

function distance(a, b) {

    const dx =
        a.x - b.x;

    const dy =
        a.y - b.y;


    return Math.sqrt(
        dx * dx +
        dy * dy
    );
}


/* =========================
   DIRECTION
========================= */

function getDirection(
    oldCenter,
    newCenter
) {

    const dx =
        newCenter.x -
        oldCenter.x;

    const dy =
        newCenter.y -
        oldCenter.y;


    const threshold = 8;


    if (
        Math.abs(dx) < threshold &&
        Math.abs(dy) < threshold
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


/* =========================
   LOG
========================= */

function logEvent(
    message,
    alert = false
) {

    eventTotal++;


    eventCountEl.textContent =
        `${eventTotal} ${
            eventTotal === 1
                ? "ПОДІЯ"
                : "ПОДІЙ"
        }`;


    const line =
        document.createElement("div");


    line.className =
        alert
            ? "log-line alert"
            : "log-line";


    line.textContent =
        `${getCurrentTime()} // ${message}`;


    eventLog.prepend(line);


    while (
        eventLog.children.length > 25
    ) {

        eventLog.removeChild(
            eventLog.lastChild
        );
    }
}


/* =========================
   RESET SESSION
========================= */

function resetSession() {

    tracks = [];

    nextTrackId = 1;

    uniqueSeen = 0;

    movedTotal = 0;

    crossedTotal = 0;

    eventTotal = 0;

    activityHistory = [];

    detectionCount = 0;

    fpsStart =
        performance.now();


    objectArchive = [];


    visibleCountEl.textContent =
        "0";

    uniqueCountEl.textContent =
        "0";

    movedCountEl.textContent =
        "0";

    crossedCountEl.textContent =
        "0";


    eventCountEl.textContent =
        "0 ПОДІЙ";


    sessionTimeEl.textContent =
        "00:00";


    durationText.textContent =
        "00:00";


    objectList.innerHTML = `
        <div class="empty">
            ОБ'ЄКТІВ НЕ ВИЯВЛЕНО
        </div>
    `;


    eventLog.innerHTML = `
        <div class="log-line dim">
            СИСТЕМА // очікування сенсора...
        </div>
    `;


    activityBars.innerHTML =
        "";


    renderArchive();
}


/* =========================
   CAMERA
========================= */

async function startCamera() {

    if (running) {
        return;
    }


    try {

        resetSession();


        statusPill.textContent =
            "ЗАПУСК...";


        startButton.disabled =
            true;


        stream =
            await navigator.mediaDevices
                .getUserMedia({

                    video: {

                        facingMode: {
                            ideal: "environment"
                        },

                        width: {
                            ideal: 1280
                        },

                        height: {
                            ideal: 720
                        }

                    },

                    audio: false

                });


        video.srcObject =
            stream;


        await video.play();


        videoTrack =
            stream.getVideoTracks()[0];


        setupZoom();


        resizeCanvas();


        statusPill.textContent =
            "ЗАВАНТАЖЕННЯ AI";


        modelText.textContent =
            "МОДЕЛЬ ЗАВАНТАЖУЄТЬСЯ";


        logEvent(
            "ОПТИЧНИЙ СЕНСОР АКТИВОВАНО"
        );


        model =
            await cocoSsd.load({
                base: "mobilenet_v2"
            });


        running = true;


        startTime =
            Date.now();


        statusPill.textContent =
            "AI ONLINE";


        modelText.textContent =
            "COCO-SSD / ONLINE";


        bootMessage.style.display =
            "none";


        startButton.innerHTML =
            "<span>■</span> ЗУПИНИТИ СКАНУВАННЯ";


        startButton.disabled =
            false;


        logEvent(
            "AI-МОДЕЛЬ ГОТОВА ДО АНАЛІЗУ"
        );


        requestAnimationFrame(
            detectionLoop
        );


        updateClock();


    } catch (error) {

        console.error(error);


        running = false;


        statusPill.textContent =
            "ПОМИЛКА";


        modelText.textContent =
            "МОДЕЛЬ ОФЛАЙН";


        startButton.disabled =
            false;


        bootMessage.style.display =
            "flex";


        bootMessage.innerHTML = `
            <strong>ПОМИЛКА</strong>
            <span>
                ПЕРЕВІРТЕ ДОЗВІЛ НА КАМЕРУ
            </span>
        `;


        zoomSlider.disabled =
            true;


        zoomStatus.textContent =
            "ZOOM // КАМЕРУ НЕ АКТИВОВАНО";


        logEvent(
            "НЕ ВДАЛОСЯ ЗАПУСТИТИ КАМЕРУ",
            true
        );
    }
}


/* =========================
   STOP
========================= */

function stopScanning() {

    running = false;


    model = null;


    if (stream) {

        stream
            .getTracks()
            .forEach(track => {
                track.stop();
            });
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


    statusPill.textContent =
        "ЗУПИНЕНО";


    modelText.textContent =
        "МОДЕЛЬ ОФЛАЙН";


    fpsText.textContent =
        "AI FPS --";


    startButton.disabled =
        false;


    startButton.innerHTML =
        "<span>◉</span> ПОЧАТИ СПОСТЕРЕЖЕННЯ";


    bootMessage.style.display =
        "flex";


    bootMessage.innerHTML = `
        <strong>GHOST // ПАУЗА</strong>
        <span>
            СИСТЕМУ СПОСТЕРЕЖЕННЯ ЗУПИНЕНО
        </span>
    `;


    zoomSlider.disabled =
        true;


    zoomStatus.textContent =
        "ZOOM // КАМЕРУ ВИМКНЕНО";


    zoomStatus.classList.remove(
        "online",
        "warning"
    );


    logEvent(
        "СКАНУВАННЯ ЗУПИНЕНО"
    );
}


/* =========================
   ZOOM
========================= */

function setupZoom() {

    zoomSupported = false;

    zoomSlider.disabled =
        true;


    zoomStatus.classList.remove(
        "online",
        "warning"
    );


    if (
        !videoTrack ||
        typeof videoTrack.getCapabilities !==
            "function"
    ) {

        zoomStatus.textContent =
            "ZOOM // НЕ ПІДТРИМУЄТЬСЯ БРАУЗЕРОМ";


        zoomStatus.classList.add(
            "warning"
        );


        return;
    }


    const capabilities =
        videoTrack.getCapabilities();


    if (!capabilities.zoom) {

        zoomStatus.textContent =
            "ZOOM // НЕДОСТУПНИЙ ДЛЯ ЦІЄЇ КАМЕРИ";


        zoomStatus.classList.add(
            "warning"
        );


        return;
    }


    zoomSupported = true;


    zoomMin =
        Number(
            capabilities.zoom.min || 1
        );


    zoomMax =
        Number(
            capabilities.zoom.max || 5
        );


    currentZoom =
        zoomMin;


    zoomSlider.min =
        zoomMin;


    zoomSlider.max =
        zoomMax;


    zoomSlider.step =
        0.1;


    zoomSlider.value =
        currentZoom;


    zoomValue.textContent =
        `${currentZoom.toFixed(1)}×`;


    zoomSlider.disabled =
        false;


    zoomStatus.textContent =
        `ZOOM // ONLINE // ${
            zoomMin.toFixed(1)
        }×–${
            zoomMax.toFixed(1)
        }×`;


    zoomStatus.classList.add(
        "online"
    );
}


async function setZoom(value) {

    if (
        !videoTrack ||
        !zoomSupported
    ) {

        return;
    }


    value =
        Number(value);


    try {

        const constraints =
            videoTrack.getConstraints();


        constraints.advanced = [
            {
                zoom: value
            }
        ];


        await videoTrack.applyConstraints(
            constraints
        );


        currentZoom =
            value;


        zoomValue.textContent =
            `${value.toFixed(1)}×`;


        zoomStatus.textContent =
            `ZOOM // ${
                value.toFixed(1)
            }× // ONLINE`;


    } catch (error) {

        console.warn(
            "Zoom error:",
            error
        );


        zoomStatus.textContent =
            "ZOOM // НЕ ВДАЛОСЯ ЗМІНИТИ";


        zoomStatus.classList.add(
            "warning"
        );
    }
}


/* =========================
   CANVAS
========================= */

function resizeCanvas() {

    if (
        !video.videoWidth ||
        !video.videoHeight
    ) {

        return;
    }


    canvas.width =
        video.videoWidth;


    canvas.height =
        video.videoHeight;
}


/* =========================
   DETECTION LOOP
========================= */

async function detectionLoop() {

    if (
        !running ||
        !model
    ) {

        return;
    }


    if (
        video.readyState >= 2 &&
        video.videoWidth > 0 &&
        video.videoHeight > 0
    ) {

        resizeCanvas();


        try {

            const predictions =
                await model.detect(
                    video,
                    20,
                    0.25
                );


            if (running) {

                processDetections(
                    predictions
                );
            }


        } catch (error) {

            console.error(
                "Detection error:",
                error
            );
        }
    }


    if (running) {

        setTimeout(
            () =>
                requestAnimationFrame(
                    detectionLoop
                ),
            140
        );
    }
}


/* =========================
   PROCESS
========================= */

function processDetections(
    predictions
) {

    const now =
        performance.now();


    const detections =
        predictions
            .filter(item =>
                INTEREST_CLASSES.includes(
                    item.class
                )
            )
            .map(item => {

                const [
                    x,
                    y,
                    width,
                    height
                ] = item.bbox;


                return {

                    className:
                        item.class,

                    score:
                        item.score,

                    x,
                    y,
                    width,
                    height,

                    center: {

                        x:
                            x +
                            width / 2,

                        y:
                            y +
                            height / 2

                    }

                };

            });


    const usedTracks =
        new Set();


    for (
        const detection of detections
    ) {

        let bestTrack =
            null;

        let bestDistance =
            Infinity;


        for (
            const track of tracks
        ) {

            if (
                usedTracks.has(
                    track.id
                )
            ) {

                continue;
            }


            if (
                track.className !==
                detection.className
            ) {

                continue;
            }


            const d =
                distance(
                    track.center,
                    detection.center
                );


            if (
                d < bestDistance &&
                d < MATCH_DISTANCE
            ) {

                bestDistance = d;

                bestTrack = track;
            }
        }


        if (bestTrack) {

            usedTracks.add(
                bestTrack.id
            );


            const oldCenter = {
                x:
                    bestTrack.center.x,

                y:
                    bestTrack.center.y
            };


            const movement =
                distance(
                    bestTrack.center,
                    detection.center
                );


            const direction =
                getDirection(
                    oldCenter,
                    detection.center
                );


            bestTrack.direction =
                direction;


            /* movement */

            if (
                movement >=
                    MOVEMENT_DISTANCE &&
                !bestTrack.moved
            ) {

                bestTrack.moved =
                    true;


                movedTotal++;


                movedCountEl.textContent =
                    movedTotal;


                logEvent(
                    `${detection.className.toUpperCase()} #${bestTrack.id} // ВИЯВЛЕНО РУХ`
                );
            }


            /* crossing */

            const oldSide =
                bestTrack.center.x <
                canvas.width * LINE_X;


            const newSide =
                detection.center.x <
                canvas.width * LINE_X;


            if (
                oldSide !== newSide &&
                !bestTrack.crossed
            ) {

                bestTrack.crossed =
                    true;


                crossedTotal++;


                crossedCountEl.textContent =
                    crossedTotal;


                logEvent(
                    `${detection.className.toUpperCase()} #${bestTrack.id} // ПЕРЕТИН ЛІНІЇ`,
                    true
                );


                updateArchiveObject(
                    bestTrack.id,
                    {
                        crossed: true
                    }
                );
            }


            bestTrack.center =
                detection.center;


            bestTrack.x =
                detection.x;


            bestTrack.y =
                detection.y;


            bestTrack.width =
                detection.width;


            bestTrack.height =
                detection.height;


            bestTrack.score =
                detection.score;


            bestTrack.lastSeen =
                now;


            updateArchiveObject(
                bestTrack.id,
                {
                    lastSeen:
                        getCurrentTime(),

                    score:
                        detection.score,

                    direction:
                        direction,

                    moved:
                        bestTrack.moved
                }
            );


            detection.trackId =
                bestTrack.id;


        } else {

            const newTrack = {

                id:
                    nextTrackId++,

                className:
                    detection.className,

                center:
                    detection.center,

                x:
                    detection.x,

                y:
                    detection.y,

                width:
                    detection.width,

                height:
                    detection.height,

                score:
                    detection.score,

                lastSeen:
                    now,

                moved:
                    false,

                crossed:
                    false,

                direction:
                    "—"
            };


            tracks.push(
                newTrack
            );


            detection.trackId =
                newTrack.id;


            uniqueSeen++;


            uniqueCountEl.textContent =
                uniqueSeen;


            /* archive snapshot */

            createArchiveObject(
                newTrack,
                detection
            );


            logEvent(
                `${detection.className.toUpperCase()} #${newTrack.id} // НОВИЙ ОБ'ЄКТ`
            );
        }
    }


    tracks =
        tracks.filter(track =>
            now -
                track.lastSeen <
            MAX_TRACK_AGE
        );


    drawDetections(
        detections
    );


    visibleCountEl.textContent =
        detections.length;


    updateObjectList(
        detections
    );


    detectionCount++;


    const elapsed =
        performance.now() -
        fpsStart;


    if (elapsed >= 1000) {

        const fps =
            Math.round(
                detectionCount /
                (elapsed / 1000)
            );


        fpsText.textContent =
            `AI FPS ${fps}`;


        detectionCount = 0;


        fpsStart =
            performance.now();
    }


    activityHistory.push(
        detections.length
    );


    if (
        activityHistory.length >
        70
    ) {

        activityHistory.shift();
    }


    renderActivity();
}


/* =========================
   CREATE ARCHIVE OBJECT
========================= */

function createArchiveObject(
    track,
    detection
) {

    const snapshot =
        createObjectSnapshot(
            detection
        );


    const archiveObject = {

        id:
            track.id,

        type:
            detection.className,

        confidence:
            detection.score,

        firstSeen:
            getCurrentTime(),

        lastSeen:
            getCurrentTime(),

        moved:
            false,

        crossed:
            false,

        direction:
            "—",

        image:
            snapshot
    };


    objectArchive.push(
        archiveObject
    );


    renderArchive();
}


/* =========================
   UPDATE ARCHIVE
========================= */

function updateArchiveObject(
    id,
    data
) {

    const object =
        objectArchive.find(
            item =>
                item.id === id
        );


    if (!object) {
        return;
    }


    Object.assign(
        object,
        data
    );


    renderArchive();
}


/* =========================
   SNAPSHOT
========================= */

function createObjectSnapshot(
    detection
) {

    if (
        !video.videoWidth ||
        !video.videoHeight
    ) {

        return "";
    }


    const snapshotCanvas =
        document.createElement(
            "canvas"
        );


    const padding = 12;


    const sx =
        Math.max(
            0,
            Math.floor(
                detection.x -
                padding
            )
        );


    const sy =
        Math.max(
            0,
            Math.floor(
                detection.y -
                padding
            )
        );


    const ex =
        Math.min(
            video.videoWidth,
            Math.ceil(
                detection.x +
                detection.width +
                padding
            )
        );


    const ey =
        Math.min(
            video.videoHeight,
            Math.ceil(
                detection.y +
                detection.height +
                padding
            )
        );


    const width =
        Math.max(
            1,
            ex - sx
        );


    const height =
        Math.max(
            1,
            ey - sy
        );


    snapshotCanvas.width =
        width;


    snapshotCanvas.height =
        height;


    const snapshotCtx =
        snapshotCanvas.getContext(
            "2d"
        );


    snapshotCtx.drawImage(
        video,
        sx,
        sy,
        width,
        height,
        0,
        0,
        width,
        height
    );


    return snapshotCanvas.toDataURL(
        "image/jpeg",
        0.82
    );
}


/* =========================
   ARCHIVE RENDER
========================= */

function renderArchive() {

    if (
        !objectArchive.length
    ) {

        archiveGrid.innerHTML = `
            <div class="archive-empty">
                АРХІВ ПОРОЖНІЙ
                <span>
                    УНІКАЛЬНІ ОБ'ЄКТИ З'ЯВЛЯТЬСЯ ТУТ ПІД ЧАС СКАНУВАННЯ
                </span>
            </div>
        `;

        return;
    }


    archiveGrid.innerHTML =
        "";


    for (
        const object of objectArchive
    ) {

        const card =
            document.createElement(
                "article"
            );


        card.className =
            "archive-card";


        const confidence =
            Math.round(
                object.confidence *
                100
            );


        card.innerHTML = `

            <img
                class="archive-photo"
                src="${object.image}"
                alt="${object.type}"
            >

            <div class="archive-info">

                <div class="archive-object-title">

                    <span>
                        ${object.type.toUpperCase()}
                    </span>

                    <span class="archive-id">
                        #${object.id}
                    </span>

                </div>


                <div class="archive-details">

                    <div class="archive-detail">

                        <span class="archive-detail-label">
                            CONFIDENCE
                        </span>

                        <span class="archive-detail-value">
                            ${confidence}%
                        </span>

                    </div>


                    <div class="archive-detail">

                        <span class="archive-detail-label">
                            ПЕРША ПОЯВА
                        </span>

                        <span class="archive-detail-value">
                            ${object.firstSeen}
                        </span>

                    </div>


                    <div class="archive-detail">

                        <span class="archive-detail-label">
                            ОСТАННЄ БАЧЕННЯ
                        </span>

                        <span class="archive-detail-value">
                            ${object.lastSeen}
                        </span>

                    </div>


                    <div class="archive-detail">

                        <span class="archive-detail-label">
                            РУХ
                        </span>

                        <span class="archive-detail-value">
                            ${object.moved ? "ТАК" : "НІ"}
                        </span>

                    </div>


                    <div class="archive-detail">

                        <span class="archive-detail-label">
                            ЛІНІЯ
                        </span>

                        <span class="archive-detail-value">
                            ${object.crossed ? "ПЕРЕТНУТО" : "—"}
                        </span>

                    </div>


                    <div class="archive-detail">

                        <span class="archive-detail-label">
                            НАПРЯМОК
                        </span>

                        <span class="archive-detail-value archive-direction">
                            ${object.direction}
                        </span>

                    </div>

                </div>

            </div>
        `;


        archiveGrid.appendChild(
            card
        );
    }
}


/* =========================
   OBJECT LIST
========================= */

function updateObjectList(
    detections
) {

    if (
        !detections.length
    ) {

        objectList.innerHTML = `
            <div class="empty">
                ОБ'ЄКТІВ НЕ ВИЯВЛЕНО
            </div>
        `;

        return;
    }


    const counts = {};


    for (
        const item of detections
    ) {

        if (
            !counts[
                item.className
            ]
        ) {

            counts[
                item.className
            ] = 0;
        }


        counts[
            item.className
        ]++;
    }


    objectList.innerHTML =
        "";


    Object.entries(counts)
        .sort(
            (a, b) =>
                b[1] - a[1]
        )
        .forEach(
            ([name, count]) => {

                const row =
                    document.createElement(
                        "div"
                    );


                row.className =
                    "object-row";


                row.innerHTML = `
                    <span class="object-name">
                        ${name}
                    </span>

                    <span class="object-count">
                        x${count}
                    </span>
                `;


                objectList.appendChild(
                    row
                );
            }
        );
}


/* =========================
   DRAW
========================= */

function drawDetections(
    detections
) {

    ctx.clearRect(
        0,
        0,
        canvas.width,
        canvas.height
    );


    const lineX =
        canvas.width *
        LINE_X;


    ctx.save();


    ctx.strokeStyle =
        "#55ff9b";


    ctx.lineWidth = 2;


    ctx.setLineDash([
        8,
        8
    ]);


    ctx.beginPath();


    ctx.moveTo(
        lineX,
        0
    );


    ctx.lineTo(
        lineX,
        canvas.height
    );


    ctx.stroke();


    ctx.restore();


    for (
        const detection of detections
    ) {

        const x =
            detection.x;


        const y =
            detection.y;


        const w =
            detection.width;


        const h =
            detection.height;


        ctx.strokeStyle =
            "#55ff9b";


        ctx.lineWidth = 2;


        ctx.strokeRect(
            x,
            y,
            w,
            h
        );


        const percent =
            Math.round(
                detection.score *
                100
            );


        const label =
            `${detection.className.toUpperCase()} ${percent}% #${detection.trackId}`;


        ctx.font =
            "bold 13px Courier New";


        const textWidth =
            ctx.measureText(
                label
            ).width;


        ctx.fillStyle =
            "#55ff9b";


        ctx.fillRect(
            x,
            Math.max(
                0,
                y - 21
            ),
            textWidth + 10,
            21
        );


        ctx.fillStyle =
            "#020403";


        ctx.fillText(
            label,
            x + 5,
            Math.max(
                15,
                y - 6
            )
        );


        ctx.fillStyle =
            "#e8ff68";


        ctx.beginPath();


        ctx.arc(
            detection.center.x,
            detection.center.y,
            4,
            0,
            Math.PI * 2
        );


        ctx.fill();
    }
}


/* =========================
   ACTIVITY
========================= */

function renderActivity() {

    activityBars.innerHTML =
        "";


    if (
        !activityHistory.length
    ) {

        return;
    }


    const max =
        Math.max(
            1,
            ...activityHistory
        );


    for (
        const value of
        activityHistory
    ) {

        const bar =
            document.createElement(
                "div"
            );


        bar.className =
            "activity-bar";


        const height =
            Math.max(
                5,
                (value / max) *
                100
            );


        bar.style.height =
            `${height}%`;


        activityBars.appendChild(
            bar
        );
    }
}


/* =========================
   CLOCK
========================= */

function updateClock() {

    if (
        !running ||
        !startTime
    ) {

        return;
    }


    const seconds =
        Math.floor(
            (
                Date.now() -
                startTime
            ) / 1000
        );


    const formatted =
        formatTime(
            seconds
        );


    sessionTimeEl.textContent =
        formatted;


    durationText.textContent =
        formatted;


    setTimeout(
        updateClock,
        1000
    );
}


/* =========================
   SAVE SESSION
========================= */

function saveSession() {

    if (
        !objectArchive.length
    ) {

        alert(
            "Архів порожній. Спочатку виявте хоча б один об'єкт."
        );

        return;
    }


    const sessionDuration =
        startTime
            ? formatTime(
                Math.floor(
                    (
                        Date.now() -
                        startTime
                    ) / 1000
                )
            )
            : "00:00";


    const cards =
        objectArchive
            .map(object => {

                const confidence =
                    Math.round(
                        object.confidence *
                        100
                    );


                return `

                <article class="card">

                    <img
                        src="${object.image}"
                        alt="${object.type}"
                    >

                    <div class="info">

                        <div class="title">
                            ${object.type.toUpperCase()}
                            <span>#${object.id}</span>
                        </div>

                        <div>
                            CONFIDENCE:
                            ${confidence}%
                        </div>

                        <div>
                            ПЕРША ПОЯВА:
                            ${object.firstSeen}
                        </div>

                        <div>
                            ОСТАННЄ БАЧЕННЯ:
                            ${object.lastSeen}
                        </div>

                        <div>
                            РУХ:
                            ${object.moved ? "ТАК" : "НІ"}
                        </div>

                        <div>
                            ПЕРЕТИН ЛІНІЇ:
                            ${object.crossed ? "ТАК" : "НІ"}
                        </div>

                        <div>
                            НАПРЯМОК:
                            ${object.direction}
                        </div>

                    </div>

                </article>

                `;
            })
            .join("");


    const html = `

<!DOCTYPE html>

<html lang="uk">

<head>

<meta charset="UTF-8">

<meta name="viewport"
content="width=device-width, initial-scale=1">

<title>GHOST // SESSION ARCHIVE</title>

<style>

body {
    margin: 0;
    padding: 20px;

    background: #050807;
    color: #d9ffe8;

    font-family:
        Courier New,
        monospace;
}

h1 {
    color: #55ff9b;
}

.meta {
    color: #70927e;
    margin-bottom: 20px;
}

.grid {
    display: grid;

    grid-template-columns:
        repeat(
            auto-fill,
            minmax(240px, 1fr)
        );

    gap: 15px;
}

.card {
    border:
        1px solid
        rgba(
            85,
            255,
            155,
            0.3
        );

    background: #08100c;
}

.card img {
    width: 100%;
    display: block;
}

.info {
    padding: 12px;

    line-height: 1.7;

    font-size: 12px;
}

.title {
    color: #55ff9b;

    font-size: 15px;

    font-weight: bold;

    margin-bottom: 8px;
}

.title span {
    color: #e8ff68;
}

</style>

</head>

<body>

<h1>GHOST // VISION</h1>

<div class="meta">
    SESSION ARCHIVE<br>
    ТРИВАЛІСТЬ: ${sessionDuration}<br>
    УНІКАЛЬНИХ ОБ'ЄКТІВ: ${objectArchive.length}
</div>

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
                    "text/html;charset=utf-8"
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


    document.body.appendChild(
        link
    );


    link.click();


    link.remove();


    setTimeout(
        () => {
            URL.revokeObjectURL(
                url
            );
        },
        1000
    );


    logEvent(
        "АРХІВ СЕСІЇ ЗБЕРЕЖЕНО"
    );
}


/* =========================
   CLEAR ARCHIVE
========================= */

function clearArchive() {

    if (
        !objectArchive.length
    ) {

        return;
    }


    const confirmed =
        confirm(
            "Очистити архів усіх унікальних об'єктів?"
        );


    if (!confirmed) {
        return;
    }


    objectArchive = [];


    renderArchive();


    logEvent(
        "АРХІВ ОЧИЩЕНО"
    );
}


/* =========================
   EVENTS
========================= */

window.addEventListener(
    "resize",
    resizeCanvas
);


video.addEventListener(
    "loadedmetadata",
    resizeCanvas
);


zoomSlider.addEventListener(
    "input",
    () => {

        setZoom(
            zoomSlider.value
        );
    }
);


startButton.addEventListener(
    "click",
    () => {

        if (running) {

            stopScanning();

        } else {

            startCamera();

        }
    }
);


saveSessionButton.addEventListener(
    "click",
    saveSession
);


clearArchiveButton.addEventListener(
    "click",
    clearArchive
);