const $ = id => document.getElementById(id);

const video = $("video");
const canvas = $("overlay");
const ctx = canvas.getContext("2d");

const INTEREST = new Set([
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
]);

const LABELS = {
  person:"Людина",
  car:"Автомобіль",
  truck:"Вантажівка",
  bus:"Автобус",
  motorcycle:"Мотоцикл",
  bicycle:"Велосипед",
  dog:"Собака",
  cat:"Кіт",
  backpack:"Рюкзак",
  handbag:"Сумка",
  suitcase:"Валіза",
  "cell phone":"Телефон",
  laptop:"Ноутбук",
  bottle:"Пляшка",
  cup:"Чашка"
};

const ICONS = {
  person:"◉",
  car:"▰",
  truck:"▣",
  bus:"▤",
  motorcycle:"◇",
  bicycle:"⌁",
  dog:"◌",
  cat:"◌",
  backpack:"□",
  handbag:"□",
  suitcase:"▥",
  "cell phone":"▯",
  laptop:"▱",
  bottle:"♢",
  cup:"◡"
};

const state = {

  running:false,

  model:null,
  stream:null,
  zoomTrack:null,

  animation:0,
  detecting:false,
  lastDetection:0,

  tracks:[],
  nextID:1,

  archive:new Map(),
  events:[],

  moved:0,
  zoneEvents:0,

  sessionStart:null,

  sound:true,
  audio:null,

  graph:Array(48).fill(0),

  zone:{
    enabled:true,
    name:"DANGER ZONE",
    mode:"alert",

    points:[
      {x:.25,y:.25},
      {x:.75,y:.25},
      {x:.82,y:.76},
      {x:.18,y:.76}
    ]
  },

  editing:false,
  draftZone:null
};


/* ---------------- BASIC ---------------- */

function label(c){
  return LABELS[c] || c;
}

function icon(c){
  return ICONS[c] || "·";
}

function time(){
  return new Date().toLocaleTimeString(
    "uk-UA",
    {
      hour:"2-digit",
      minute:"2-digit",
      second:"2-digit"
    }
  );
}

function shortTime(){
  return new Date().toLocaleTimeString(
    "uk-UA",
    {
      hour:"2-digit",
      minute:"2-digit"
    }
  );
}

function dist(a,b){
  return Math.hypot(
    a.x-b.x,
    a.y-b.y
  );
}

function center(d){
  return {
    x:d.x+d.width/2,
    y:d.y+d.height/2
  };
}

function insidePolygon(point, polygon){

  let inside=false;

  for(
    let i=0,j=polygon.length-1;
    i<polygon.length;
    j=i++
  ){

    const xi=polygon[i].x;
    const yi=polygon[i].y;

    const xj=polygon[j].x;
    const yj=polygon[j].y;

    const hit=
      ((yi>point.y)!=(yj>point.y)) &&
      (
        point.x <
        (xj-xi) *
        (point.y-yi) /
        (yj-yi) +
        xi
      );

    if(hit) inside=!inside;
  }

  return inside;
}


/* ---------------- CLOCK ---------------- */

function clock(){
  $("clock").textContent=time();
}

clock();
setInterval(clock,1000);


/* ---------------- SESSION ---------------- */

function sessionDuration(){

  if(!state.sessionStart)
    return "00:00";

  let seconds=Math.floor(
    (Date.now()-state.sessionStart)/1000
  );

  const h=Math.floor(seconds/3600);

  seconds%=3600;

  const m=Math.floor(seconds/60);
  const s=seconds%60;

  if(h){

    return [
      String(h).padStart(2,"0"),
      String(m).padStart(2,"0"),
      String(s).padStart(2,"0")
    ].join(":");

  }

  return [
    String(m).padStart(2,"0"),
    String(s).padStart(2,"0")
  ].join(":");
}

setInterval(()=>{

  $("sessionHero").textContent=
    sessionDuration();

},1000);


/* ---------------- CANVAS ---------------- */

/*
  Ключевой фикс:

  canvas получает ТОЧНО такие же размеры,
  как реальное video.

  Поэтому bbox COCO-SSD,
  tracking и зона больше не съезжают
  при portrait / landscape.
*/

