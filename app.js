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


/* =========================
   ZOOM
========================= */

const zoomSlider =
    document.getElementById("zoomSlider");

const zoomValue =
    document.getElementById("zoomValue");

const zoomStatus =
    document.getElementById("zoomStatus");


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

let zoomSupported = false;

let zoomMin = 1;

let zoomMax = 5;

let currentZoom = 1;


/* =========================
   FORMAT TIME
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


    const time =
        new Date().toLocaleTimeString(
            "uk-UA",
            {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit"
            }
        );


    line.textContent =
        `${time} // ${message}`;


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


    visibleCountEl.textContent = "0";

    uniqueCountEl.textContent = "0";

    movedCountEl.textContent = "0";

    crossedCountEl.textContent = "0";

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


    activityBars.innerHTML = "";
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
   ZOOM SETUP
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


/* =========================
   SET ZOOM
========================= */

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
            () => requestAnimationFrame(
                detectionLoop
            ),
            140
        );
    }
}


/* =========================
   PROCESS DETECTIONS
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


            const movement =
                distance(
                    bestTrack.center,
                    detection.center
                );


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
                    `${detection.className.toUpperCase()} // ВИЯВЛЕНО РУХ`
                );
            }


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
                    `${detection.className.toUpperCase()} // ПЕРЕТИН ЛІНІЇ`,
                    true
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
                    false
            };


            tracks.push(
                newTrack
            );


            detection.trackId =
                newTrack.id;


            uniqueSeen++;


            uniqueCountEl.textContent =
                uniqueSeen;


            logEvent(
                `${detection.className.toUpperCase()} // НОВИЙ ОБ'ЄКТ #${newTrack.id}`
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


    /* Virtual line */

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


    /* Objects */

    for (
        const detection of detections
    ) {

        const track =
            tracks.find(
                t =>
                    t.id ===
                    detection.trackId
            );


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
                detection.score * 100
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


        if (track) {

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
   ACTIVITY GRAPH
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
                (value / max) * 100
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
            (Date.now() -
                startTime) /
            1000
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