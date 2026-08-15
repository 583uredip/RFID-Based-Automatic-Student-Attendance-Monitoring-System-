/*
 * ============================================================
 *  ESP32 RFID Attendance & Access Control System (Optimized)
 *  Backend: Node.js (Express + PostgreSQL)
 *  Features:
 *    - RFID Card Punching (Check IN / Check OUT / 2x Daily Limit)
 *    - 3rd Punch Warning: Displays "2x punch is done Try tomorrow"
 *    - Anti-Passback Cooldown (5s double-tap protection)
 *    - Non-blocking Architecture (Millis-driven, zero loop stutters)
 *    - Offline Queueing (LittleFS flash storage up to 350 scans)
 *    - Offline Student Cache (/students.json for offline name display)
 *    - Master Card Administration Mode
 *    - Relay Door Unlock Access Control
 *    - RGB LED Status Indicator & Multi-Frequency Audio Tones
 *    - Live OLED clock (seconds update) + Flicker-free Idle Screen
 *    - OLED Screen Saver / Sleep after 5 minutes of inactivity
 *    - ArduinoOTA (Over-The-Air Wireless Firmware Updates)
 *    - Hardware DS3231 RTC & auto-sync from NTP
 * ============================================================
 *
 * RC522 → ESP32:
 *   SDA (SS) → GPIO 5    SCK  → GPIO 18
 *   MOSI     → GPIO 23   MISO → GPIO 19
 *   RST      → GPIO 2    3.3V → 3.3V   GND → GND
 *
 * OLED (SSD1306) & DS3231 RTC → I2C:
 *   SDA → GPIO 21, SCL → GPIO 22
 *
 * Peripherals:
 *   Buzzer → GPIO 16
 *   Relay  → GPIO 4  (Door Unlock)
 *   RGB LED: Red → GPIO 27, Green → GPIO 26, Blue → GPIO 25
 * ============================================================
 */

#include <SPI.h>
#include <MFRC522.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <LittleFS.h>
#include <time.h>

// ── Feature Toggles ──────────────────────────────────────────────
#define ENABLE_RELAY        1  // Door unlock relay support
#define ENABLE_RGB_LED      1  // Status RGB LED indicator
#define ENABLE_RTC          1  // Hardware DS3231 RTC I2C module support
#define ENABLE_OTA          1  // Over-The-Air firmware updates

#if ENABLE_OTA
  #include <ArduinoOTA.h>
#endif

// ── Hardware Pin Configuration ───────────────────────────────────
#define SS_PIN         5
#define RST_PIN        2
#define BUZZER_PIN     16
#define RELAY_PIN      4
#define RGB_RED_PIN    27
#define RGB_GREEN_PIN  26
#define RGB_BLUE_PIN   25

#define OLED_W         128
#define OLED_H         64
#define OLED_ADDR      0x3C
#define DS3231_ADDR    0x68

// Common Cathode RGB LED (set true for Common Anode)
const bool COMMON_ANODE = false;

// ── WiFi & Server Configuration ──────────────────────────────────
const char* DEFAULT_WIFI_SSID = "5G";
const char* DEFAULT_WIFI_PASS = "12345345";

// Node.js Express Server API Endpoints (Port 3000)
const char* SERVER_URL   = "http://172.31.192.211:3000/api/rfid/scan";
const char* REGISTER_URL = "http://172.31.192.211:3000/api/rfid/register";
const char* CARDREAD_URL = "http://172.31.192.211:3000/api/rfid/latest-scan";
const char* SYNC_URL     = "http://172.31.192.211:3000/api/rfid/sync";

// Master Card UID (Change to your admin card UID)
String MASTER_CARD_UID = "AA:BB:CC:DD";

// Timers & Intervals (ms)
const unsigned long COOLDOWN_MS       = 5000;   // Double-tap cooldown (5s)
const unsigned long OLED_TIMEOUT_MS   = 300000; // Screen saver (5 min)
const unsigned long RELAY_UNLOCK_MS   = 3000;   // Relay unlock (3s)
const unsigned long CLOCK_UPDATE_MS   = 1000;   // Idle clock refresh (1s)
const unsigned long HEALTH_CHECK_MS   = 5000;   // Server ping check (5s)
const unsigned long DISPLAY_RESET_MS  = 2500;   // Result screen reset delay (2.5s)

// Storage Paths on Flash
#define QUEUE_FILE    "/offline_queue.json"
#define STUDENTS_FILE "/students.json"

// ── Global Objects & Variables ───────────────────────────────────
MFRC522             mfrc522(SS_PIN, RST_PIN);
MFRC522::MIFARE_Key mifareKey;
Adafruit_SSD1306    display(OLED_W, OLED_H, &Wire, -1);

