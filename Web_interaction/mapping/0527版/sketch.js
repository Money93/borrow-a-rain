// 連接到本機的 TouchDesigner 伺服器
const socket = new WebSocket('ws://127.0.0.1:9980');

function onTrackingUpdate(trackedX, trackedY) {
    if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ x: trackedX, y: trackedY }));
    }
}

let video;
let points = [];
let smoothX = 0;
let smoothY = 0;
let umbrellaAngle = 0;
let currentScene = 1;
let lastScene = 1;
let frame;
let lastSwitchTime = 0;
let switchCooldown = 1200;


let currentPage = 1;

const pages = {
    1: "scene1.html",
    2: "page2.html",
    3: "page3.html"
};

// Web Serial 相關變數
let port;
let reader;
let connectBtn;
let latestData = "0"; // 預設為 0
let lastData = "0";   // 用來記錄上一次的狀態，防止重複觸發播放

// 音樂相關變數
let rainSound;
let guitarSound;

// p5.js 特有函式：進入 setup 前先載入音檔
function preload() {
    // 請確保音檔路徑正確
    rainSound = loadSound('rain.mp3');
    guitarSound = loadSound('guitar.mp3');
}

// 確保最上方有這三個變數
let currentFrame;
let nextFrame;
let isFrameAActive = true; 

function setup() {
    createCanvas(windowWidth, windowHeight);
    
    // 正確抓取 HTML 裡的兩個 iframe
    currentFrame = select('#frameA');
    nextFrame = select('#frameB');

    // 建立序列埠連接按鈕 (補上原本可能被省略的按鈕初始化)
    connectBtn = createButton('連接 Arduino');
    connectBtn.position(20, height - 40);
    connectBtn.mousePressed(connectSerial);

    // 取得視訊裝置
    navigator.mediaDevices.enumerateDevices().then(gotDevices);
}

function switchScene(sceneNumber) {
    // 1. 默默讓幕後的 iframe 去載入新網頁，此時它在幕後是 opacity: 0
    nextFrame.attribute('src', pages[sceneNumber]);
    
    // 這裡「不要」寫 onload，我們把主導權交給子網頁！
}

// 2. 核心：監聽來自子網頁（iframe 內部）發送的「我畫好第一幀了」訊號
window.addEventListener('message', function(event) {
    // 確保收到的是切換訊號
    if (event.data === 'canvas-ready') {
        
        // 雙方 class 對調，觸發 CSS transition 淡入淡出
        currentFrame.removeClass('active');
        nextFrame.addClass('active');

        currentFrame.style('pointer-events', 'none');
        nextFrame.style('pointer-events', 'auto');

        // 身份互換，為下一次切換做準備
        isFrameAActive = !isFrameAActive;
        if (isFrameAActive) {
            currentFrame = select('#frameA');
            nextFrame = select('#frameB');
        } else {
            currentFrame = select('#frameB');
            nextFrame = select('#frameA');
        }
    }
});

// 監聽並讀取 Arduino 數據
async function connectSerial() {
    try {
        // 觸發音訊環境 (AudioContext)，確保點擊按鈕後音樂功能啟用
        userStartAudio();

        port = await navigator.serial.requestPort();
        await port.open({ baudRate: 9600 });
        connectBtn.html('Arduino 已連接');
        connectBtn.attribute('disabled', 'true');

        const decoder = new TextDecoderStream();
        port.readable.pipeTo(decoder.writable);
        const inputStream = decoder.readable;
        reader = inputStream.getReader();

        // 開始播放預設的吉他聲（因為一開始 latestData 預設是 0）
        guitarSound.play();

        readLoop();
    } catch (err) {
        console.error('序列埠連接失敗:', err);
    }
}

async function readLoop() {
    let buffer = "";
    while (true) {
        const { value, done } = await reader.read();
        if (done) {
            reader.releaseLock();
            break;
        }
        if (value) {
            buffer += value;
            let lines = buffer.split('\r\n');
            buffer = lines.pop();

            if (lines.length > 0) {
                let cleanData = lines[lines.length - 1].trim();
                if (cleanData === "0" || cleanData === "1") {
                    latestData = cleanData;
                }
            }
        }
    }
}

function gotDevices(deviceInfos) {
    let videoDevices = [];
    for (let i = 0; i < deviceInfos.length; i++) {
        let device = deviceInfos[i];
        if (device.kind === 'videoinput') {
            videoDevices.push(device);
        }
    }
    let preferredCamera = videoDevices[1] || videoDevices[0];
    video = createCapture({
        video: { deviceId: preferredCamera.deviceId }
    });
    video.size(640, 480);
    video.hide();
}

