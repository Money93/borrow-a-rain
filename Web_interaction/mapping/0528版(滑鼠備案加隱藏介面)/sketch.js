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
let lastAngle = 0;

// ⭐【相對角度累積核心變數】
let accumulatedAngle = 0; 
let triggerThreshold = 75; // 填寫觸發度數。雨傘單向轉動超過此度數就會切換一頁（可依手感微調，建議 70 ~ 90）

let transitionDirection = 0; // -1 左 / +1 右
let currentPage = 1;

let frame;
let lastSwitchTime = 0;
let switchCooldown = 1500; // 過場冷卻時間 1.5 秒（這期間內怎麼轉都不會重複觸發）

let transitionCanvas;
let transitionCtx;

// 3點偵測平滑變數
let smoothP1X = 0, smoothP1Y = 0;
let smoothP2X = 0, smoothP2Y = 0;
let smoothP3X = 0, smoothP3Y = 0;

// 傾斜形變修正係數
let tiltScaleY = 1.35; 

// 過場狀態控制
let transitionRunning = false;
let transitionSwitched = false;
let transitionTargetScene = 1;
let transitionFrameCount = 0;

// Debug 顯示控制
let debugVisible = true;
let toggleDebugBtn;

const pages = {
    1: "scene1.html",
    2: "page2.html",
    3: "page3.html"
};

// Web Serial 相關變數
let port;
let reader;
let connectBtn;

let latestData = "0"; 
let lastData = "0";   

// 音樂相關變數
let rainSound;
let guitarSound;

let meteors = [];

function preload() {
    rainSound = loadSound('rain.mp3');
    guitarSound = loadSound('guitar.mp3');
}

function setup() {
    createCanvas(windowWidth, windowHeight);
    frame = select('#projectFrame');

    transitionCanvas = document.getElementById("transitionCanvas");
    transitionCtx = transitionCanvas.getContext("2d");
    transitionCanvas.width = window.innerWidth;
    transitionCanvas.height = window.innerHeight;

    rainSound.setLoop(true);
    guitarSound.setLoop(true);

    connectBtn = createButton('連接 Arduino 並啟用聲音');
    connectBtn.position(20, height - 40);
    connectBtn.mousePressed(connectSerial);

    toggleDebugBtn = createButton('隱藏調整介面');
    toggleDebugBtn.position(250, height - 40);
    toggleDebugBtn.mousePressed(() => {
        debugVisible = false;
        document.body.style.cursor = 'none';
        connectBtn.hide();
        toggleDebugBtn.hide();
    });

    navigator.mediaDevices.enumerateDevices().then(gotDevices);
    document.body.style.cursor = 'default';
}