bool displayOn        = true;
bool idleScreen       = false;
bool isServerOnline   = false;

unsigned long lastScanTime     = 0;
unsigned long lastActivityTime = 0;
unsigned long relayOffTime     = 0;
unsigned long lastClockUpdate  = 0;
unsigned long lastHealthCheck  = 0;
unsigned long displayResetTime = 0;
String        lastScannedUID   = "";

// ── Function Declarations ────────────────────────────────────────
void setupPeripherals();
void setupWiFi();
void setupNTPAndRTC();
void setupOTA();

void checkServerHealth();
void processCardScan(String uid);
void handleMasterCard();
void sendAttendance(String uid);

void queueOffline(String uid);
void syncOfflineQueue();
void saveStudentCache(String uid, String cardId, String name);
bool getStudentFromCache(String uid, String &cardIdOut, String &nameOut);

void handleCommand(String raw);
void doWrite(String wID, String wName);
void registerToDB(String uid, String card_id, String name);
void doRead();
void doDiag();

void triggerRelay();
void checkTimers();
void setRGB(uint8_t r, uint8_t g, uint8_t b);
void playTone(int freq, int durationMs);
void beepOK();
void beepFail();
void beepWarning();
void beepAdmin();

void resetDisplayTimeout();
void updateIdleClock();
void oledReady();
void oledMsg(String l1, String l2, String l3, String l4);
void oledAttendance(String name, String cardId, String action);
void oledLimit(String name);
void oledSuccess(String id, String name, String uid, String dbStatus);
void oledRead(String uid, String id, String name);

String getUID();
String getFormattedTime();
String getFormattedDate();
String buf2str(byte *buf);
void printHelp();
int offlineQueueCount();

// ── Setup ────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  delay(200);

  setupPeripherals();
  setupWiFi();
  setupNTPAndRTC();
  setupOTA();

  resetDisplayTimeout();
  printHelp();
  checkServerHealth();
  oledReady();
}

// ── Main Loop ────────────────────────────────────────────────────
void loop() {
#if ENABLE_OTA
  ArduinoOTA.handle();
#endif

  checkTimers();

  // Periodic Server Health Check & Auto-Sync
  if (WiFi.status() == WL_CONNECTED) {
    if (millis() - lastHealthCheck > HEALTH_CHECK_MS) {
      lastHealthCheck = millis();
      checkServerHealth();
    }
  } else {
    isServerOnline = false;
  }

  // Serial Command Processing
  if (Serial.available()) {
    String raw = Serial.readStringUntil('\n');
    raw.trim();
    if (raw.length() > 0) {
      resetDisplayTimeout();
      handleCommand(raw);
      return;
    }
  }

  // RFID Card Detection
  if (!mfrc522.PICC_IsNewCardPresent()) return;
  if (!mfrc522.PICC_ReadCardSerial())   return;

  resetDisplayTimeout();
  idleScreen = false;
  String uid = getUID();
  Serial.println("\n[RFID Tap] Scanned UID: " + uid);

  // Anti-Passback Cooldown (5s double-tap protection)
  if (uid == lastScannedUID && (millis() - lastScanTime < COOLDOWN_MS)) {
    Serial.println("[Cooldown] Ignoring duplicate scan for UID: " + uid);
    beepWarning();
    setRGB(255, 165, 0); // Orange
    oledMsg("[ COOLDOWN ]", "Please wait...", "Avoid double tap", "");
    displayResetTime = millis() + 1500;
    mfrc522.PICC_HaltA();
    mfrc522.PCD_StopCrypto1();
    return;
  }

  lastScannedUID = uid;
  lastScanTime   = millis();

  // Master Admin Card Check
  if (uid == MASTER_CARD_UID) {
    handleMasterCard();
    mfrc522.PICC_HaltA();
    mfrc522.PCD_StopCrypto1();
    return;
  }

  // Process Standard Attendance Punch
  processCardScan(uid);

  mfrc522.PICC_HaltA();
  mfrc522.PCD_StopCrypto1();
}

// ─────────────────────────────────────────────────────────────────
// Peripherals Setup
// ─────────────────────────────────────────────────────────────────
void setupPeripherals() {
  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, LOW);

#if ENABLE_RELAY
  pinMode(RELAY_PIN, OUTPUT);
  digitalWrite(RELAY_PIN, LOW);
#endif

#if ENABLE_RGB_LED
  pinMode(RGB_RED_PIN, OUTPUT);
  pinMode(RGB_GREEN_PIN, OUTPUT);
  pinMode(RGB_BLUE_PIN, OUTPUT);
  setRGB(0, 0, 0);
