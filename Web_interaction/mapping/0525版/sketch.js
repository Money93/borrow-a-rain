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
let frame;

// === Web Serial 相關變數 ===
let port;
let reader;
let connectBtn;
let latestData = "0"; // 預設為 0 (有畫面)

function setup() {
    createCanvas(windowWidth, windowHeight);
    frame = select('#projectFrame');

    // 建立一個按鈕用來連接 Arduino (瀏覽器安全機制要求必須由使用者觸發)
    connectBtn = createButton('連接 Arduino');
    connectBtn.position(20, height - 40);
    connectBtn.mousePressed(connectSerial);

    navigator.mediaDevices.enumerateDevices().then(gotDevices);
}

// 監聽並讀取 Arduino 數據
async function connectSerial() {
    try {
        port = await navigator.serial.requestPort();
        await port.open({ baudRate: 9600 });
        connectBtn.html('Arduino 已連接');
        connectBtn.attribute('disabled', 'true');

        const decoder = new TextDecoderStream();
        port.readable.pipeTo(decoder.writable);
        const inputStream = decoder.readable;
        reader = inputStream.getReader();

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
            // 尋找換行符號
            let lines = buffer.split('\r\n');
            // 如果最後一項不完整，留給下一次
            buffer = lines.pop(); 

            if (lines.length > 0) {
                // 取得最新的一行數據並去除空白
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
    let preferredCamera = videoDevices[1] || videoDevices[0]; // 防止爆錯的保險
    video = createCapture({
        video: { deviceId: preferredCamera.deviceId }
    });
    video.size(640, 480);
    video.hide();
}

function draw() {
    background(0); // 畫布本來就是黑的

    // ===== 根據 Arduino 數據控制網頁畫面 =====
    if (latestData === "1") {
        frame.style('display', 'none');   // 1 的時候畫面全黑 (隱藏 iframe)
    } else {
        frame.style('display', 'block');  // 0 的時候有畫面 (顯示 iframe)
    }

    video.loadPixels();
    points = [];

    // ===== 找綠點 =====
    for (let y = 0; y < video.height; y += 4) {
        for (let x = 0; x < video.width; x += 4) {
            let index = (x + y * video.width) * 4;
            let r = video.pixels[index + 0];
            let g = video.pixels[index + 1];
            let b = video.pixels[index + 2];

            if (g > 90 && g > r + 20 && g > b + 20) {
                points.push({ x: x, y: y });
            }
        }
    }

    // ===== 算中心 =====
    if (points.length > 0) {
        let sumX = 0;
        let sumY = 0;
        for (let p of points) {
            sumX += p.x;
            sumY += p.y;
        }

        let targetX = sumX / points.length;
        let targetY = sumY / points.length;
        let distance = dist(smoothX, smoothY, targetX, targetY);

        if (distance > 3) {
            smoothX = lerp(smoothX, targetX, 0.1);
            smoothY = lerp(smoothY, targetY, 0.1);
        }
    }

    // ===== 座標轉換 =====
    let mappedX = map(smoothX, 0, video.width, 200, width - 200);
    let mappedY = map(smoothY, 0, video.height, 100, height - 100);

    // ===== 移動網頁 =====
    frame.position(mappedX, mappedY);

    // ===== Debug 畫面 =====
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

    // ===== 發送給 TouchDesigner =====
    let tx = smoothX / video.width;
    let ty = smoothY / video.height;
    onTrackingUpdate(tx, ty);
}

function windowResized() {
    resizeCanvas(windowWidth, windowHeight);
    if(connectBtn) connectBtn.position(20, height - 40);
}