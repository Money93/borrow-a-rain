let video;

let points = [];

let smoothX = 0;
let smoothY = 0;

let frame;

function setup() {

    createCanvas(windowWidth, windowHeight);

    frame = select('#projectFrame');

    navigator.mediaDevices.enumerateDevices()
        .then(gotDevices);
}

function gotDevices(deviceInfos) {

    let videoDevices = [];

    for (let i = 0; i < deviceInfos.length; i++) {

        let device = deviceInfos[i];

        if (device.kind === 'videoinput') {

            videoDevices.push(device);

            console.log(
                videoDevices.length - 1,
                device.label
            );
        }
    }

    // DroidCam 通常是 1
    let preferredCamera = videoDevices[1];

    video = createCapture({
        video: {
            deviceId: preferredCamera.deviceId
        }
    });

    video.size(640, 480);

    video.hide();
}

function draw() {

    background(0);

    video.loadPixels();

    points = [];

    // ===== 找綠點 =====

    for (let y = 0; y < video.height; y += 4) {

        for (let x = 0; x < video.width; x += 4) {

            let index =
                (x + y * video.width) * 4;

            let r = video.pixels[index + 0];
            let g = video.pixels[index + 1];
            let b = video.pixels[index + 2];

            if (
                g > 90 &&
                g > r + 20 &&
                g > b + 20
            ) {

                points.push({
                    x: x,
                    y: y
                });
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

        let targetX =
            sumX / points.length;

        let targetY =
            sumY / points.length;

        let distance = dist(
            smoothX,
            smoothY,
            targetX,
            targetY
        );

        if (distance > 3) {

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
        }
    }

    // ===== 座標轉換 =====

    let mappedX = map(
        smoothX,
        0,
        video.width,
        200,
        width - 200
    );

    let mappedY = map(
        smoothY,
        0,
        video.height,
        100,
        height - 100
    );

    // ===== 移動 Gemini 網頁 =====

    frame.position(
        mappedX,
        mappedY
    );

    // ===== Debug =====

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
}

function windowResized() {

    resizeCanvas(
        windowWidth,
        windowHeight
    );
}