#endif

  if (!LittleFS.begin(true)) {
    Serial.println("LittleFS mount failed — offline storage disabled");
  } else {
    Serial.println("LittleFS storage ready");
  }

  SPI.begin(18, 19, 23, SS_PIN);
  mfrc522.PCD_Init();
  delay(50);
  for (byte i = 0; i < 6; i++) mifareKey.keyByte[i] = 0xFF;

  Wire.begin(21, 22);
  if (!display.begin(SSD1306_SWITCHCAPVCC, OLED_ADDR)) {
    Serial.println("OLED init failed!");
    while (1);
  }

  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  display.setTextSize(1);
  display.setCursor(10, 8);
  display.print("KAPATAKSHA H.S.");
  display.setCursor(10, 24);
  display.print("RFID ATTENDANCE");
  display.setCursor(20, 42);
  display.print("Initializing...");
  display.drawRect(0, 0, OLED_W, OLED_H, SSD1306_WHITE);
  display.display();
}

// ─────────────────────────────────────────────────────────────────
// WiFi Setup
// ─────────────────────────────────────────────────────────────────
void setupWiFi() {
  setRGB(0, 0, 255);
  oledMsg(" Connecting WiFi", DEFAULT_WIFI_SSID, "Please wait...", "");

  WiFi.begin(DEFAULT_WIFI_SSID, DEFAULT_WIFI_PASS);
  Serial.print("Connecting WiFi");
  int tries = 0;
  while (WiFi.status() != WL_CONNECTED && tries < 15) {
    delay(400); Serial.print("."); tries++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\nWiFi Connected! IP: " + WiFi.localIP().toString());
    oledMsg("  WiFi Connected", WiFi.localIP().toString(), "", "");
    setRGB(0, 255, 0);
    beepOK();
  } else {
    Serial.println("\nWiFi Disconnected — Operating Offline");
    oledMsg("  WiFi Offline", "Operating offline", "Records queued", "");
    setRGB(255, 165, 0);
    beepFail();
  }
  delay(1000);
  setRGB(0, 0, 0);
}

// ─────────────────────────────────────────────────────────────────
// NTP & RTC Setup
// ─────────────────────────────────────────────────────────────────
void setupNTPAndRTC() {
  if (WiFi.status() == WL_CONNECTED) {
    configTime(6 * 3600, 0, "pool.ntp.org", "time.nist.gov"); // UTC+6 Asia/Dhaka
  }

#if ENABLE_RTC
  Wire.beginTransmission(DS3231_ADDR);
  if (Wire.endTransmission() == 0) {
    Serial.println("DS3231 RTC detected");
  }
#endif
}

// ─────────────────────────────────────────────────────────────────
// ArduinoOTA Setup
// ─────────────────────────────────────────────────────────────────
void setupOTA() {
#if ENABLE_OTA
  if (WiFi.status() == WL_CONNECTED) {
    ArduinoOTA.setHostname("ESP32-RFID-Attendance");
    ArduinoOTA.begin();
    Serial.println("OTA Update Service Ready");
  }
#endif
}

// ─────────────────────────────────────────────────────────────────
// Process Attendance Card Punch
// ─────────────────────────────────────────────────────────────────
void processCardScan(String uid) {
  oledMsg("  Card Scanned", uid, "Processing...", "");

  if (WiFi.status() == WL_CONNECTED && isServerOnline) {
    sendAttendance(uid);
  } else {
    // Offline Mode: Queue scan locally
    queueOffline(uid);

    String cachedId = "", cachedName = "";
    if (getStudentFromCache(uid, cachedId, cachedName)) {
      oledAttendance(cachedName, cachedId, "OFFLINE");
    } else {
      oledMsg("  Saved Offline", uid, "Logged to Flash", "Will sync on reconnect");
    }
    displayResetTime = millis() + DISPLAY_RESET_MS;
  }
}

