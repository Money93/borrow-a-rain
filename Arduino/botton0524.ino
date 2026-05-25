#define BUTTON_PIN 2

void setup() {
  Serial.begin(9600);

  // 使用內建上拉電阻
  pinMode(BUTTON_PIN, INPUT_PULLUP);
}

void loop() {

  int buttonState = digitalRead(BUTTON_PIN);

  // 按下按鈕時會變 LOW
  if (buttonState == LOW) {
    Serial.println(1); // 顯示天空
  } 
  else {
    Serial.println(0); // 黑畫面
  }

  delay(50);
}