function resizeCanvas(){

  if(!video.videoWidth)
    return;

  canvas.width=video.videoWidth;
  canvas.height=video.videoHeight;

  $("resolution").textContent=
    `${video.videoWidth}×${video.videoHeight}`;

  $("cameraStage").style.aspectRatio=
    `${video.videoWidth}/${video.videoHeight}`;

  redraw();

}


/* ---------------- ZONE ---------------- */

function zonePixels(){

  return state.zone.points.map(p=>({
    x:p.x*canvas.width,
    y:p.y*canvas.height
  }));

}

function drawZone(){

  if(!state.zone.enabled &&
     !state.editing)
    return;

  const zone=
    state.editing
      ? state.draftZone
      : state.zone;

  const pts=zone.points.map(p=>({
    x:p.x*canvas.width,
    y:p.y*canvas.height
  }));

  ctx.save();

  ctx.beginPath();

  pts.forEach((p,i)=>{

    if(i===0)
      ctx.moveTo(p.x,p.y);
    else
      ctx.lineTo(p.x,p.y);

  });

  ctx.closePath();

  ctx.fillStyle=
    "rgba(118,255,182,.035)";

  ctx.fill();

  ctx.setLineDash([10,8]);

  ctx.lineWidth=
    state.editing ? 3 : 2;

  ctx.strokeStyle=
    "rgba(118,255,182,.78)";

  ctx.shadowColor=
    "rgba(118,255,182,.55)";

  ctx.shadowBlur=12;

  ctx.stroke();

  ctx.shadowBlur=0;
  ctx.setLineDash([]);

  if(state.editing){

    pts.forEach((p,i)=>{

      ctx.beginPath();

      ctx.arc(
        p.x,
        p.y,
        13,
        0,
        Math.PI*2
      );

      ctx.fillStyle=
        "rgba(4,14,9,.95)";

      ctx.fill();

      ctx.strokeStyle=
        "#76ffb6";

      ctx.lineWidth=2;

      ctx.stroke();

      ctx.fillStyle=
        "#76ffb6";

      ctx.font=
        "bold 9px monospace";

      ctx.textAlign="center";
      ctx.textBaseline="middle";

      ctx.fillText(
        String(i+1),
        p.x,
        p.y
      );

    });

  }
  else{

    const x=
      pts.reduce((a,p)=>a+p.x,0) /
      pts.length;

    const y=
      pts.reduce((a,p)=>a+p.y,0) /
      pts.length;

    ctx.fillStyle=
      "rgba(118,255,182,.9)";

    ctx.font=
      "bold 10px monospace";

    ctx.textAlign="center";

    ctx.fillText(
      state.zone.name,
      x,
      Math.max(14,y)
    );

  }

  ctx.restore();

}


/* ---------------- OBJECT BOXES ---------------- */

function drawBox(d){

  const x=d.x;
  const y=d.y;
  const w=d.width;
  const h=d.height;

  const l=
    Math.max(
      10,
      Math.min(w,h)*.2
    );

  ctx.strokeStyle=
    "#76ffb6";

  ctx.lineWidth=
    Math.max(
      1.5,
      canvas.width/720
    );

  ctx.beginPath();

  ctx.moveTo(x,y+l);
  ctx.lineTo(x,y);
  ctx.lineTo(x+l,y);

  ctx.moveTo(x+w-l,y);
  ctx.lineTo(x+w,y);
  ctx.lineTo(x+w,y+l);

  ctx.moveTo(x,y+h-l);
  ctx.lineTo(x,y+h);
  ctx.lineTo(x+l,y+h);

  ctx.moveTo(x+w-l,y+h);
  ctx.lineTo(x+w,y+h);
  ctx.lineTo(x+w,y+h-l);

  ctx.stroke();

}


/* ---------------- REDRAW ---------------- */