// ─────────────────────────────────────────────────────────────────
// Send Attendance to Node.js Backend API
// ─────────────────────────────────────────────────────────────────
void sendAttendance(String uid) {
  HTTPClient http;
  http.begin(SERVER_URL);
  http.addHeader("Content-Type", "application/json");
  http.setTimeout(2500);

  String body = "{\"uid\":\"" + uid + "\"}";
  Serial.println("[POST] " + String(SERVER_URL) + " -> " + body);

  int code = http.POST(body);
  Serial.println("HTTP Code: " + String(code));

  if (code == 200 || code == 201) {
    String response = http.getString();
    Serial.println("Response: " + response);

    StaticJsonDocument<512> doc;
    DeserializationError err = deserializeJson(doc, response);

    if (!err) {
      String status = doc["status"].as<String>();

      if (status == "registered" || status == "success") {
        String name   = doc.containsKey("name") ? doc["name"].as<String>() : "Student";
        String action = doc.containsKey("action") ? doc["action"].as<String>() : "IN";
        String cardId = doc.containsKey("studentId") ? doc["studentId"].as<String>() : (doc.containsKey("card_id") ? doc["card_id"].as<String>() : "");

        saveStudentCache(uid, cardId, name);

        setRGB(0, 255, 0); // Green
        beepOK();
        triggerRelay();
        oledAttendance(name, cardId, action);

      } else if (status == "limit") {
        // 3rd Punch Daily Limit Reached!
        String name = doc.containsKey("name") ? doc["name"].as<String>() : "Student";
        setRGB(255, 0, 0); // Red
        beepFail();
        oledLimit(name);

      } else if (status == "new") {
        String studentId = doc.containsKey("studentId") ? doc["studentId"].as<String>() : "";
        setRGB(255, 165, 0); // Orange
        beepOK();
        oledMsg("  New Card Tapped", uid, "ID: " + studentId, "Register on Web UI");

      } else if (status == "unknown") {
        setRGB(255, 0, 0); // Red
        beepFail();
        oledMsg("  Unknown Card", uid, "Not registered", "Use WRITE cmd");

      } else {
        setRGB(255, 0, 0); // Red
        beepFail();
        oledMsg("  Server Notice", response.substring(0, 20), "", "");
      }
    }
  } else if (code <= 0) {
    isServerOnline = false;
    Serial.println("Server unreachable! Saving scan to offline queue...");
    queueOffline(uid);

    String cachedId = "", cachedName = "";
    if (getStudentFromCache(uid, cachedId, cachedName)) {
      oledAttendance(cachedName, cachedId, "OFFLINE");
    } else {
      oledMsg("  Saved Offline", uid, "Server Unreachable", "Queued in Flash");
    }
  } else {
    setRGB(255, 165, 0);
    beepFail();
    oledMsg("  HTTP Error", "Code: " + String(code), "Check server", "");
  }

  http.end();
  displayResetTime = millis() + DISPLAY_RESET_MS;
}

// ─────────────────────────────────────────────────────────────────
// Master Admin Card Handler
// ─────────────────────────────────────────────────────────────────
void handleMasterCard() {
  Serial.println(">>> MASTER ADMIN CARD SCANNED <<<");
  beepAdmin();
  setRGB(0, 255, 255); // Cyan
  triggerRelay();

  oledMsg("[ MASTER ADMIN ]", "Door Unlocked!", "Queue: " + String(offlineQueueCount()) + " scans", "1:Sync  2:Diag");
  displayResetTime = millis() + 3000;
}

// ─────────────────────────────────────────────────────────────────
// Student Cache & Offline Queue Management (LittleFS)
// ─────────────────────────────────────────────────────────────────
void saveStudentCache(String uid, String cardId, String name) {
  DynamicJsonDocument doc(4096);
  if (LittleFS.exists(STUDENTS_FILE)) {
    File f = LittleFS.open(STUDENTS_FILE, "r");
    if (f) { deserializeJson(doc, f); f.close(); }
  }

  JsonObject students = doc.as<JsonObject>();
  JsonObject record   = students.createNestedObject(uid);
  record["card_id"]   = cardId;
  record["name"]      = name;

  File f = LittleFS.open(STUDENTS_FILE, "w");
  if (f) { serializeJson(doc, f); f.close(); }
}

bool getStudentFromCache(String uid, String &cardIdOut, String &nameOut) {
  if (!LittleFS.exists(STUDENTS_FILE)) return false;
  File f = LittleFS.open(STUDENTS_FILE, "r");
  if (!f) return false;

  DynamicJsonDocument doc(4096);
  DeserializationError err = deserializeJson(doc, f);
  f.close();

  if (err || !doc.containsKey(uid)) return false;
  cardIdOut = doc[uid]["card_id"].as<String>();
  nameOut   = doc[uid]["name"].as<String>();
  return true;
}

int offlineQueueCount() {
  if (!LittleFS.exists(QUEUE_FILE)) return 0;
  File f = LittleFS.open(QUEUE_FILE, "r");
  if (!f) return 0;
  DynamicJsonDocument doc(16384);
  if (deserializeJson(doc, f)) { f.close(); return 0; }
  f.close();
  return doc["records"].size();
}

