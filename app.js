const video = document.getElementById("camera");
const canvas = document.getElementById("overlay");
const ctx = canvas.getContext("2d");

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

const objectListEl =
    document.getElementById("objectList");

const eventLogEl =
    document.getElementById("eventLog");

const eventCountEl =
    document.getElementById("eventCount");

const activityBarsEl =
    document.getElementById("activityBars");

const fpsText =
    document.getElementById("fpsText");

const modelText =
    document.getElementById("modelText");

const sessionTimeEl =
    document.getElementById("sessionTime");

const durationTextEl =
    document.getElementById("durationText");


let model = null;

let detecting = false;

let stream = null;


/* OBJECTS WE CARE ABOUT */

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


const VEHICLE_CLASSES = [

    "car",

    "truck",

    "bus",

    "motorcycle",

    "bicycle"

];


/* TRACKING */

let tracks = [];

let nextTrackId = 1;

let uniqueSeen = 0;

let movedTotal = 0;

let crossedTotal = 0;

let eventTotal = 0;


/* SESSION */

let sessionStartedAt = null;

let fpsFrames = 0;

let fpsWindowStart =
    performance.now();

let activitySamples = [];

let lastActivitySample = 0;


/* TRACK SETTINGS */

const MAX_TRACK_AGE = 900;

const MATCH_DISTANCE = 90;

const MOVEMENT_DISTANCE = 28;


/*
    Вертикальная виртуальная линия
    посередине камеры.
*/

const LINE_X = 0.5;



/* TIME */

function nowTime() {

    return new Date().toLocaleTimeString(
        [],
        {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit"
        }
    );

}



/* STATUS */

function setStatus(
    text,
    live = false
) {

    statusPill.textContent =
        text;

    statusPill.style.color =
        live
            ? "var(--green)"
            : "var(--muted)";

    statusPill.style.borderColor =
        live
            ? "rgba(85,255,155,.55)"
            : "rgba(84,255,151,.18)";
}



/* EVENT LOG */

function addLog(
    message,
    important = false
) {

    eventTotal++;

    eventCountEl.textContent =
        `${eventTotal} EVENTS`;


    const line =
        document.createElement("div");


    line.className =
        "log-line";


    line.innerHTML =

        `<span>${nowTime()}</span>
        // ${important ? "<strong>" : ""}
        ${message}
        ${important ? "</strong>" : ""}`;


    eventLogEl.prepend(line);


    while (
        eventLogEl.children.length > 12
    ) {

        eventLogEl.lastElementChild.remove();

    }

}



/* START CAMERA */