function redraw(){

  ctx.clearRect(
    0,
    0,
    canvas.width,
    canvas.height
  );

  drawZone();

  state.tracks.forEach(track=>{

    const d=track.bbox;

    const c=center(d);

    const inside=
      insidePolygon(
        c,
        zonePixels()
      );

    ctx.save();

    if(inside){

      ctx.strokeStyle=
        "#ffc857";

      ctx.shadowColor=
        "rgba(255,200,87,.7)";

      ctx.shadowBlur=12;

    }

    drawBox(d);

    ctx.restore();


    const text=
      `${label(track.class).toUpperCase()} `+
      `${Math.round(track.score*100)}%`;

    ctx.font=
      "700 10px monospace";

    const width=
      ctx.measureText(text).width+10;

    ctx.fillStyle=
      inside
        ? "#ffc857"
        : "#76ffb6";

    ctx.fillRect(
      d.x,
      Math.max(0,d.y-19),
      width,
      19
    );

    ctx.fillStyle="#03100a";

    ctx.fillText(
      text,
      d.x+5,
      Math.max(12,d.y-6)
    );


    ctx.fillStyle=
      inside
        ? "#ffc857"
        : "#76ffb6";

    ctx.font=
      "9px monospace";

    ctx.fillText(
      `ID ${String(track.id).padStart(2,"0")} ${track.direction}`,
      d.x+d.width+5,
      Math.max(10,d.y+11)
    );

  });

}


/* ---------------- TRACKING ---------------- */

function direction(dx,dy){

  if(Math.hypot(dx,dy)<8)
    return "—";

  if(Math.abs(dx)>Math.abs(dy))
    return dx>0 ? "→" : "←";

  return dy>0 ? "↓" : "↑";

}


function updateTracks(detections){

  const used=new Set();
  const newTracks=[];

  detections.forEach(det=>{

    const c=center(det);

    let best=null;
    let bestDistance=Infinity;

    state.tracks.forEach(track=>{

      if(used.has(track.id))
        return;

      if(track.class!==det.class)
        return;

      const d=
        dist(c,track.center);

      if(
        d<bestDistance &&
        d<Math.max(
          80,
          canvas.width*.08
        )
      ){

        best=track;
        bestDistance=d;

      }

    });


    if(best){

      used.add(best.id);

      const dx=
        c.x-best.center.x;

      const dy=
        c.y-best.center.y;

      const movement=
        Math.hypot(dx,dy);

      if(
        movement>
        Math.max(20,canvas.width*.022)
      ){

        if(!best.moved){

          best.moved=true;
          state.moved++;

          addEvent(
            best,
            "РУХ",
            "Об'єкт змінив позицію",
            false
          );

        }

      }


      const previousInside=
        best.inside;

      const currentInside=
        insidePolygon(
          c,
          zonePixels()
        );


      best.center=c;
      best.bbox=det;
      best.lastSeen=performance.now();
      best.direction=
        direction(dx,dy);

      best.inside=
        currentInside;


      if(
        state.zone.enabled &&
        currentInside &&
        !previousInside
      ){

        best.crossed=true;
        state.zoneEvents++;

        addEvent(
          best,
          state.zone.mode==="alert"
            ? "ЗОНА"
            : "ВХІД",
          `${state.zone.name} · ${label(best.class)}`,
          true
        );

        alertSignal();

      }


      newTracks.push(best);

      updateArchive(best);

    }
    else{

      const track={

        id:state.nextID++,

        class:det.class,

        score:det.score,

        bbox:det,

        center:c,

        firstSeen:performance.now(),

        lastSeen:performance.now(),

        moved:false,

        crossed:false,

        inside:insidePolygon(
          c,
          zonePixels()
        ),

        direction:"—"

      };

      newTracks.push(track);

      createArchive(track);

      addEvent(
        track,
        "ВИЯВЛЕНО",
        label(track.class),
        false
      );

    }

  });


  state.tracks=newTracks;

  updateStats(detections);

}


/* ---------------- ARCHIVE ---------------- */

function snapshot(det){

  if(!video.videoWidth)
    return "";

  const padding=
    Math.round(
      Math.max(
        det.width,
        det.height
      )*.14
    );

  const sx=
    Math.max(
      0,
      Math.floor(det.x-padding)
    );

  const sy=
    Math.max(
      0,
      Math.floor(det.y-padding)
    );

  const sw=
    Math.min(
      video.videoWidth-sx,
      Math.floor(
        det.width+padding*2
      )
    );

  const sh=
    Math.min(
      video.videoHeight-sy,
      Math.floor(
        det.height+padding*2
      )
    );

  const c=
    document.createElement("canvas");

  c.width=
    Math.min(sw,720);

  c.height=
    Math.round(
      sh*(c.width/sw)
    );

  c.getContext("2d")
   .drawImage(
     video,
     sx,sy,sw,sh,
     0,0,c.width,c.height
   );

  return c.toDataURL(
    "image/jpeg",
    .78
  );

}


