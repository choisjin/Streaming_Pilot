/*
 * Ideality Remote Desktop — HID Bridge
 * Arduino Leonardo (ATmega32U4)
 *
 * Microsoft 키보드/마우스로 위장하여 안티치트 우회.
 * 기본 Keyboard.h + Mouse.h 사용 (추가 라이브러리 불필요).
 *
 * 프로토콜 (줄바꿈 종료, 115200 baud):
 *
 * 마우스:
 *   MM,dx,dy              상대 이동 (분할 자동 처리)
 *   MA,x,y,sw,sh          절대 이동 (화면크기 기준)
 *   MC,btn                클릭 (L/R/M)
 *   MD,btn                버튼 누르기 (드래그)
 *   MU,btn                버튼 해제
 *   MW,delta              휠 스크롤
 *
 * 키보드:
 *   KD,code               키 누르기 (ASCII 또는 특수키 코드)
 *   KU,code               키 해제
 *   KT,char               타이핑 (press+release)
 *   KS,string             문자열 타이핑
 *   KA                    모든 키/마우스 해제
 *
 * 시스템:
 *   PING                  연결 확인 → PONG 응답
 */

// Arduino Leonardo 기본 VID:PID (위장 없음 — 정상 USB 장치로 인식)
#define USB_VID 0x2341
#define USB_PID 0x8036
#define USB_MANUFACTURER "Arduino LLC"
#define USB_PRODUCT "Arduino Leonardo"

#include <Keyboard.h>
#include <Mouse.h>

#define BUF_SIZE 128
char buf[BUF_SIZE];
int bufIdx = 0;

void setup() {
  Serial.begin(115200);
  Keyboard.begin();
  Mouse.begin();
  while (!Serial) { ; }
  Serial.println("READY");
}

void loop() {
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n') {
      buf[bufIdx] = '\0';
      if (bufIdx > 0) processCommand(buf);
      bufIdx = 0;
    } else if (c != '\r' && bufIdx < BUF_SIZE - 1) {
      buf[bufIdx++] = c;
    }
  }
}

void processCommand(const char* cmd) {
  // PING
  if (strcmp(cmd, "PING") == 0) {
    Serial.println("PONG");
    return;
  }

  // KA — release all
  if (strcmp(cmd, "KA") == 0) {
    Keyboard.releaseAll();
    Mouse.release(MOUSE_LEFT);
    Mouse.release(MOUSE_RIGHT);
    Mouse.release(MOUSE_MIDDLE);
    Serial.println("OK");
    return;
  }

  // Parse: first 2 chars = command, skip comma, rest = params
  if (strlen(cmd) < 2) return;
  char c0 = cmd[0], c1 = cmd[1];
  const char* params = (strlen(cmd) > 3) ? cmd + 3 : "";

  // --- Mouse ---
  if (c0 == 'M') {
    if (c1 == 'M') {
      // MM,dx,dy — relative move
      int dx, dy;
      if (sscanf(params, "%d,%d", &dx, &dy) == 2) {
        mouseMove(dx, dy);
      }
    }
    else if (c1 == 'A') {
      // MA,x,y,sw,sh — absolute move
      int tx, ty, sw, sh;
      if (sscanf(params, "%d,%d,%d,%d", &tx, &ty, &sw, &sh) == 4) {
        mouseAbsolute(tx, ty, sw, sh);
      }
    }
    else if (c1 == 'C') {
      // MC,btn — click
      Mouse.click(parseButton(params[0]));
    }
    else if (c1 == 'D') {
      // MD,btn — press
      Mouse.press(parseButton(params[0]));
    }
    else if (c1 == 'U') {
      // MU,btn — release
      Mouse.release(parseButton(params[0]));
    }
    else if (c1 == 'W') {
      // MW,delta — wheel
      int delta = atoi(params);
      Mouse.move(0, 0, delta);
    }
    Serial.println("OK");
    return;
  }

  // --- Keyboard ---
  if (c0 == 'K') {
    if (c1 == 'D') {
      // KD,code — key down
      int code = atoi(params);
      Keyboard.press((uint8_t)code);
    }
    else if (c1 == 'U') {
      // KU,code — key up
      int code = atoi(params);
      Keyboard.release((uint8_t)code);
    }
    else if (c1 == 'T') {
      // KT,c — type single char
      Keyboard.write(params[0]);
    }
    else if (c1 == 'S') {
      // KS,string — type string
      Keyboard.print(params);
    }
    Serial.println("OK");
    return;
  }

  Serial.println("ERR");
}

uint8_t parseButton(char b) {
  switch (b) {
    case 'R': return MOUSE_RIGHT;
    case 'M': return MOUSE_MIDDLE;
    default:  return MOUSE_LEFT;
  }
}

void mouseMove(int dx, int dy) {
  // Mouse.move accepts -128~127, split large moves
  while (dx != 0 || dy != 0) {
    int mx = constrain(dx, -127, 127);
    int my = constrain(dy, -127, 127);
    Mouse.move(mx, my, 0);
    dx -= mx;
    dy -= my;
  }
}

void mouseAbsolute(int tx, int ty, int sw, int sh) {
  // Reset to origin (0,0) by moving large negative
  mouseMove(-sw, -sh);
  delay(2);
  // Move to target
  mouseMove(tx, ty);
}