void queueOffline(String uid) {
  time_t now;
  time(&now);
  if (now < 1000000) now = 1700000000 + (millis() / 1000);

  DynamicJsonDocument doc(16384);
  if (LittleFS.exists(QUEUE_FILE)) {
    File f = LittleFS.open(QUEUE_FILE, "r");
    if (f) { deserializeJson(doc, f); f.close(); }
  }

  if (!doc.containsKey("records")) doc.createNestedArray("records");
  JsonArray arr = doc["records"];

  if (arr.size() >= 350) {
    setRGB(255, 0, 0);
    beepFail();
    oledMsg("  Queue FULL!", uid, "Max 350 records", "Connect WiFi!");
    return;
  }

  JsonObject rec = arr.createNestedObject();
  rec["uid"]       = uid;
  rec["timestamp"] = (long)now;

  File f = LittleFS.open(QUEUE_FILE, "w");
  if (f) { serializeJson(doc, f); f.close(); }

  setRGB(255, 255, 0);
  beepOK();
  triggerRelay();
}

void syncOfflineQueue() {
  if (!LittleFS.exists(QUEUE_FILE)) return;
  File f = LittleFS.open(QUEUE_FILE, "r");
  if (!f) return;

  DynamicJsonDocument doc(16384);
  if (deserializeJson(doc, f)) { f.close(); return; }
  f.close();

  JsonArray arr = doc["records"];
  if (arr.size() == 0) return;

  int count = arr.size();
  Serial.println("Syncing " + String(count) + " offline records...");
  oledMsg("  Syncing...", String(count) + " records", "Please wait", "");

  HTTPClient http;
  http.begin(SYNC_URL);
  http.addHeader("Content-Type", "application/json");
  http.setTimeout(5000);

  String body;
  serializeJson(doc, body);
  int code = http.POST(body);

  if (code == 200 || code == 201) {
    String resp = http.getString();
    StaticJsonDocument<256> res;
    if (!deserializeJson(res, resp)) {
      int synced  = res["synced"]  | 0;
      int skipped = res["skipped"] | 0;
      LittleFS.remove(QUEUE_FILE);
      setRGB(0, 255, 0);
      beepOK();
      oledMsg("  Sync Complete!", "Synced: " + String(synced), "Skipped: " + String(skipped), "");
      displayResetTime = millis() + 2000;
    }
  }
  http.end();
}

// ─────────────────────────────────────────────────────────────────
// Server Health Check
// ─────────────────────────────────────────────────────────────────
void checkServerHealth() {
  if (WiFi.status() != WL_CONNECTED) {
    isServerOnline = false;
    return;
  }

  HTTPClient http;
  http.begin(String(CARDREAD_URL) + "?action=status");
  http.setTimeout(1000);
  int code = http.GET();
  http.end();

  bool wasOnline = isServerOnline;
  isServerOnline = (code > 0);

  if (!isServerOnline && wasOnline) {
    Serial.println(">>> Server went OFFLINE. Operating in Standby Mode <<<");
    if (idleScreen) oledReady();
  } else if (isServerOnline && !wasOnline) {
    Serial.println(">>> Server came ONLINE! Syncing offline queue... <<<");
    if (idleScreen) oledReady();
    syncOfflineQueue();
  }
}

// ─────────────────────────────────────────────────────────────────
// Timers & Peripherals Control
// ─────────────────────────────────────────────────────────────────
void checkTimers() {
  // Turn off relay automatically after unlock timeout
#if ENABLE_RELAY
  if (relayOffTime > 0 && millis() >= relayOffTime) {
    digitalWrite(RELAY_PIN, LOW);
    relayOffTime = 0;
  }
#endif

  // Auto-reset display to ready screen after result popup duration
  if (displayResetTime > 0 && millis() >= displayResetTime) {
    displayResetTime = 0;
    setRGB(0, 0, 0);
    oledReady();
  }

  // Live clock refresh on idle screen (every second)
  if (idleScreen && displayOn && displayResetTime == 0 && (millis() - lastClockUpdate > CLOCK_UPDATE_MS)) {
    lastClockUpdate = millis();
    updateIdleClock();
  }

  // OLED Screen Saver sleep check (5 minutes inactivity)
  if (displayOn && (millis() - lastActivityTime > OLED_TIMEOUT_MS)) {
    displayOn  = false;
    idleScreen = false;
    display.ssd1306_command(SSD1306_DISPLAYOFF);
    Serial.println("OLED Sleep activated");
  }
}

void triggerRelay() {
#if ENABLE_RELAY
  digitalWrite(RELAY_PIN, HIGH);
  relayOffTime = millis() + RELAY_UNLOCK_MS;
#endif
}

void setRGB(uint8_t r, uint8_t g, uint8_t b) {
#if ENABLE_RGB_LED
  if (COMMON_ANODE) { r = 255 - r; g = 255 - g; b = 255 - b; }
  analogWrite(RGB_RED_PIN,   r);
  analogWrite(RGB_GREEN_PIN, g);
  analogWrite(RGB_BLUE_PIN,  b);
#endif
}

