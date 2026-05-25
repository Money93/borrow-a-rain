#define TRIG_PIN 9
#define ECHO_PIN 10

long duration;
float distance;

void setup() {
  Serial.begin(9600);
  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
}

void loop() {
  // 發送超音波
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);

  // 接收回波時間
  duration = pulseIn(ECHO_PIN, HIGH);

  // 換算距離（cm）
  distance = duration * 0.034 / 2;

  // 傳資料給電腦
  if (distance > 10) {
    Serial.println(1);  // 遠
  } else if (distance < 4) {
    Serial.println(0);  // 近
  }

  delay(300);
}