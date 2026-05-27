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

function setup() {
    createCanvas(windowWidth, windowHeight);
    frame = select('#projectFrame');

    // 設定音樂循環播放（這樣聲音才不會放一下就沒了）
    rainSound.setLoop(true);
    guitarSound.setLoop(true);

    // 建立一個按鈕用來連接 Arduino 
    // 瀏覽器規定：必須由使用者點擊網頁後，網頁才被允許發出聲音與連接 Serial
    connectBtn = createButton('連接 Arduino 並啟用聲音');
    connectBtn.position(20, height - 40);
    connectBtn.mousePressed(connectSerial);

    navigator.mediaDevices.enumerateDevices().then(gotDevices);
}

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
            frame.style('display', 'none');

            guitarSound.stop(); // 停止吉他聲
            if (!rainSound.isPlaying()) {
                rainSound.play(); // 播放雨聲
            }
        } else {
            // 0 的時候：有畫面，播吉他聲
            frame.style('display', 'block');

            rainSound.stop(); // 停止雨聲
            if (!guitarSound.isPlaying()) {
                guitarSound.play(); // 播放吉他聲
            }
        }
        // 更新狀態，避免在 draw() 迴圈中重複執行
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

function switchScene(sceneNumber) {

    // 先淡出
    frame.style('opacity', '0');

    setTimeout(() => {

        // 換頁
        frame.attribute(
            'src',
            pages[sceneNumber]
        );

        // 淡入
        frame.style('opacity', '1');

    }, 400);
}

function windowResized() {
    resizeCanvas(windowWidth, windowHeight);
    if (connectBtn) connectBtn.position(20, height - 40);
}