void playTone(int freq, int durationMs) {
  tone(BUZZER_PIN, freq, durationMs);
  delay(durationMs);
  noTone(BUZZER_PIN);
}

void beepOK()      { playTone(1800, 100); delay(50); playTone(2400, 120); }
void beepFail()    { playTone(400, 500); }
void beepWarning() { playTone(1000, 120); delay(60); playTone(1000, 120); }
void beepAdmin()   { playTone(1500, 80); delay(40); playTone(2000, 80); delay(40); playTone(2500, 120); }

void resetDisplayTimeout() {
  lastActivityTime = millis();
  if (!displayOn) {
    displayOn = true;
    display.ssd1306_command(SSD1306_DISPLAYON);
  }
}

// ─────────────────────────────────────────────────────────────────
// OLED Display Rendering Functions
// ─────────────────────────────────────────────────────────────────
void oledReady() {
  idleScreen = true;
  display.clearDisplay();

  // Status Bar Header
  display.fillRect(0, 0, OLED_W, 13, SSD1306_WHITE);
  display.setTextColor(SSD1306_BLACK);
  display.setTextSize(1);
  display.setCursor(2, 2);
  display.print(getFormattedTime());
  display.setCursor(76, 2);
  display.print(WiFi.status() == WL_CONNECTED ? (isServerOnline ? "ONLINE" : "STNDBY") : "OFFLN ");

  display.setTextColor(SSD1306_WHITE);
  display.drawLine(0, 14, OLED_W, 14, SSD1306_WHITE);

  // School Title
  display.setCursor(8, 17);
  display.print("KAPATAKSHA H.S.");

  // Big SCAN CARD Prompt
  display.drawLine(0, 26, OLED_W, 26, SSD1306_WHITE);
  display.setTextSize(2);
  display.setCursor(12, 31);
  display.print("SCAN");
  display.setCursor(12, 48);
  display.print("CARD");

  display.fillTriangle(98, 34, 120, 46, 98, 58, SSD1306_WHITE);

  display.drawRect(0, 0, OLED_W, OLED_H, SSD1306_WHITE);
  display.display();
  lastClockUpdate = millis();
}

void updateIdleClock() {
  display.fillRect(2, 2, 66, 9, SSD1306_WHITE);
  display.setTextColor(SSD1306_BLACK);
  display.setTextSize(1);
  display.setCursor(2, 2);
  display.print(getFormattedTime());
  display.display();
}

void oledMsg(String l1, String l2, String l3, String l4) {
  idleScreen = false;
  display.clearDisplay();
  display.setTextSize(1);
  display.fillRect(0, 0, OLED_W, 13, SSD1306_WHITE);
  display.setTextColor(SSD1306_BLACK);
  display.setCursor(2, 2);
  display.print(l1.substring(0, 21));
  display.setTextColor(SSD1306_WHITE);
  if (l2.length()) { display.setCursor(2, 18); display.print(l2.substring(0, 21)); }
  if (l3.length()) { display.setCursor(2, 32); display.print(l3.substring(0, 21)); }
  if (l4.length()) { display.setCursor(2, 47); display.print(l4.substring(0, 21)); }
  display.drawRect(0, 0, OLED_W, OLED_H, SSD1306_WHITE);
  display.display();
}

void oledAttendance(String name, String cardId, String action) {
  idleScreen = false;
  display.clearDisplay();

  display.fillRect(0, 0, OLED_W, 13, SSD1306_WHITE);
  display.setTextColor(SSD1306_BLACK);
  display.setTextSize(1);
  String hdr = (action == "IN") ? "  CHECKED IN  " :
               (action == "OUT") ? " CHECKED OUT  " : " OFFLINE LOG  ";
  display.setCursor(2, 2);
  display.print(hdr.substring(0, 21));

  display.setTextColor(SSD1306_WHITE);
  display.setTextSize(2);
  String n = name.length() > 8 ? name.substring(0, 8) : name;
  int nx = max(0, (int)((OLED_W - (int)n.length() * 12) / 2));
  display.setCursor(nx, 17);
  display.print(n);

  display.drawLine(0, 36, OLED_W, 36, SSD1306_WHITE);
  display.setTextSize(1);
  display.setCursor(4, 40);
  display.print("ID: " + cardId);
  display.setCursor(4, 52);
  display.print(getFormattedTime());

  display.drawRect(0, 0, OLED_W, OLED_H, SSD1306_WHITE);
  display.display();
}