function createArchive(track){

  state.archive.set(
    track.id,
    {
      id:track.id,

      type:track.class,

      confidence:track.score,

      firstSeen:new Date().toISOString(),

      lastSeen:new Date().toISOString(),

      moved:false,

      crossed:false,

      direction:"—",

      image:snapshot(track.bbox)
    }
  );

  saveArchive();
  renderArchive();

}


function updateArchive(track){

  const a=
    state.archive.get(track.id);

  if(!a)
    return;

  a.lastSeen=
    new Date().toISOString();

  a.moved=track.moved;

  a.crossed=track.crossed;

  a.direction=track.direction;

  state.archive.set(
    track.id,
    a
  );

  saveArchive();

}


/* ---------------- EVENTS ---------------- */

function addEvent(
  track,
  type,
  detail,
  alert=false
){

  state.events.unshift({

    time:shortTime(),

    type,

    detail,

    id:track.id,

    alert:alert
      ? "alert"
      : type==="РУХ"
        ? "warn"
        : ""

  });

  if(state.events.length>60)
    state.events.length=60;


  $("lastEventTitle").textContent=
    type;

  $("lastEventText").textContent=
    `${detail} · ID ${String(track.id).padStart(2,"0")}`;

  $("lastEventTime").textContent=
    shortTime();


  renderEvents();


  state.graph[
    state.graph.length-1
  ]++;

  renderGraph();

}


function renderEvents(){

  const el=$("eventLog");

  if(!state.events.length){

    el.innerHTML=
      `<div class="empty">
        Подій ще немає.
      </div>`;

    return;
  }


  el.innerHTML=
    state.events
      .slice(0,35)
      .map(e=>`

        <div class="event-row ${e.alert}">

          <span class="event-bar"></span>

          <span class="event-time">
            ${e.time}
          </span>

          <span>
            <span class="event-main">
              ${e.type}
            </span>

            <span class="event-detail">
              · ${e.detail}
            </span>
          </span>

          <span class="event-id">
            #${String(e.id).padStart(2,"0")}
          </span>

        </div>

      `)
      .join("");

}


/* ---------------- GRAPH ---------------- */

function renderGraph(){

  const max=
    Math.max(
      1,
      ...state.graph
    );

  $("graphTotal").textContent=
    state.graph.reduce(
      (a,b)=>a+b,
      0
    );

  $("activityBars").innerHTML=
    state.graph
      .map(v=>`

        <span
          class="bar ${v===max && v>0 ? "hot":""}"
          style="
            height:
            ${Math.max(
              4,
              (v/max)*100
            )}%
          "
        ></span>

      `)
      .join("");

}


/* ---------------- OBJECTS ---------------- */

function renderObjects(detections){

  const counts={};

  detections.forEach(d=>{

    counts[d.class]=
      (counts[d.class]||0)+1;

  });


  const classes=
    Object.keys(counts)
      .sort(
        (a,b)=>
          counts[b]-counts[a]
      );


  $("objectMini").textContent=
    detections.length;


  if(!classes.length){

    $("objectList").innerHTML=
      `<div class="empty">
        Очікування об'єктів…
      </div>`;

    return;

  }


  $("objectList").innerHTML=
    classes.map(c=>`

      <div class="object-row">

        <div class="object-icon">
          ${icon(c)}
        </div>

        <div>

          <div class="object-name">
            ${label(c)}
          </div>

          <div class="object-sub">
            ${counts[c]===1
              ? "активний об'єкт"
              : "активні об'єкти"}
          </div>

        </div>

        <div class="object-count">
          ${String(counts[c]).padStart(2,"0")}
        </div>

      </div>

    `).join("");

}


/* ---------------- STATS ---------------- */

function updateStats(detections){

  $("visibleCount").textContent=
    detections.length;

  $("visibleHero").textContent=
    String(
      detections.length
    ).padStart(2,"0");

  $("uniqueCount").textContent=
    state.archive.size;

  $("movedCount").textContent=
    state.moved;

  $("crossedCount").textContent=
    state.zoneEvents;

  $("objectBadge").textContent=
    `${detections.length} OBJECT${detections.length===1?"":"S"}`;

  $("zoneHero").textContent=
    state.zone.enabled
      ? "ARMED"
      : "OFF";

  renderObjects(detections);

}


