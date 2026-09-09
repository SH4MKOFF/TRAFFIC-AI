const video = document.getElementById("camera");
const button = document.getElementById("startCamera");
const statusText = document.getElementById("status");

const red = document.getElementById("red");
const yellow = document.getElementById("yellow");
const green = document.getElementById("green");

const timerElement = document.getElementById("timer");

button.addEventListener("click", async () => {

    try {

        const stream = await navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: {
                    ideal: "environment"
                }
            },
            audio: false
        });

        video.srcObject = stream;

        statusText.textContent = "Камера работает";

        startTrafficLight();

    } catch (error) {

        console.error(error);

        statusText.textContent =
            "Не удалось получить доступ к камере";

    }

});


function setLight(light) {

    red.classList.remove("active");
    yellow.classList.remove("active");
    green.classList.remove("active");

    light.classList.add("active");
}


function startTrafficLight() {

    let phase = "green";
    let time = 30;

    setLight(green);

    setInterval(() => {

        time--;

        timerElement.textContent = time;

        if (time <= 0) {

            if (phase === "green") {

                phase = "yellow";
                time = 3;

                setLight(yellow);

            } else if (phase === "yellow") {

                phase = "red";
                time = 30;

                setLight(red);

            } else {

                phase = "green";
                time = 30;

                setLight(green);

            }

        }

    }, 1000);
}