function draw() {
    background(0);
//偵測 Arduino 狀態改變，切換畫面與聲音
    if (latestData !== lastData) {
        if (latestData === "1") {
            // 1 的時候：畫面全黑，播雨聲
            // 找出當前畫面上真正有 active 的那個 iframe，讓它淡出
            let activeEl = select('.projectFrame.active');
            if (activeEl) activeEl.style('opacity', '0');

            guitarSound.stop(); 
            if (!rainSound.isPlaying()) {
                rainSound.play(); 
            }
        } else {
            // 0 的時候：恢復有畫面，播吉他聲
            // 清除行內樣式，讓它回歸 CSS 的 class (.active) 來決定顯示
            let activeEl = select('.projectFrame.active');
            if (activeEl) activeEl.style('opacity', ''); 

            rainSound.stop(); 
            if (!guitarSound.isPlaying()) {
                guitarSound.play(); 
            }
        }
        lastData = latestData;
    }

    video.loadPixels();
    points = [];

    // 找綠點
    for (let y = 0; y < video.height; y += 4) {
        for (let x = 0; x < video.width; x += 4) {
            let index = (x + y * video.width) * 4;
            let r = video.pixels[index + 0];
            let g = video.pixels[index + 1];
            let b = video.pixels[index + 2];

            if (g > 90 && g > r + 20 && g > b + 20) {
                points.push({
                    x: x,
                    y: y,
                    brightness: g
                });
            }
        }
    }

    // 找兩個綠點

    if (points.length > 10) {

        // 按照亮度排序

        points.sort(
            (a, b) =>
                b.brightness - a.brightness
        );

        // 最亮點

        let p1 = points[0];

        // 找離 p1 最遠的點

        let p2 = p1;

        let maxDist = 0;

        for (let p of points) {

            let d = dist(
                p1.x,
                p1.y,
                p.x,
                p.y
            );

            if (d > maxDist) {

                maxDist = d;
                p2 = p;
            }
        }

        // 中心

        let targetX =
            (p1.x + p2.x) / 2;

        let targetY =
            (p1.y + p2.y) / 2;

        smoothX = lerp(
            smoothX,
            targetX,
            0.1
        );

        smoothY = lerp(
            smoothY,
            targetY,
            0.1
        );

        //算旋轉角度

        umbrellaAngle = degrees(

            atan2(
                p2.y - p1.y,
                p2.x - p1.x
            )

        );

        // 轉成 0~360

        if (umbrellaAngle < 0) {

            umbrellaAngle += 360;
        }

        // 三個場景

        if (
            umbrellaAngle >= 10 &&
            umbrellaAngle < 110
        ) {

            currentScene = 1;
        }

        else if (
            umbrellaAngle >= 130 &&
            umbrellaAngle < 230
        ) {

            currentScene = 2;
        }

        else if (
            umbrellaAngle >= 250 &&
            umbrellaAngle < 350
        ) {

            currentScene = 3;
        }

        // HTML 場景切換

        if (
            currentScene != lastScene &&
            millis() - lastSwitchTime > switchCooldown
        ) {
        
            switchScene(currentScene);
        
            lastScene = currentScene;
        
            lastSwitchTime = millis();
        }

        // Debug

        fill(255, 0, 0);

        circle(
            map(p1.x, 0, video.width, 20, 340),
            map(p1.y, 0, video.height, 20, 260),
            12
        );

        fill(0, 0, 255);

        circle(
            map(p2.x, 0, video.width, 20, 340),
            map(p2.y, 0, video.height, 20, 260),
            12
        );

        fill(255);

        textSize(24);

        text(
            "Angle: " +
            nf(umbrellaAngle, 1, 1),

            20,
            300
        );

        text(
            "Scene: " +
            currentScene,

            20,
            340
        );
    }

    // Debug 畫面
    image(video, 20, 20, 320, 240);
    fill(0, 255, 0);
    noStroke();
    for (let p of points) {
        circle(
            map(p.x, 0, video.width, 20, 340),
            map(p.y, 0, video.height, 20, 260),
            4
        );
    }

    fill(255, 0, 0);
    circle(
        map(smoothX, 0, video.width, 20, 340),
        map(smoothY, 0, video.height, 20, 260),
        15
    );

    // 發送給 TouchDesigner
    let tx = smoothX / video.width;
    let ty = smoothY / video.height;
    onTrackingUpdate(tx, ty);
}


function windowResized() {
    resizeCanvas(windowWidth, windowHeight);
    if (connectBtn) connectBtn.position(20, height - 40);
}