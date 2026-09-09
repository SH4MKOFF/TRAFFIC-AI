const video = document.getElementById("camera");
const canvas = document.getElementById("overlay");
const ctx = canvas.getContext("2d");

const button = document.getElementById("startCamera");
const statusText = document.getElementById("status");

const carCountElement = document.getElementById("carCount");
const trafficLevelElement = document.getElementById("trafficLevel");
const greenTimeElement = document.getElementById("greenTime");

let model = null;
let detecting = false;

const VEHICLES = [
    "car",
    "truck",
    "bus",
    "motorcycle"
];

async function startCamera() {

    try {

        statusText.textContent = "Запрашиваем камеру...";

        const stream = await navigator.mediaDevices.getUserMedia({
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

        statusText.textContent = "Камера работает";

        resizeCanvas();

        window.addEventListener("resize", resizeCanvas);

        await loadAI();

    } catch (error) {

        console.error(error);

        statusText.textContent =
            "Ошибка камеры: " + error.message;

    }
}


async function loadAI() {

    statusText.textContent =
        "Загружаем AI-модель...";

    try {

        model = await cocoSsd.load({
            base: "mobilenet_v2"
        });

        statusText.textContent =
            "AI готов — ищем автомобили";

        detecting = true;

        detectObjects();

    } catch (error) {

        console.error(error);

        statusText.textContent =
            "Ошибка загрузки AI";

    }
}


function resizeCanvas() {

    if (!video.videoWidth) {
        return;
    }

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
}


async function detectObjects() {

    if (!detecting || !model) {
        return;
    }

    try {

        const predictions = await model.detect(video);

        drawDetections(predictions);

    } catch (error) {

        console.error(error);

    }

    // Небольшая пауза для производительности iPhone
    setTimeout(detectObjects, 150);
}


function drawDetections(predictions) {

    ctx.clearRect(
        0,
        0,
        canvas.width,
        canvas.height
    );

    console.log("AI predictions:", predictions);

    const vehicles = predictions.filter(prediction => {

        return (
            VEHICLES.includes(prediction.class) &&
            prediction.score >= 0.25
        );

    });

    // Показываем все найденные объекты
    predictions.forEach(object => {

        const [x, y, width, height] =
            object.bbox;

        const confidence =
            Math.round(object.score * 100);

        ctx.strokeStyle =
            VEHICLES.includes(object.class)
                ? "#00ff66"
                : "#ffaa00";

        ctx.lineWidth = 3;

        ctx.strokeRect(
            x,
            y,
            width,
            height
        );

        ctx.fillStyle =
            VEHICLES.includes(object.class)
                ? "#00ff66"
                : "#ffaa00";

        ctx.font = "18px Arial";

        ctx.fillText(
            `${object.class} ${confidence}%`,
            x,
            Math.max(20, y - 6)
        );

    });

    updateTrafficStats(vehicles);

    statusText.textContent =
        `AI: найдено объектов ${predictions.length}, машин ${vehicles.length}`;
}


function updateTrafficStats(vehicles) {

    const count = vehicles.length;

    carCountElement.textContent = count;

    /*
        Пока используем простую модель загрузки.

        0 машин  = 0%
        10 машин = 100%

        Позже заменим это на настоящую
        оценку плотности и очереди.
    */

    const traffic =
        Math.min(100, count * 10);

    trafficLevelElement.textContent =
        traffic + "%";


    /*
        Чем больше машин,
        тем дольше зелёный.
    */

    let greenTime = 30;

    if (count >= 2) {
        greenTime = 35;
    }

    if (count >= 4) {
        greenTime = 40;
    }

    if (count >= 6) {
        greenTime = 50;
    }

    if (count >= 9) {
        greenTime = 60;
    }

    greenTimeElement.textContent =
        greenTime + " сек";
}


button.addEventListener(
    "click",
    startCamera
);