async function connectSerial() {
    try {
        userStartAudio();
        port = await navigator.serial.requestPort();
        await port.open({ baudRate: 9600 });
        connectBtn.html('Arduino 已連接');
        connectBtn.attribute('disabled', 'true');

        const decoder = new TextDecoderStream();
        port.readable.pipeTo(decoder.writable);
        const inputStream = decoder.readable;
        reader = inputStream.getReader();

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

    if (!video || !video.loadedmetadata) {
        return;
    }

    if (latestData !== lastData) {
        if (latestData === "1") {
            frame.style('display', 'none');
            guitarSound.stop();
            if (!rainSound.isPlaying()) rainSound.play();
        } else {
            frame.style('display', 'block');
            rainSound.stop();
            if (!guitarSound.isPlaying()) guitarSound.play();
        }
        lastData = latestData;
    }

    video.loadPixels();
    points = [];

    // 找綠點像素
    for (let y = 0; y < video.height; y += 4) {
        for (let x = 0; x < video.width; x += 4) {
            let index = (x + y * video.width) * 4;
            let r = video.pixels[index + 0];
            let g = video.pixels[index + 1];
            let b = video.pixels[index + 2];

            if (g > 90 && g > r + 20 && g > b + 20) {
                points.push({ x: x, y: y, brightness: g });
            }
        }
    }

    // 3點獨立提取演算法
    if (points.length > 15) {
        points.sort((a, b) => b.brightness - a.brightness);
        
        let p1 = points[0];
        let p2 = null;
        let p3 = null;
        let minDist = 45; 

        for (let p of points) {
            if (dist(p.x, p.y, p1.x, p1.y) > minDist) {
                p2 = p;
                break;
            }
        }

        if (p2) {
            for (let p of points) {
                if (dist(p.x, p.y, p1.x, p1.y) > minDist && dist(p.x, p.y, p2.x, p2.y) > minDist) {
                    p3 = p;
                    break;
                }
            }
        }

        // 成功抓到 3 個獨立綠點
        if (p1 && p2 && p3) {
            let raws = [p1, p2, p3];

            if (smoothP1X === 0 && smoothP1Y === 0) {
                smoothP1X = p1.x; smoothP1Y = p1.y;
                smoothP2X = p2.x; smoothP2Y = p2.y;
                smoothP3X = p3.x; smoothP3Y = p3.y;
                lastAngle = degrees(atan2((smoothP1Y - (smoothP1Y+smoothP2Y+smoothP3Y)/3)*tiltScaleY, smoothP1X - (smoothP1X+smoothP2X+smoothP3X)/3));
            } else {
                // 三階全排列配對機制
                let permutations = [
                    [0, 1, 2], [0, 2, 1],
                    [1, 0, 2], [1, 2, 0],
                    [2, 0, 1], [2, 1, 0]
                ];
                let bestOrder = permutations[0];
                let minTotalDist = Infinity;

                for (let order of permutations) {
                    let d1 = dist(raws[order[0]].x, raws[order[0]].y, smoothP1X, smoothP1Y);
                    let d2 = dist(raws[order[1]].x, raws[order[1]].y, smoothP2X, smoothP2Y);
                    let d3 = dist(raws[order[2]].x, raws[order[2]].y, smoothP3X, smoothP3Y);
                    let total = d1 + d2 + d3;
                    if (total < minTotalDist) {
                        minTotalDist = total;
                        bestOrder = order;
                    }
                }

                smoothP1X = lerp(smoothP1X, raws[bestOrder[0]].x, 0.15);
                smoothP1Y = lerp(smoothP1Y, raws[bestOrder[0]].y, 0.15);
                smoothP2X = lerp(smoothP2X, raws[bestOrder[1]].x, 0.15);
                smoothP2Y = lerp(smoothP2Y, raws[bestOrder[1]].y, 0.15);
                smoothP3X = lerp(smoothP3X, raws[bestOrder[2]].x, 0.15);
                smoothP3Y = lerp(smoothP3Y, raws[bestOrder[2]].y, 0.15);
            }

            // 幾何重心計算
            let centroidX = (smoothP1X + smoothP2X + smoothP3X) / 3;
            let centroidY = (smoothP1Y + smoothP2Y + smoothP3Y) / 3;

            smoothX = lerp(smoothX, centroidX, 0.1);
            smoothY = lerp(smoothY, centroidY, 0.1);

            // 傾斜形變修正
            let dx = smoothP1X - centroidX;
            let dy = (smoothP1Y - centroidY) * tiltScaleY;

            // 計算當前角度
            umbrellaAngle = degrees(atan2(dy, dx));
            if (umbrellaAngle < 0) umbrellaAngle += 360;

            // 計算這影格與上一影格的角度差量
            let diff = umbrellaAngle - lastAngle;
            if (diff > 180) diff -= 360;
            if (diff < -180) diff += 360;

            lastAngle = umbrellaAngle;

            // ⭐【核心邏輯：相對角度累積判斷】
            if (millis() - lastSwitchTime > switchCooldown) {
                // 如果有明顯轉動（過濾掉非常微小的噪點抖動，並防止追蹤瞬間跳變的大異常值）
                if (Math.abs(diff) > 0.4 && Math.abs(diff) < 35) {
                    accumulatedAngle += diff; 
                } else if (Math.abs(diff) <= 0.4) {
                    // 當雨傘靜止不動時，讓累積量緩慢衰減回0，防止長期待機累積微小誤差
                    accumulatedAngle *= 0.92; 
                }

                // 檢查是否達到順時針或逆時針的觸發條件
                if (accumulatedAngle >= triggerThreshold) {
                    // 順時針轉動達標 -> 切換至下一頁 (1 -> 2 -> 3 -> 1)
                    let targetScene = (currentPage % 3) + 1;
                    transitionDirection = 1; 
                    
                    switchScene(targetScene);
                    currentPage = targetScene;
                    lastSwitchTime = millis();
                    accumulatedAngle = 0; // 觸發後立刻清空格子
                    console.log("動作觸發：順時針旋轉切換至網頁:", targetScene);

                } else if (accumulatedAngle <= -triggerThreshold) {
                    // 逆時針轉動達標 -> 切換至上一頁 (1 -> 3 -> 2 -> 1)
                    let targetScene = currentPage - 1;
                    if (targetScene < 1) targetScene = 3;
                    transitionDirection = -1; 
                    
                    switchScene(targetScene);
                    currentPage = targetScene;
                    lastSwitchTime = millis();
                    accumulatedAngle = 0; // 觸發後立刻清空格子
                    console.log("動作觸發：逆時針旋轉切換至網頁:", targetScene);
                }
            } else {
                // 🚫 在過場動畫冷卻期間，強制將累積角度持續清空，確保轉太多圈也不會排隊觸發下一次
                accumulatedAngle = 0;
            }

            // Debug 繪製 3 個追蹤點
            if (debugVisible) {
                fill(255, 0, 0);
                circle(map(smoothP1X, 0, video.width, 20, 340), map(smoothP1Y, 0, video.height, 20, 260), 12);
                fill(0, 0, 255);
                circle(map(smoothP2X, 0, video.width, 20, 340), map(smoothP2Y, 0, video.height, 20, 260), 12);
                fill(255, 255, 0);
                circle(map(smoothP3X, 0, video.width, 20, 340), map(smoothP3Y, 0, video.height, 20, 260), 12);
                
                fill(255);
                textSize(20);
                text("Angle: " + nf(umbrellaAngle, 1, 1) + "°", 20, 290);
                text("Accumulated: " + nf(accumulatedAngle, 1, 1) + "° / " + triggerThreshold + "°", 20, 320);
                text("Current Page: " + currentPage, 20, 350);
            }
        }
    }

    if (debugVisible) {
        image(video, 20, 20, 320, 240);
        fill(0, 255, 0, 100);
        noStroke();
        for (let p of points) {
            circle(map(p.x, 0, video.width, 20, 340), map(p.y, 0, video.height, 20, 260), 4);
        }
        // 重心: 紫色大圈
        fill(255, 0, 255);
        circle(map(smoothX, 0, video.width, 20, 340), map(smoothY, 0, video.height, 20, 260), 16);
    }

    // 流星過場動畫主迴圈
    if (transitionRunning) {
        transitionCtx.fillStyle = "rgba(0,0,0,0.18)"; 
        transitionCtx.fillRect(0, 0, transitionCanvas.width, transitionCanvas.height);

        for (let i = meteors.length - 1; i >= 0; i--) {
            let m = meteors[i];
            m.update();
            m.draw(transitionCtx);

            if (m.life <= 0) {
                meteors.splice(i, 1);
            }
        }

        transitionFrameCount++;

        if (!transitionSwitched && transitionFrameCount >= 25) {
            transitionSwitched = true;
            frame.attribute('src', pages[transitionTargetScene]);
        }

        if (meteors.length === 0) {
            transitionRunning = false;
            transitionCtx.clearRect(0, 0, transitionCanvas.width, transitionCanvas.height);
        }
    }
}

function switchScene(sceneNumber) {
    meteors = []; 
    transitionSwitched = false;
    transitionTargetScene = sceneNumber;
    transitionFrameCount = 0;

    for (let i = 0; i < 30; i++) {
        meteors.push(new Meteor(transitionDirection));
    }
    transitionRunning = true;
}

class Meteor {
    constructor(dir) {
        this.dir = dir;

        // ⭐【流星飛入方向對調核心修改處】
        if (dir === 1) {
            this.x = window.innerWidth + 200;
            this.angle = Math.PI - 0.4; 
        } else {
            this.x = -200;
            this.angle = 0.4; 
        }

        this.y = Math.random() * window.innerHeight * 0.8;
        this.len = Math.random() * 200 + 150;
        this.speed = Math.random() * 22 + 16;
        this.life = 1.0;
    }

    update() {
        this.x += Math.cos(this.angle) * this.speed;
        this.y += Math.sin(this.angle) * this.speed;
        this.life -= 0.015; 
    }

    draw(ctx) {
        ctx.beginPath();
        ctx.moveTo(this.x, this.y);
        ctx.lineTo(
            this.x - Math.cos(this.angle) * this.len,
            this.y - Math.sin(this.angle) * this.len
        );

        let g = ctx.createLinearGradient(
            this.x, this.y,
            this.x - Math.cos(this.angle) * this.len,
            this.y - Math.sin(this.angle) * this.len
        );

        g.addColorStop(0, "rgba(255,255,255,0.9)");
        g.addColorStop(1, "rgba(255,255,255,0)");

        ctx.strokeStyle = g;
        ctx.lineWidth = 2.5;
        ctx.stroke();
    }
}

function mousePressed() {
    if (mouseY > height - 60 && mouseX < 500) {
        return;
    }

    if (millis() - lastSwitchTime > switchCooldown) {
        currentPage = (currentPage % 3) + 1;
        transitionDirection = 1; 
        switchScene(currentPage);
        lastSwitchTime = millis();
        accumulatedAngle = 0;
        console.log("備案觸發：滑鼠點擊切換到場景:", currentPage);
    }
}

function windowResized() {
    resizeCanvas(windowWidth, windowHeight);
    if (connectBtn) connectBtn.position(20, height - 40);
    if (transitionCanvas) {
        transitionCanvas.width = window.innerWidth;
        transitionCanvas.height = window.innerHeight;
    }
}

function keyPressed() {
    if (key === 'd' || key === 'D') {
        debugVisible = !debugVisible;
        if (debugVisible) {
            document.body.style.cursor = 'default';
            connectBtn.show();
            toggleDebugBtn.show();
            toggleDebugBtn.html('隱藏調整介面');
        } else {
            document.body.style.cursor = 'none';
            connectBtn.hide();
            toggleDebugBtn.hide();
        }
    }
}