async function startCamera() {

    try {

        startButton.disabled = true;

        startButton.innerHTML =
            "<span>◉</span> INITIALIZING...";


        setStatus(
            "REQUESTING SENSOR"
        );


        stream =
            await navigator.mediaDevices.getUserMedia({

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


        resizeCanvas();


        window.addEventListener(
            "resize",
            resizeCanvas
        );


        sessionStartedAt =
            Date.now();


        bootMessage.style.display =
            "none";


        setStatus(
            "CAMERA ONLINE",
            true
        );


        addLog(
            "optical sensor initialized",
            true
        );


        await loadAI();


    }

    catch (error) {

        console.error(error);


        setStatus(
            "CAMERA ERROR"
        );


        startButton.disabled =
            false;


        startButton.innerHTML =
            "<span>◉</span> RETRY SURVEILLANCE";


        addLog(
            `camera error: ${error.message}`
        );

    }

}



/* LOAD AI */

async function loadAI() {

    try {

        setStatus(
            "LOADING AI"
        );


        modelText.textContent =
            "MODEL LOADING";


        addLog(
            "loading COCO-SSD / MobileNet V2"
        );


        model =
            await cocoSsd.load({

                base: "mobilenet_v2"

            });


        modelText.textContent =
            "COCO-SSD ONLINE";


        setStatus(
            "AI ONLINE",
            true
        );


        addLog(
            "AI inference online",
            true
        );


        detecting = true;


        detectObjects();


        updateClock();

    }

    catch (error) {

        console.error(error);


        setStatus(
            "AI ERROR"
        );


        modelText.textContent =
            "MODEL ERROR";


        addLog(
            "AI model failed to load"
        );

    }

}



/* CANVAS */

function resizeCanvas() {

    if (!video.videoWidth)
        return;


    canvas.width =
        video.videoWidth;


    canvas.height =
        video.videoHeight;

}



/* AI LOOP */

async function detectObjects() {

    if (
        !detecting ||
        !model
    )
        return;


    try {

        const predictions =
            await model.detect(
                video,
                20,
                0.25
            );


        const objects =
            predictions.filter(

                prediction =>

                    INTEREST_CLASSES.includes(
                        prediction.class
                    )

                    &&

                    prediction.score >= 0.25

            );


        updateTracking(
            objects
        );


        drawDetections(
            objects
        );


        updateStats(
            objects
        );


        updateObjectList(
            objects
        );


        updateFPS();

    }

    catch (error) {

        console.error(error);

    }


    setTimeout(
        detectObjects,
        140
    );

}



/* CENTER */

function centerOf(prediction) {

    const [
        x,
        y,
        width,
        height
    ] = prediction.bbox;


    return {

        x: x + width / 2,

        y: y + height / 2

    };

}



/* DISTANCE */

function distance(a, b) {

    return Math.hypot(
        a.x - b.x,
        a.y - b.y
    );

}



/* TRACKING */

function updateTracking(objects) {

    const currentTime =
        Date.now();


    const unmatchedTracks =
        new Set(
            tracks.map(
                track => track.id
            )
        );


    objects.forEach(object => {

        const center =
            centerOf(object);


        let best = null;

        let bestDistance =
            Infinity;


        for (
            const track of tracks
        ) {

            if (
                !unmatchedTracks.has(
                    track.id
                )
            )
                continue;


            if (
                track.class !==
                object.class
            )
                continue;


            const d =
                distance(
                    center,
                    track.center
                );


            if (
                d < bestDistance &&
                d <= MATCH_DISTANCE
            ) {

                best =
                    track;

                bestDistance =
                    d;

            }

        }



        /* EXISTING TRACK */

        if (best) {

            const oldCenter =
                best.center;


            const moved =
                distance(
                    center,
                    oldCenter
                ) >= MOVEMENT_DISTANCE;


            best.prevCenter =
                oldCenter;


            best.center =
                center;


            best.bbox =
                object.bbox;


            best.score =
                object.score;


            best.lastSeen =
                currentTime;


            best.age++;



            /* MOVEMENT */

            if (
                moved &&
                !best.countedAsMoved
            ) {

                best.countedAsMoved =
                    true;


                movedTotal++;


                addLog(
                    `${object.class.toUpperCase()} movement detected`
                );

            }



            /* LINE CROSSING */

            const oldSide =
                oldCenter.x <
                canvas.width * LINE_X;


            const newSide =
                center.x >=
                canvas.width * LINE_X;


            if (
                oldSide !== newSide &&
                !best.crossed
            ) {

                best.crossed =
                    true;


                crossedTotal++;


                addLog(
                    `${object.class.toUpperCase()} crossed virtual line`,
                    true
                );

            }


            unmatchedTracks.delete(
                best.id
            );

        }


        /* NEW TRACK */

        else {

            const newTrack = {

                id:
                    nextTrackId++,

                class:
                    object.class,

                center:
                    center,

                prevCenter:
                    center,

                bbox:
                    object.bbox,

                score:
                    object.score,

                lastSeen:
                    currentTime,

                age:
                    1,

                countedAsMoved:
                    false,

                crossed:
                    false

            };


            tracks.push(
                newTrack
            );


            uniqueSeen++;


            addLog(
                `new ${object.class.toUpperCase()} detected`
            );

        }

    });



    /* REMOVE OLD TRACKS */

    tracks =
        tracks.filter(

            track =>

                currentTime -
                track.lastSeen <
                MAX_TRACK_AGE

        );



    if (
        tracks.length > 80
    ) {

        tracks =
            tracks.slice(-80);

    }

}



/* DRAW */

function drawDetections(
    objects
) {

    ctx.clearRect(
        0,
        0,
        canvas.width,
        canvas.height
    );



    /* VIRTUAL LINE */

    const lineX =
        canvas.width * LINE_X;


    ctx.save();


    ctx.strokeStyle =
        "rgba(85,255,155,.38)";


    ctx.setLineDash(
        [8,8]
    );


    ctx.lineWidth = 2;


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



    /* OBJECTS */

    objects.forEach(
        object => {

            const [
                x,
                y,
                width,
                height
            ] = object.bbox;


            const confidence =
                Math.round(
                    object.score * 100
                );


            const track =
                findTrackForObject(
                    object
                );


            const isMoving =
                track?.countedAsMoved;


            const stroke =
                isMoving
                    ? "#e8ff68"
                    : "#55ff9b";



            ctx.strokeStyle =
                stroke;


            ctx.lineWidth = 2;


            ctx.strokeRect(
                x,
                y,
                width,
                height
            );



            const label =

                `${object.class.toUpperCase()}
                ${confidence}%
                ${track ? `#${track.id}` : ""}`;


            ctx.font =
                "bold 13px IBM Plex Mono, monospace";


            const textWidth =
                ctx.measureText(
                    label
                ).width;


            ctx.fillStyle =
                "rgba(3,8,5,.85)";


            ctx.fillRect(

                x,

                Math.max(
                    0,
                    y - 23
                ),

                textWidth + 10,

                22

            );


            ctx.fillStyle =
                stroke;


            ctx.fillText(

                label,

                x + 5,

                Math.max(
                    15,
                    y - 8
                )

            );



            /* CENTER POINT */

            const center =
                centerOf(object);


            ctx.beginPath();


            ctx.arc(
                center.x,
                center.y,
                3,
                0,
                Math.PI * 2
            );


            ctx.fillStyle =
                stroke;


            ctx.fill();

        }
    );

}



/* FIND TRACK */

function findTrackForObject(
    object
) {

    const center =
        centerOf(object);


    let best = null;

    let bestDistance =
        Infinity;


    for (
        const track of tracks
    ) {

        if (
            track.class !==
            object.class
        )
            continue;


        const d =
            distance(
                center,
                track.center
            );


        if (
            d <
                bestDistance
            &&
            d <
                MATCH_DISTANCE + 20
        ) {

            best =
                track;

            bestDistance =
                d;

        }

    }


    return best;

}



/* STATS */

function updateStats(
    objects
) {

    visibleCountEl.textContent =
        objects.length;


    uniqueCountEl.textContent =
        uniqueSeen;


    movedCountEl.textContent =
        movedTotal;


    crossedCountEl.textContent =
        crossedTotal;



    const now =
        Date.now();


    if (
        now - lastActivitySample >
        1000
    ) {

        lastActivitySample =
            now;


        activitySamples.push({

            count:
                objects.length,

            moved:
                movedTotal,

            time:
                now

        });


        if (
            activitySamples.length >
            60
        ) {

            activitySamples.shift();

        }


        renderActivity();

    }

}



/* OBJECT LIST */

function updateObjectList(
    objects
) {

    const counts = {};


    objects.forEach(
        object => {

            counts[object.class] =
                (
                    counts[object.class] ||
                    0
                ) + 1;

        }
    );


    const entries =
        Object.entries(
            counts
        ).sort(
            (a,b) =>
                b[1] - a[1]
        );


    if (
        !entries.length
    ) {

        objectListEl.innerHTML =
            '<div class="empty">NO OBJECTS DETECTED</div>';

        return;

    }


    objectListEl.innerHTML =

        entries.map(

            ([name,count]) => `

                <div class="object-row">

                    <div>

                        <div class="object-name">
                            ${name}
                        </div>

                        <div class="object-meta">
                            ${
                                isVehicle(name)
                                    ? "MOBILE / VEHICLE"
                                    : "VISIBLE OBJECT"
                            }
                        </div>

                    </div>

                    <div class="object-count">
                        ${count}
                    </div>

                </div>

            `

        ).join("");

}



/* VEHICLE */

function isVehicle(
    name
) {

    return VEHICLE_CLASSES.includes(
        name
    );

}



/* FPS */

function updateFPS() {

    fpsFrames++;


    const now =
        performance.now();


    if (
        now - fpsWindowStart >=
        1000
    ) {

        fpsText.textContent =
            `AI FPS ${fpsFrames}`;


        fpsFrames = 0;


        fpsWindowStart =
            now;

    }

}



/* ACTIVITY GRAPH */

function renderActivity() {

    activityBarsEl.innerHTML =
        "";


    const max =
        Math.max(

            1,

            ...activitySamples.map(
                sample =>
                    sample.count
            )

        );


    activitySamples.forEach(
        sample => {

            const bar =
                document.createElement(
                    "div"
                );


            bar.className =
                "bar";


            bar.style.height =
                `${Math.max(
                    4,
                    (sample.count / max) * 100
                )}%`;


            activityBarsEl.appendChild(
                bar
            );

        }
    );

}



/* SESSION CLOCK */

function updateClock() {

    if (
        !sessionStartedAt
    )
        return;


    const seconds =
        Math.floor(
            (
                Date.now() -
                sessionStartedAt
            ) / 1000
        );


    const mm =
        String(
            Math.floor(
                seconds / 60
            )
        ).padStart(
            2,
            "0"
        );


    const ss =
        String(
            seconds % 60
        ).padStart(
            2,
            "0"
        );


    sessionTimeEl.textContent =
        `${mm}:${ss}`;


    durationTextEl.textContent =
        `${mm}:${ss}`;


    requestAnimationFrame(
        updateClock
    );

}



/* START */

startButton.addEventListener(
    "click",
    startCamera
);