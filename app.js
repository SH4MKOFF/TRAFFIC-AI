const video = document.getElementById("camera");
const canvas = document.getElementById("overlay");
const ctx = canvas.getContext("2d");

const startButton = document.getElementById("startCamera");

const statusPill = document.getElementById("statusPill");
const bootMessage = document.getElementById("bootMessage");

const visibleCountEl = document.getElementById("visibleCount");
const uniqueCountEl = document.getElementById("uniqueCount");
const movedCountEl = document.getElementById("movedCount");
const crossedCountEl = document.getElementById("crossedCount");

const objectList = document.getElementById("objectList");
const eventLog = document.getElementById("eventLog");
const eventCountEl = document.getElementById("eventCount");

const sessionTimeEl = document.getElementById("sessionTime");
const durationText = document.getElementById("durationText");

const fpsText = document.getElementById("fpsText");
const modelText = document.getElementById("modelText");

const activityBars = document.getElementById("activityBars");


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

let running = false;

let tracks = [];
let nextTrackId = 1;

let uniqueSeen = 0;
let movedTotal = 0;
let crossedTotal = 0;
let eventTotal = 0;

let startTime = null;

let detectionCount = 0;
let fpsStart = performance.now();

let activityHistory = [];

let lastDetectionTime = 0;


/* =========================
   HELPERS
========================= */

function formatTime(seconds) {

    const min = Math.floor(seconds / 60);
    const sec = seconds % 60;

    return (
        String(min).padStart(2, "0") +
        ":" +
        String(sec).padStart(2, "0")
    );
}


function distance(a, b) {

    const dx = a.x - b.x;
    const dy = a.y - b.y;

    return Math.sqrt(dx * dx + dy * dy);
}