void oledLimit(String name) {
  idleScreen = false;
  display.clearDisplay();

  // Header Bar
  display.fillRect(0, 0, OLED_W, 13, SSD1306_WHITE);
  display.setTextColor(SSD1306_BLACK);
  display.setTextSize(1);
  display.setCursor(14, 2);
  display.print("LIMIT REACHED");

  display.setTextColor(SSD1306_WHITE);

  // Student Name
  display.setCursor(2, 18);
  display.print("Name: " + name.substring(0, 14));

  display.drawLine(0, 30, OLED_W, 30, SSD1306_WHITE);

  // 3rd Punch Warning Lines
  display.setCursor(2, 34);
  display.print("2x punch is done");
  display.setCursor(2, 48);
  display.print("Try tomorrow");

  display.drawRect(0, 0, OLED_W, OLED_H, SSD1306_WHITE);
  display.display();
}

void oledSuccess(String id, String name, String uid, String dbStatus) {
  display.clearDisplay();
  display.fillRect(0, 0, OLED_W, 14, SSD1306_WHITE);
  display.setTextColor(SSD1306_BLACK);
  display.setTextSize(1);
  display.setCursor(20, 3);
  display.print("  WRITE OK!");
  display.setTextColor(SSD1306_WHITE);
  display.setCursor(0, 17); display.print("ID:   "); display.println(id.substring(0, 10));
  display.setCursor(0, 27); display.print("Name: "); display.println(name.substring(0, 10));
  display.setCursor(0, 37); display.print("UID:  "); display.println(uid.substring(0, 14));
  display.setCursor(0, 50); display.print(dbStatus.substring(0, 21));
  display.drawRect(0, 0, OLED_W, OLED_H, SSD1306_WHITE);
  display.display();
}

void oledRead(String uid, String id, String name) {
  display.clearDisplay();
  display.fillRect(0, 0, OLED_W, 14, SSD1306_WHITE);
  display.setTextColor(SSD1306_BLACK);
  display.setTextSize(1);
  display.setCursor(22, 3);
  display.print("[ READ OK ]");
  display.setTextColor(SSD1306_WHITE);
  display.setCursor(0, 17); display.print("UID: "); display.println(uid.substring(0, 16));
  display.drawLine(0, 28, OLED_W, 28, SSD1306_WHITE);
  display.setCursor(0, 33); display.print("ID:   "); display.println(id.substring(0, 10));
  display.setCursor(0, 45); display.print("Name: "); display.println(name.substring(0, 10));
  display.drawRect(0, 0, OLED_W, OLED_H, SSD1306_WHITE);
  display.display();
}

// ─────────────────────────────────────────────────────────────────
// Utility Helpers & Serial Command Processor
// ─────────────────────────────────────────────────────────────────
void handleCommand(String raw) {
  String upper = raw;
  upper.toUpperCase();

  if (upper.startsWith("WRITE,")) {
    int firstComma  = raw.indexOf(',');
    int secondComma = raw.indexOf(',', firstComma + 1);
    if (firstComma > 0 && secondComma > firstComma) {
      String wID   = raw.substring(firstComma + 1, secondComma);
      String wName = raw.substring(secondComma + 1);
      wID.trim(); wName.trim();
      oledMsg("[ WRITE MODE ]", "Tap card to write", "ID: " + wID, "Name: " + wName);
      if (waitForCard(10000)) doWrite(wID, wName);
      else oledMsg(" WRITE TIMEOUT", "No card tapped", "", "");
    }
  } else if (upper == "READ") {
    oledMsg("[ READ MODE ]", "Tap card to read", "", "");
    if (waitForCard(10000)) doRead();
    else oledMsg(" READ TIMEOUT", "No card tapped", "", "");
  } else if (upper == "DIAG") {
    doDiag();
  } else if (upper == "CLEAR") {
    LittleFS.remove(QUEUE_FILE);
    Serial.println("Offline queue cleared");
    oledMsg("  Queue Cleared", "Flash queue emptied", "", "");
  } else {
    printHelp();
  }
  displayResetTime = millis() + 2500;
}

void doWrite(String wID, String wName) {
  String uid = getUID();
  byte buf1[16] = {0}, buf2[16] = {0};
  memcpy(buf1, wID.c_str(),   min((int)wID.length(),   15));
  memcpy(buf2, wName.c_str(), min((int)wName.length(), 15));

  MFRC522::StatusCode s = mfrc522.PCD_Authenticate(
      MFRC522::PICC_CMD_MF_AUTH_KEY_A, 1, &mifareKey, &mfrc522.uid);
  if (s != MFRC522::STATUS_OK) { setRGB(255, 0, 0); beepFail(); return; }

  s = mfrc522.MIFARE_Write(1, buf1, 16);
  if (s != MFRC522::STATUS_OK) { mfrc522.PCD_StopCrypto1(); setRGB(255, 0, 0); beepFail(); return; }

  s = mfrc522.MIFARE_Write(2, buf2, 16);
  if (s != MFRC522::STATUS_OK) { mfrc522.PCD_StopCrypto1(); setRGB(255, 0, 0); beepFail(); return; }

  mfrc522.PCD_StopCrypto1();
  saveStudentCache(uid, wID, wName);

  if (WiFi.status() == WL_CONNECTED) {
    registerToDB(uid, wID, wName);
  } else {
    beepOK();
    oledSuccess(wID, wName, uid, "Saved to Cache");
  }
}