/* ---------------- CAMERA ---------------- */

async function startCamera(){

  if(state.running)
    return;


  try{

    setStatus(
      false,
      "ПІДКЛЮЧЕННЯ КАМЕРИ…"
    );

    $("startText").textContent=
      "ПІДКЛЮЧЕННЯ…";


    state.stream=
      await navigator.mediaDevices
        .getUserMedia({

          video:{
            facingMode:{
              ideal:"environment"
            },

            width:{
              ideal:1280
            },

            height:{
              ideal:720
            }
          },

          audio:false

        });


    video.srcObject=
      state.stream;


    await video.play();


    resizeCanvas();


    state.running=true;

    state.sessionStart=
      Date.now();

    state.tracks=[];
    state.nextID=1;

    state.moved=0;
    state.zoneEvents=0;

    state.events=[];

    state.graph=
      Array(48).fill(0);


    renderEvents();
    renderGraph();
    updateStats([]);


    $("cameraEmpty").style.display=
      "none";

    $("startText").textContent=
      "ЗУПИНИТИ СКАНУВАННЯ";

    $("startIcon").textContent=
      "■";

    $("cameraStage")
      .classList
      .add("scanning");


    setStatus(
      true,
      "СИСТЕМА ONLINE"
    );


    await setupZoom();

    await loadAI();

  }
  catch(error){

    console.error(error);

    stopCamera(false);

    setStatus(
      false,
      "КАМЕРА НЕДОСТУПНА"
    );

    $("startText").textContent=
      "СПРОБУВАТИ ЩЕ РАЗ";

    alert(
      "Не вдалося відкрити камеру.\n\n" +
      "Перевір дозвіл браузера на камеру " +
      "та HTTPS."
    );

  }

}


async function loadAI(){

  $("aiState").textContent=
    "AI LOADING";

  $("hudAi").textContent=
    "AI / LOADING";


  try{

    state.model=
      await cocoSsd.load({
        base:"mobilenet_v2"
      });


    $("aiState").textContent=
      "AI ONLINE";

    $("hudAi").textContent=
      "AI / ONLINE";


    systemEvent(
      "AI ГОТОВИЙ",
      "Модель завантажена локально."
    );


    requestAnimationFrame(loop);

  }
  catch(error){

    console.error(error);

    $("aiState").textContent=
      "AI ERROR";

    $("hudAi").textContent=
      "AI / ERROR";

    systemEvent(
      "AI ПОМИЛКА",
      "Не вдалося завантажити модель."
    );

  }

}


/* ---------------- DETECTION ---------------- */

async function detect(){

  if(
    !state.running ||
    !state.model ||
    state.detecting ||
    video.readyState<2
  )
    return;


  state.detecting=true;


  try{

    const result=
      await state.model.detect(
        video,
        20,
        .25
      );


    const detections=
      result.filter(
        d=>INTEREST.has(d.class)
      );


    updateTracks(detections);

    redraw();

  }
  catch(error){

    console.warn(error);

  }
  finally{

    state.detecting=false;

  }

}


function loop(timestamp){

  if(!state.running)
    return;


  state.animation=
    requestAnimationFrame(loop);


  if(
    timestamp-state.lastDetection >
    170
  ){

    state.lastDetection=
      timestamp;

    detect();

  }

}


/* ---------------- STOP ---------------- */

function stopCamera(showEvent=true){

  state.running=false;

  cancelAnimationFrame(
    state.animation
  );

  state.model=null;

  state.tracks=[];


  if(state.stream){

    state.stream
      .getTracks()
      .forEach(
        track=>track.stop()
      );

  }


  state.stream=null;
  state.zoomTrack=null;


  video.srcObject=null;

  ctx.clearRect(
    0,
    0,
    canvas.width,
    canvas.height
  );


  $("cameraEmpty").style.display=
    "flex";

  $("startText").textContent=
    "ПОЧАТИ СКАНУВАННЯ";

  $("startIcon").textContent=
    "◉";

  $("cameraStage")
    .classList
    .remove("scanning");


  $("aiState").textContent=
    "AI OFFLINE";

  $("hudAi").textContent=
    "AI / STANDBY";


  $("zoomSlider").disabled=true;

  $("zoomValue").textContent=
    "1.0×";


  if(showEvent){

    setStatus(
      false,
      "СИСТЕМА ГОТОВА"
    );

    systemEvent(
      "СЕСІЯ ЗАВЕРШЕНА",
      "Камеру вимкнено."
    );

  }

}