function logEvent(message, alert = false) {

    eventTotal++;

    eventCountEl.textContent =
        `${eventTotal} ${eventTotal === 1 ? "ПОДІЯ" : "ПОДІЙ"}`;

    const line = document.createElement("div");

    line.className =
        alert
            ? "log-line alert"
            : "log-line";

    const time = new Date().toLocaleTimeString(
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

    while (eventLog.children.length > 25) {
        eventLog.removeChild(eventLog.lastChild);
    }
}


/* =========================
   CAMERA
========================= */

async function startCamera() {

    if (running) return;

    try {

        statusPill.textContent = "ЗАПУСК...";
        startButton.disabled = true;

        stream = await navigator.mediaDevices.getUserMedia({

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


        video.srcObject = stream;

        await video.play();


        resizeCanvas();


        statusPill.textContent = "ЗАВАНТАЖЕННЯ AI";

        modelText.textContent =
            "МОДЕЛЬ ЗАВАНТАЖУЄТЬСЯ";


        logEvent(
            "ОПТИЧНИЙ СЕНСОР АКТИВОВАНО"
        );


        model = await cocoSsd.load({
            base: "mobilenet_v2"
        });


        running = true;

        startTime = Date.now();

        statusPill.textContent = "AI ONLINE";

        modelText.textContent =
            "COCO-SSD / ONLINE";

        bootMessage.style.display = "none";

        startButton.textContent =
            "◉ СПОСТЕРЕЖЕННЯ АКТИВНЕ";

        logEvent(
            "AI-МОДЕЛЬ ГОТОВА ДО АНАЛІЗУ"
        );


        requestAnimationFrame(detectionLoop);

        updateClock();

    } catch (error) {

        console.error(error);

        statusPill.textContent = "ПОМИЛКА";

        modelText.textContent =
            "МОДЕЛЬ ОФЛАЙН";

        startButton.disabled = false;

        bootMessage.style.display = "flex";

        bootMessage.innerHTML = `
            <strong>ПОМИЛКА</strong>
            <span>ПЕРЕВІРТЕ ДОЗВІЛ НА КАМЕРУ</span>
        `;

        logEvent(
            "НЕ ВДАЛОСЯ ЗАПУСТИТИ КАМЕРУ",
            true
        );
    }
}


/* =========================
   CANVAS
========================= */

function resizeCanvas() {

    if (!video.videoWidth || !video.videoHeight) {
        return;
    }

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
}


/* =========================
   DETECTION LOOP
========================= */

async function detectionLoop() {

    if (!running || !model) {
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


            processDetections(predictions);

        } catch (error) {

            console.error(
                "Detection error:",
                error
            );
        }
    }


    setTimeout(
        () => requestAnimationFrame(detectionLoop),
        140
    );
}


/* =========================
   TRACKING
========================= */

function processDetections(predictions) {

    const now = performance.now();


    const detections = predictions
        .filter(item =>
            INTEREST_CLASSES.includes(item.class)
        )
        .map(item => {

            const [
                x,
                y,
                width,
                height
            ] = item.bbox;

            return {

                className: item.class,

                score: item.score,

                x,
                y,
                width,
                height,

                center: {
                    x: x + width / 2,
                    y: y + height / 2
                }
            };
        });


    const usedTracks = new Set();


    for (const detection of detections) {

        let bestTrack = null;
        let bestDistance = Infinity;


        for (const track of tracks) {

            if (usedTracks.has(track.id)) {
                continue;
            }

            if (
                track.className !==
                detection.className
            ) {
                continue;
            }


            const d = distance(
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

            usedTracks.add(bestTrack.id);

            const movement =
                distance(
                    bestTrack.center,
                    detection.center
                );


            if (
                movement >= MOVEMENT_DISTANCE &&
                !bestTrack.moved
            ) {

                bestTrack.moved = true;

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

                bestTrack.crossed = true;

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

            bestTrack.x = detection.x;
            bestTrack.y = detection.y;

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

                id: nextTrackId++,

                className:
                    detection.className,

                center:
                    detection.center,

                x: detection.x,
                y: detection.y,

                width:
                    detection.width,

                height:
                    detection.height,

                score:
                    detection.score,

                lastSeen: now,

                moved: false,
                crossed: false
            };


            tracks.push(newTrack);

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


    /* remove old tracks */

    tracks = tracks.filter(track =>
        now - track.lastSeen <
        MAX_TRACK_AGE
    );


    /* draw */

    drawDetections(detections);


    /* stats */

    visibleCountEl.textContent =
        detections.length;


    updateObjectList(detections);


    /* FPS */

    detectionCount++;

    const elapsed =
        performance.now() - fpsStart;


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


    /* activity */

    activityHistory.push(
        detections.length
    );


    if (activityHistory.length > 70) {
        activityHistory.shift();
    }


    renderActivity();
}


/* =========================
   DRAW
========================= */

function drawDetections(detections) {

    ctx.clearRect(
        0,
        0,
        canvas.width,
        canvas.height
    );


    /* virtual line */

    const lineX =
        canvas.width * LINE_X;


    ctx.save();

    ctx.strokeStyle =
        "#55ff9b";

    ctx.lineWidth = 2;

    ctx.setLineDash([8, 8]);

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


    /* objects */

    for (const detection of detections) {

        const track =
            tracks.find(
                t => t.id === detection.trackId
            );


        const x = detection.x;
        const y = detection.y;

        const w = detection.width;
        const h = detection.height;


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
            ctx.measureText(label).width;


        ctx.fillStyle =
            "#55ff9b";


        ctx.fillRect(
            x,
            Math.max(0, y - 21),
            textWidth + 10,
            21
        );


        ctx.fillStyle =
            "#020403";


        ctx.fillText(
            label,
            x + 5,
            Math.max(15, y - 6)
        );


        /* center point */

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

function updateObjectList(detections) {

    if (!detections.length) {

        objectList.innerHTML = `
            <div class="empty">
                ОБ'ЄКТІВ НЕ ВИЯВЛЕНО
            </div>
        `;

        return;
    }


    const counts = {};


    for (const item of detections) {

        if (!counts[item.className]) {
            counts[item.className] = 0;
        }

        counts[item.className]++;
    }


    objectList.innerHTML = "";


    Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .forEach(([name, count]) => {

            const row =
                document.createElement("div");

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

            objectList.appendChild(row);
        });
}


/* =========================
   ACTIVITY GRAPH
========================= */

function renderActivity() {

    activityBars.innerHTML = "";


    if (!activityHistory.length) {
        return;
    }


    const max =
        Math.max(
            1,
            ...activityHistory
        );


    for (
        const value of activityHistory
    ) {

        const bar =
            document.createElement("div");

        bar.className =
            "activity-bar";


        const height =
            Math.max(
                5,
                (value / max) * 100
            );


        bar.style.height =
            `${height}%`;


        activityBars.appendChild(bar);
    }
}


/* =========================
   CLOCK
========================= */

function updateClock() {

    if (!running || !startTime) {
        return;
    }


    const seconds =
        Math.floor(
            (Date.now() - startTime) / 1000
        );


    const formatted =
        formatTime(seconds);


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
   RESIZE
========================= */

window.addEventListener(
    "resize",
    resizeCanvas
);


video.addEventListener(
    "loadedmetadata",
    resizeCanvas
);


/* =========================
   START
========================= */

startButton.addEventListener(
    "click",
    startCamera
);