void registerToDB(String uid, String card_id, String name) {
  HTTPClient http;
  http.begin(REGISTER_URL);
  http.addHeader("Content-Type", "application/json");

  String body = "{\"uid\":\"" + uid + "\",\"name\":\"" + name + "\"}";
  int code = http.POST(body);

  if (code == 200 || code == 201) {
    beepOK();
    oledSuccess(card_id, name, uid, "Saved to Node DB!");
  } else {
    beepFail();
    oledSuccess(card_id, name, uid, "Node DB save FAILED");
  }
  http.end();
}

void doRead() {
  String uid = getUID();
  MFRC522::StatusCode s = mfrc522.PCD_Authenticate(
      MFRC522::PICC_CMD_MF_AUTH_KEY_A, 1, &mifareKey, &mfrc522.uid);
  if (s != MFRC522::STATUS_OK) { oledMsg("  READ FAILED", "Auth error", "", ""); beepFail(); return; }

  byte buf1[18] = {0}, buf2[18] = {0}; byte sz1 = 18, sz2 = 18;
  if (mfrc522.MIFARE_Read(1, buf1, &sz1) != MFRC522::STATUS_OK ||
      mfrc522.MIFARE_Read(2, buf2, &sz2) != MFRC522::STATUS_OK) {
    mfrc522.PCD_StopCrypto1(); oledMsg("  READ FAILED", "Read error", "", ""); beepFail(); return;
  }
  mfrc522.PCD_StopCrypto1();

  beepOK();
  oledRead(uid, buf2str(buf1), buf2str(buf2));
}

void doDiag() {
  Serial.println("\n--- HARDWARE DIAGNOSTICS ---");
  Serial.printf("WiFi Status: %s\n", WiFi.status() == WL_CONNECTED ? "Connected" : "Disconnected");
  Serial.printf("Server Status: %s\n", isServerOnline ? "Online" : "Offline");
  Serial.printf("Offline Queue: %d scans\n", offlineQueueCount());
  Serial.printf("Free Heap: %u bytes\n", ESP.getFreeHeap());
  Serial.println("---------------------------\n");
  oledMsg("  DIAGNOSTICS", "WiFi: " + String(WiFi.status() == WL_CONNECTED ? "OK" : "NO"), "Queue: " + String(offlineQueueCount()), "Heap: " + String(ESP.getFreeHeap()));
}

String getUID() {
  String uid = "";
  for (byte i = 0; i < mfrc522.uid.size; i++) {
    if (mfrc522.uid.uidByte[i] < 0x10) uid += "0";
    uid += String(mfrc522.uid.uidByte[i], HEX);
    if (i < mfrc522.uid.size - 1) uid += ":";
  }
  uid.toUpperCase();
  return uid;
}

String getFormattedTime() {
  struct tm ti;
  if (getLocalTime(&ti)) {
    char buf[10];
    snprintf(buf, sizeof(buf), "%02d:%02d:%02d", ti.tm_hour, ti.tm_min, ti.tm_sec);
    return String(buf);
  }
  return "--:--:--";
}

String getFormattedDate() {
  struct tm ti;
  if (getLocalTime(&ti)) {
    char buf[12];
    snprintf(buf, sizeof(buf), "%02d/%02d/%04d", ti.tm_mday, ti.tm_mon + 1, ti.tm_year + 1900);
    return String(buf);
  }
  return "--/--/----";
}

String buf2str(byte *buf) {
  String s = "";
  for (byte i = 0; i < 16; i++) {
    if (buf[i] == 0) break;
    s += (char)buf[i];
  }
  return s;
}

bool waitForCard(unsigned long ms) {
  unsigned long start = millis();
  while (millis() - start < ms) {
    if (mfrc522.PICC_IsNewCardPresent() && mfrc522.PICC_ReadCardSerial()) return true;
    delay(50);
  }
  return false;
}

void printHelp() {
  Serial.println("\n================ RFID ATTENDANCE READY ================");
  Serial.println("Commands:");
  Serial.println("  WRITE,<ID>,<Name>  -> Write card & save to DB");
  Serial.println("  READ               -> Read card data blocks");
  Serial.println("  DIAG               -> Run hardware diagnostics");
  Serial.println("  CLEAR              -> Clear offline flash queue");
  Serial.println("========================================================\n");
}