$("startBtn").addEventListener(
  "click",
  ()=>{
    state.running
      ? stopCamera()
      : startCamera();
  }
);


/* ---------------- ZOOM ---------------- */

async function setupZoom(){

  const track=
    state.stream
      ?.getVideoTracks?.()[0];

  state.zoomTrack=track||null;


  if(
    !track ||
    !track.getCapabilities
  ){

    $("zoomSlider").disabled=true;
    return;

  }


  const cap=
    track.getCapabilities();


  if(!cap.zoom){

    $("zoomSlider").disabled=true;

    $("zoomValue").textContent=
      "N/A";

    return;

  }


  $("zoomSlider").disabled=false;

  $("zoomSlider").min=
    cap.zoom.min;

  $("zoomSlider").max=
    cap.zoom.max;


  const current=
    track.getSettings().zoom ??
    cap.zoom.min;


  $("zoomSlider").value=
    current;

  $("zoomValue").textContent=
    `${Number(current).toFixed(1)}×`;

}


async function setZoom(value){

  if(
    !state.zoomTrack ||
    !state.zoomTrack.applyConstraints
  )
    return;


  try{

    const v=
      Number(value);

    const constraints=
      state.zoomTrack
        .getConstraints?.() || {};


    await state.zoomTrack
      .applyConstraints({

        ...constraints,

        advanced:[
          ...(constraints.advanced||[]),
          {zoom:v}
        ]

      });


    $("zoomValue").textContent=
      `${v.toFixed(1)}×`;

  }
  catch{

    $("zoomValue").textContent=
      "N/A";

  }

}


$("zoomSlider")
  .addEventListener(
    "input",
    e=>setZoom(e.target.value)
  );


$("zoomMinus")
  .addEventListener(
    "click",
    ()=>{
      setZoom(
        Number($("zoomSlider").value)-.1
      );
    }
  );


$("zoomPlus")
  .addEventListener(
    "click",
    ()=>{
      setZoom(
        Number($("zoomSlider").value)+.1
      );
    }
  );


/* ---------------- STATUS ---------------- */

function setStatus(online,text){

  $("systemStatus")
    .classList
    .toggle(
      "online",
      online
    );

  $("systemStatus")
    .querySelector("span")
    .textContent=text;

}


function systemEvent(type,text){

  state.events.unshift({

    time:shortTime(),

    type,

    detail:text,

    id:0,

    alert:""

  });

  renderEvents();

  $("lastEventTitle").textContent=
    type;

  $("lastEventText").textContent=
    text;

  $("lastEventTime").textContent=
    shortTime();

}


/* ---------------- ALERT ---------------- */

function alertSignal(){

  if(
    navigator.vibrate
  ){

    navigator.vibrate([
      80,
      45,
      120
    ]);

  }


  if(!state.sound)
    return;


  try{

    if(!state.audio){

      state.audio=
        new (
          window.AudioContext ||
          window.webkitAudioContext
        )();

    }


    const oscillator=
      state.audio.createOscillator();

    const gain=
      state.audio.createGain();


    oscillator.type="sine";

    oscillator.frequency.value=
      880;


    gain.gain.setValueAtTime(
      .0001,
      state.audio.currentTime
    );


    gain.gain.exponentialRampToValueAtTime(
      .08,
      state.audio.currentTime+.015
    );


    gain.gain.exponentialRampToValueAtTime(
      .0001,
      state.audio.currentTime+.22
    );


    oscillator.connect(gain);

    gain.connect(
      state.audio.destination
    );


    oscillator.start();

    oscillator.stop(
      state.audio.currentTime+.24
    );

  }
  catch{}

}


$("soundBtn").addEventListener(
  "click",
  ()=>{

    state.sound=
      !state.sound;

    $("soundIcon").textContent=
      state.sound ? "◒" : "◌";

  }
);


/* ---------------- ZONE EDITOR ---------------- */

function openZone(){

  state.draftZone=
    JSON.parse(
      JSON.stringify(state.zone)
    );

  state.editing=true;


  $("zoneEnabled").checked=
    state.draftZone.enabled;

  $("zoneName").value=
    state.draftZone.name;

  $("zoneMode").value=
    state.draftZone.mode;


  $("zoneModal")
    .classList
    .add("open");


  redraw();

}


function closeZone(){

  state.editing=false;
  state.draftZone=null;

  $("zoneModal")
    .classList
    .remove("open");

  redraw();

}


$("zoneBtn")
  .addEventListener(
    "click",
    openZone
  );

$("closeZone")
  .addEventListener(
    "click",
    closeZone
  );

$("cancelZone")
  .addEventListener(
    "click",
    closeZone
  );


$("saveZone")
  .addEventListener(
    "click",
    ()=>{

      state.draftZone.enabled=
        $("zoneEnabled").checked;

      state.draftZone.name=
        $("zoneName")
          .value
          .trim() ||
        "DANGER ZONE";

      state.draftZone.mode=
        $("zoneMode").value;


      state.zone=
        state.draftZone;


      localStorage.setItem(
        "ghost-zone",
        JSON.stringify(state.zone)
      );


      closeZone();


      systemEvent(
        "ЗОНУ ЗБЕРЕЖЕНО",
        `${state.zone.name} · ${
          state.zone.enabled
            ? "АКТИВНА"
            : "ВИМКНЕНА"
        }`
      );

    }
  );


/* DRAG ZONE POINTS */

let dragPoint=-1;


canvas.addEventListener(
  "pointerdown",
  e=>{

    if(!state.editing)
      return;


    const r=
      canvas.getBoundingClientRect();


    const x=
      (e.clientX-r.left)/r.width;

    const y=
      (e.clientY-r.top)/r.height;


    let best=-1;
    let bestDistance=.08;


    state.draftZone.points
      .forEach((p,i)=>{

        const d=
          Math.hypot(
            p.x-x,
            p.y-y
          );


        if(d<bestDistance){

          best=i;
          bestDistance=d;

        }

      });


    dragPoint=best;

    canvas.setPointerCapture(
      e.pointerId
    );

  }
);


canvas.addEventListener(
  "pointermove",
  e=>{

    if(
      !state.editing ||
      dragPoint<0
    )
      return;


    const r=
      canvas.getBoundingClientRect();


    state.draftZone.points[
      dragPoint
    ]={

      x:Math.min(
        .98,
        Math.max(
          .02,
          (e.clientX-r.left)/r.width
        )
      ),

      y:Math.min(
        .98,
        Math.max(
          .02,
          (e.clientY-r.top)/r.height
        )
      )

    };


    redraw();

  }
);


["pointerup","pointercancel"]
.forEach(event=>{

  canvas.addEventListener(
    event,
    ()=>{
      dragPoint=-1;
    }
  );

});


/* ---------------- CLEAR ---------------- */

$("clearEvents")
  .addEventListener(
    "click",
    ()=>{

      state.events=[];

      renderEvents();

      $("lastEventTitle").textContent=
        "Журнал очищено";

      $("lastEventText").textContent=
        "Нові події зʼявляться тут.";

    }
  );


$("clearArchive")
  .addEventListener(
    "click",
    ()=>{

      if(
        !confirm(
          "Очистити локальний архів цілей?"
        )
      )
        return;


      state.archive.clear();

      localStorage.removeItem(
        "ghost-archive"
      );

      renderArchive();

      updateStats([]);

    }
  );


/* ---------------- LOCAL STORAGE ---------------- */

function saveArchive(){

  try{

    localStorage.setItem(
      "ghost-archive",
      JSON.stringify(
        [...state.archive.values()]
          .slice(-80)
      )
    );

  }
  catch{}

}


function loadArchive(){

  try{

    const data=
      JSON.parse(
        localStorage.getItem(
          "ghost-archive"
        )
      ) || [];


    data.forEach(item=>{
      state.archive.set(
        item.id,
        item
      );
    });

  }
  catch{}

}


function loadZone(){

  try{

    const zone=
      JSON.parse(
        localStorage.getItem(
          "ghost-zone"
        )
      );


    if(
      zone &&
      zone.points &&
      zone.points.length===4
    ){

      state.zone={
        ...state.zone,
        ...zone
      };

    }

  }
  catch{}

}


/* ---------------- ARCHIVE UI ---------------- */

function renderArchive(){

  const list=
    [...state.archive.values()]
      .slice(-18)
      .reverse();


  if(!list.length){

    $("archiveGrid").innerHTML=
      `<div class="empty">
        Після першого виявлення тут
        з'являться знімки цілей.
      </div>`;

    return;

  }


  $("archiveGrid").innerHTML=
    list.map(item=>`

      <article class="archive-card">

        ${
          item.image
            ? `<img src="${item.image}">`
            : ""
        }

        <div class="archive-body">

          <div class="archive-type">

            #${String(item.id).padStart(2,"0")}
            ·
            ${label(item.type)}

          </div>

          <div class="archive-meta">

            ${Math.round(item.confidence*100)}%
            ·
            ${item.moved?"РУХ":"СТАТИКА"}
            ·
            ${item.crossed?"ЗОНА":"—"}
            ·
            ${item.direction}

          </div>

        </div>

      </article>

    `).join("");

}


/* ---------------- EXPORT ---------------- */

$("saveSession")
  .addEventListener(
    "click",
    ()=>{

      const items=
        [...state.archive.values()];


      if(!items.length){

        alert(
          "Архів порожній."
        );

        return;

      }


      const cards=
        items.map(item=>`

          <article>

            ${
              item.image
                ? `<img src="${item.image}">`
                : ""
            }

            <b>
              #${String(item.id).padStart(2,"0")}
              ·
              ${label(item.type)}
            </b>

            <small>
              confidence
              ${Math.round(item.confidence*100)}%
              ·
              ${item.moved?"moved":"static"}
              ·
              ${item.crossed?"zone":"—"}
              ·
              ${item.direction}
            </small>

          </article>

        `).join("");


      const html=`

<!doctype html>

<html>

<head>

<meta charset="utf-8">

<title>GHOST SESSION</title>

<style>

body{
  margin:0;
  padding:25px;
  background:#06100d;
  color:#ecfff4;
  font-family:monospace;
}

h1{
  color:#76ffb6;
}

main{
  display:grid;
  grid-template-columns:
    repeat(auto-fill,minmax(220px,1fr));
  gap:15px;
}

article{
  padding:10px;
  border:1px solid #244437;
  border-radius:12px;
  background:#0b1713;
}

img{
  width:100%;
  aspect-ratio:1.25;
  object-fit:cover;
}

b,
small{
  display:block;
  margin-top:8px;
}

small{
  color:#789188;
}

</style>

</head>

<body>

<h1>
GHOST // VISION
</h1>

<p>
SESSION ARCHIVE ·
${new Date().toLocaleString("uk-UA")}
</p>

<main>
${cards}
</main>

</body>

</html>
`;


      const blob=
        new Blob(
          [html],
          {
            type:"text/html"
          }
        );


      const a=
        document.createElement("a");


      a.href=
        URL.createObjectURL(blob);

      a.download=
        `GHOST_SESSION_${Date.now()}.html`;

      a.click();


      setTimeout(
        ()=>{
          URL.revokeObjectURL(a.href);
        },
        1000
      );

    }
  );


/* ---------------- GRAPH TIMER ---------------- */

setInterval(
  ()=>{

    if(!state.running)
      return;

    state.graph.shift();
    state.graph.push(0);

    renderGraph();

  },
  3000
);


/* ---------------- RESIZE ---------------- */

window.addEventListener(
  "resize",
  resizeCanvas
);

window.addEventListener(
  "orientationchange",
  ()=>{
    setTimeout(
      resizeCanvas,
      300
    );
  }
);


/* ---------------- PWA ---------------- */

if(
  "serviceWorker" in navigator
){

  navigator.serviceWorker
    .register("./sw.js")
    .catch(()=>{});

}


/* ---------------- INIT ---------------- */

loadZone();

loadArchive();

renderArchive();

renderGraph();

updateStats([]);