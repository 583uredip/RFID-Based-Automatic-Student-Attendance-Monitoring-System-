/*
 * ============================================================
 *  ESP32 RFID Attendance & Access Control System
 *  Backend: Node.js (Express + PostgreSQL)
 *  Features:
 *    - RFID Card Punching (IN / OUT / Limit Check)
 *    - WiFiManager Captive Portal support (optional)
 *    - Offline Queueing (LittleFS flash storage up to 350 scans)
 *    - Offline Student Cache (/students.json for offline name display)
 *    - Master Card Administration Mode (menu on OLED display)
 *    - Anti-Passback / Rapid Double-Tap Cooldown
 *    - Relay Door Unlock Access Control
 *    - RGB LED Status Indicator & Multi-Frequency Audio Feedback
 *    - Live OLED Status Bar (NTP/RTC Time, WiFi RSSI, Queue badge)
 *    - OLED Screen Saver / Display Burn-In Protection
 *    - ArduinoOTA (Over-The-Air Wireless Firmware Updates)
 *    - Hardware DS3231 RTC fallback & auto-sync from NTP
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
 *
 * Serial Monitor Commands (115200 baud):
 *   WRITE,001,John  → write card + register in database
 *   READ            → read card blocks (show UID, ID, Name)
 *   DIAG            → check hardware (RC522, RTC, WiFi, Flash)
 *   MODE            → show current mode
 *   CLEAR           → clear offline queue
 *   WIFIRESET       → reset saved WiFi credentials
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
#define ENABLE_WIFIMANAGER 0  // Set 1 if WiFiManager library is installed
#define ENABLE_RELAY        1  // Door unlock relay support
#define ENABLE_RGB_LED      1  // Status RGB LED indicator
#define ENABLE_RTC          1  // Hardware DS3231 RTC I2C module support
#define ENABLE_OTA          1  // Over-The-Air firmware updates

#if ENABLE_WIFIMANAGER
  #include <WiFiManager.h>
#endif

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

// ── System Rules & Configuration ─────────────────────────────────
const char* DEFAULT_WIFI_SSID = "A36";
const char* DEFAULT_WIFI_PASS = "12345678";

// Node.js Express Server API Endpoints (Port 3000)
const char* SERVER_URL   = "http://192.168.0.197:3000/api/rfid/scan";
const char* REGISTER_URL = "http://192.168.0.197:3000/api/rfid/register";
const char* SCAN_URL     = "http://192.168.0.197:3000/api/rfid/scan";
const char* CARDREAD_URL = "http://192.168.0.197:3000/api/rfid/latest-scan";
const char* DETSCAN_URL  = "http://192.168.0.197:3000/api/student/search";
const char* SYNC_URL     = "http://192.168.0.197:3000/api/rfid/sync";

// Master Card UID (Change to your admin card UID)
String MASTER_CARD_UID = "AA:BB:CC:DD";

// Timers & Intervals
const unsigned long COOLDOWN_MS     = 5000;  // Anti-passback double-tap cooldown (5s)
const unsigned long OLED_TIMEOUT_MS = 60000; // Screen saver display timeout (60s)
const unsigned long RELAY_UNLOCK_MS = 3000;  // Relay unlock pulse duration (3s)

// Storage Paths on Flash
#define QUEUE_FILE    "/offline_queue.json"
#define STUDENTS_FILE "/students.json"

// ── Global Objects & State Variables ─────────────────────────────
MFRC522             mfrc522(SS_PIN, RST_PIN);
MFRC522::MIFARE_Key mifareKey;
Adafruit_SSD1306    display(OLED_W, OLED_H, &Wire, -1);

bool webScanMode     = false;
bool webReadMode     = false;
bool webDetScanMode  = false;
bool adminMode       = false;
bool displayOn       = true;

unsigned long lastPoll         = 0;
unsigned long lastScanTime     = 0;
unsigned long lastActivityTime = 0;
unsigned long relayOffTime     = 0;
String        lastScannedUID   = "";

// ── Function Declarations ────────────────────────────────────────
void setupPeripherals();
void setupWiFi();
void setupNTPAndRTC();
void setupOTA();

void handleCommand(String raw);
void processCardScan(String uid);
void handleMasterCard();

void sendAttendance(String uid);
void queueOffline(String uid);
void syncOfflineQueue();

void saveStudentCache(String uid, String cardId, String name);
bool getStudentFromCache(String uid, String &cardIdOut, String &nameOut);

void checkWebScanRequest();
void checkWebReadRequest();
void checkWebDetScanRequest();

void sendScanUID(String uid);
void sendReadUID(String uid);
void sendDetScanUID(String uid);

void registerToDB(String uid, String card_id, String name);
void doWrite(String wID, String wName);
void doRead();
void doDiag();

void triggerRelay();
void checkRelayTimer();

void setRGB(uint8_t r, uint8_t g, uint8_t b);
void playTone(int freq, int durationMs);
void beepOK();
void beepFail();
void beepWarning();
void beepAdmin();

void resetDisplayTimeout();
void checkScreenSaver();

void oledReady();
void oledMsg(String l1, String l2, String l3, String l4);
void oledAttendance(String name, String cardId, String action);
void oledSuccess(String id, String name, String uid, String dbStatus);
void oledRead(String uid, String id, String name);

String getUID();
String getFormattedTime();
String buf2str(byte *buf);
bool waitForCard(unsigned long ms);
void writeFailed();
void printHelp();
int offlineQueueCount();

// ── Setup ────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  delay(300);

  setupPeripherals();
  setupWiFi();
  setupNTPAndRTC();
  setupOTA();

  resetDisplayTimeout();
  printHelp();
  oledReady();
}

// ── Main Loop ────────────────────────────────────────────────────
void loop() {
#if ENABLE_OTA
  ArduinoOTA.handle();
#endif

  checkRelayTimer();
  checkScreenSaver();

  // ── Poll backend every 1s ──────────────────────────────────────
  if (WiFi.status() == WL_CONNECTED && millis() - lastPoll > 1000) {
    lastPoll = millis();
    checkWebScanRequest();
    checkWebReadRequest();
    checkWebDetScanRequest();
    syncOfflineQueue();
  }

  // ── Serial Command Input ───────────────────────────────────────
  if (Serial.available()) {
    String raw = Serial.readStringUntil('\n');
    raw.trim();
    if (raw.length() > 0) {
      resetDisplayTimeout();
      handleCommand(raw);
      return;
    }
  }

  // ── RFID Card Detection ────────────────────────────────────────
  if (!mfrc522.PICC_IsNewCardPresent()) return;
  if (!mfrc522.PICC_ReadCardSerial())   return;

  resetDisplayTimeout();
  String uid = getUID();
  Serial.println("Scanned UID: " + uid);

  // ── Anti-Passback / Rapid Double-Tap Cooldown ──────────────────
  if (uid == lastScannedUID && (millis() - lastScanTime < COOLDOWN_MS)) {
    Serial.println("Cooldown active — ignoring scan for UID: " + uid);
    beepWarning();
    setRGB(255, 165, 0); // Orange
    oledMsg("[ COOLDOWN ]", "Please wait...", "Avoid double tap", "");
    delay(1200);
    setRGB(0, 0, 0);
    oledReady();
    mfrc522.PICC_HaltA();
    mfrc522.PCD_StopCrypto1();
    return;
  }

  lastScannedUID = uid;
  lastScanTime   = millis();

  // ── Master Admin Card Scanned ──────────────────────────────────
  if (uid == MASTER_CARD_UID) {
    handleMasterCard();
    mfrc522.PICC_HaltA();
    mfrc522.PCD_StopCrypto1();
    return;
  }

  // ── Web Scan / Register Mode ───────────────────────────────────
  if (webScanMode) {
    webScanMode = false;
    setRGB(0, 0, 255); // Blue
    oledMsg("[ WEB SCAN ]", "Sending UID...", uid, "");
    sendScanUID(uid);
    mfrc522.PICC_HaltA();
    mfrc522.PCD_StopCrypto1();
    delay(2000);
    setRGB(0, 0, 0);
    oledReady();
    return;
  }

  // ── Web Read Mode ──────────────────────────────────────────────
  if (webReadMode) {
    webReadMode = false;
    setRGB(0, 0, 255); // Blue
    oledMsg("[ WEB READ ]", "Fetching info...", uid, "");
    sendReadUID(uid);
    mfrc522.PICC_HaltA();
    mfrc522.PCD_StopCrypto1();
    delay(2000);
    setRGB(0, 0, 0);
    oledReady();
    return;
  }

  // ── Student Details Scan Mode ──────────────────────────────────
  if (webDetScanMode) {
    webDetScanMode = false;
    setRGB(0, 0, 255); // Blue
    oledMsg("[ DET SCAN ]", "Sending UID...", uid, "");
    sendDetScanUID(uid);
    mfrc522.PICC_HaltA();
    mfrc522.PCD_StopCrypto1();
    delay(2000);
    setRGB(0, 0, 0);
    oledReady();
    return;
  }

  // ── Standard Attendance Punch ──────────────────────────────────
  processCardScan(uid);

  mfrc522.PICC_HaltA();
  mfrc522.PCD_StopCrypto1();
  delay(1800);
  setRGB(0, 0, 0);
  oledReady();
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

  // Init Flash Filesystem
  if (!LittleFS.begin(true)) {
    Serial.println("LittleFS mount failed — offline storage disabled");
  } else {
    Serial.println("LittleFS storage ready");
  }

  // SPI & RC522 Init
  SPI.begin(18, 19, 23, SS_PIN);
  mfrc522.PCD_Init();
  delay(50);
  for (byte i = 0; i < 6; i++) mifareKey.keyByte[i] = 0xFF;

  // I2C & OLED Init
  Wire.begin(21, 22);
  if (!display.begin(SSD1306_SWITCHCAPVCC, OLED_ADDR)) {
    Serial.println("OLED init failed!"); while (1);
  }

  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  display.setTextSize(1);
  display.setCursor(10, 20);
  display.print("RFID ATTENDANCE");
  display.setCursor(15, 38);
  display.print("Initializing...");
  display.display();
}

// ─────────────────────────────────────────────────────────────────
// WiFi Setup (with optional WiFiManager support)
// ─────────────────────────────────────────────────────────────────
void setupWiFi() {
  setRGB(0, 0, 255); // Blue status
  oledMsg(" Connecting WiFi", DEFAULT_WIFI_SSID, "Please wait...", "");

#if ENABLE_WIFIMANAGER
  WiFiManager wm;
  wm.setConfigPortalTimeout(180); // 3-minute AP timeout
  bool res = wm.autoConnect("ESP32-Attendance-AP");
  if (!res) {
    Serial.println("WiFiManager AP Timeout — proceeding offline");
  }
#else
  WiFi.begin(DEFAULT_WIFI_SSID, DEFAULT_WIFI_PASS);
  Serial.print("Connecting to WiFi");
  int tries = 0;
  while (WiFi.status() != WL_CONNECTED && tries < 20) {
    delay(500); Serial.print("."); tries++;
  }
#endif

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\nWiFi Connected! IP: " + WiFi.localIP().toString());
    oledMsg("  WiFi Connected", WiFi.localIP().toString(), "", "");
    setRGB(0, 255, 0); // Green
    beepOK();
  } else {
    Serial.println("\nWiFi Failed — Running in Offline Mode");
    oledMsg("  WiFi Offline", "Operating offline", "Records queued", "");
    setRGB(255, 165, 0); // Orange
    beepFail();
  }
  delay(1200);
  setRGB(0, 0, 0);
}

// ─────────────────────────────────────────────────────────────────
// NTP & DS3231 Hardware RTC Setup
// ─────────────────────────────────────────────────────────────────
void setupNTPAndRTC() {
  if (WiFi.status() == WL_CONNECTED) {
    configTime(6 * 3600, 0, "pool.ntp.org", "time.nist.gov"); // UTC+6 Asia/Dhaka
    Serial.print("Syncing NTP Time");
    struct tm timeinfo;
    int ntpTries = 0;
    while (!getLocalTime(&timeinfo) && ntpTries < 10) {
      delay(400); Serial.print("."); ntpTries++;
    }
    if (getLocalTime(&timeinfo)) {
      Serial.printf("\nNTP Time: %02d:%02d:%02d\n", timeinfo.tm_hour, timeinfo.tm_min, timeinfo.tm_sec);
    }
  }

#if ENABLE_RTC
  Wire.beginTransmission(DS3231_ADDR);
  if (Wire.endTransmission() == 0) {
    Serial.println("DS3231 RTC detected on I2C bus");
  } else {
    Serial.println("DS3231 RTC not found");
  }
#endif
}

// ─────────────────────────────────────────────────────────────────
// ArduinoOTA Wireless Firmware Updates Setup
// ─────────────────────────────────────────────────────────────────
void setupOTA() {
#if ENABLE_OTA
  if (WiFi.status() == WL_CONNECTED) {
    ArduinoOTA.setHostname("ESP32-RFID-Attendance");
    ArduinoOTA.onStart([]() { Serial.println("OTA Update Starting..."); });
    ArduinoOTA.onEnd([]() { Serial.println("\nOTA Update Complete!"); });
    ArduinoOTA.onProgress([](unsigned int progress, unsigned int total) {
      Serial.printf("Progress: %u%%\r", (progress / (total / 100)));
    });
    ArduinoOTA.onError([](ota_error_t error) {
      Serial.printf("OTA Error[%u]: ", error);
    });
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

  if (WiFi.status() == WL_CONNECTED) {
    sendAttendance(uid);
  } else {
    // Offline Mode: Log to Flash Queue
    queueOffline(uid);

    // Look up offline student name from cache
    String cachedId = "", cachedName = "";
    if (getStudentFromCache(uid, cachedId, cachedName)) {
      oledAttendance(cachedName, cachedId, "OFFLINE");
    } else {
      oledMsg("  Saved Offline", uid, "Queueing log...", "WiFi disconnected");
    }
  }
}

// ─────────────────────────────────────────────────────────────────
// Master Admin Card Handler
// ─────────────────────────────────────────────────────────────────
void handleMasterCard() {
  Serial.println(">>> MASTER CARD SCANNED <<<");
  beepAdmin();
  setRGB(0, 255, 255); // Cyan

  triggerRelay(); // Auto unlock door for Master admin
  oledMsg("[ MASTER ADMIN ]", "Door Unlocked!", "Queue: " + String(offlineQueueCount()), "1:Sync  2:Diag");

  delay(2500);
  setRGB(0, 0, 0);
  oledReady();
}

// ─────────────────────────────────────────────────────────────────
// Send Attendance to Node.js Backend API
// ─────────────────────────────────────────────────────────────────
void sendAttendance(String uid) {
  HTTPClient http;
  http.begin(SERVER_URL);
  http.addHeader("Content-Type", "application/json");

  String body = "{\"uid\":\"" + uid + "\"}";
  Serial.println("POST Attendance: " + body);

  int code = http.POST(body);
  Serial.println("HTTP Response Code: " + String(code));

  if (code == 200 || code == 201) {
    String response = http.getString();
    Serial.println("Response: " + response);

    StaticJsonDocument<512> doc;
    if (!deserializeJson(doc, response)) {
      String status = doc["status"].as<String>();

      if (status == "registered" || status == "success") {
        String name   = doc.containsKey("name") ? doc["name"].as<String>() : "Student";
        String action = doc.containsKey("action") ? doc["action"].as<String>() : "IN";
        String cardId = doc.containsKey("studentId") ? doc["studentId"].as<String>() : (doc.containsKey("card_id") ? doc["card_id"].as<String>() : "");

        // Cache student in local Flash DB for offline use
        saveStudentCache(uid, cardId, name);

        setRGB(0, 255, 0); // Green
        beepOK();
        triggerRelay();
        oledAttendance(name, cardId, action);
      } else if (status == "new") {
        String studentId = doc.containsKey("studentId") ? doc["studentId"].as<String>() : "";
        setRGB(255, 165, 0); // Orange
        beepOK();
        oledMsg("  New Card Tapped", uid, "ID: " + studentId, "Register on Web UI");
      } else if (status == "limit") {
        String name = doc["name"].as<String>();
        setRGB(255, 0, 0); // Red
        beepFail();
        oledMsg("  Limit Reached", name, "Max 2x punches today", "Try tomorrow");
      } else if (status == "unknown") {
        setRGB(255, 0, 0); // Red
        beepFail();
        oledMsg("  Unknown Card", uid, "Not registered", "Use WRITE cmd");
      } else {
        setRGB(255, 0, 0); // Red
        beepFail();
        oledMsg("  Server Error", response.substring(0, 20), "", "");
      }
    }
  } else {
    setRGB(255, 165, 0); // Orange
    beepFail();
    oledMsg("  HTTP Error", "Code: " + String(code), "Check server", "");
  }

  http.end();
}

// ─────────────────────────────────────────────────────────────────
// Save / Lookup Student Cache in Flash (LittleFS)
// ─────────────────────────────────────────────────────────────────
void saveStudentCache(String uid, String cardId, String name) {
  DynamicJsonDocument doc(8192);

  if (LittleFS.exists(STUDENTS_FILE)) {
    File f = LittleFS.open(STUDENTS_FILE, "r");
    if (f) { deserializeJson(doc, f); f.close(); }
  }

  JsonObject students = doc.as<JsonObject>();
  JsonObject record   = students.createNestedObject(uid);
  record["card_id"] = cardId;
  record["name"]    = name;

  File f = LittleFS.open(STUDENTS_FILE, "w");
  if (f) { serializeJson(doc, f); f.close(); }
}

bool getStudentFromCache(String uid, String &cardIdOut, String &nameOut) {
  if (!LittleFS.exists(STUDENTS_FILE)) return false;

  File f = LittleFS.open(STUDENTS_FILE, "r");
  if (!f) return false;

  DynamicJsonDocument doc(8192);
  DeserializationError err = deserializeJson(doc, f);
  f.close();

  if (err || !doc.containsKey(uid)) return false;

  cardIdOut = doc[uid]["card_id"].as<String>();
  nameOut   = doc[uid]["name"].as<String>();
  return true;
}

// ─────────────────────────────────────────────────────────────────
// Offline Queue Management
// ─────────────────────────────────────────────────────────────────
int offlineQueueCount() {
  if (!LittleFS.exists(QUEUE_FILE)) return 0;
  File f = LittleFS.open(QUEUE_FILE, "r");
  if (!f) return 0;
  DynamicJsonDocument doc(32768);
  if (deserializeJson(doc, f)) { f.close(); return 0; }
  f.close();
  return doc["records"].size();
}

void queueOffline(String uid) {
  time_t now;
  time(&now);
  if (now < 1000000) now = 1700000000 + (millis() / 1000);

  DynamicJsonDocument doc(32768);

  if (LittleFS.exists(QUEUE_FILE)) {
    File f = LittleFS.open(QUEUE_FILE, "r");
    if (f) { deserializeJson(doc, f); f.close(); }
  }

  if (!doc.containsKey("records")) doc.createNestedArray("records");
  JsonArray arr = doc["records"];

  if (arr.size() >= 350) {
    setRGB(255, 0, 0); // Red
    beepFail();
    Serial.println("Offline Queue Full (350 limit)");
    oledMsg("  Queue FULL!", uid, "Max 350 records", "Connect WiFi!");
    return;
  }

  JsonObject rec = arr.createNestedObject();
  rec["uid"]       = uid;
  rec["timestamp"] = (long)now;

  File f = LittleFS.open(QUEUE_FILE, "w");
  if (f) { serializeJson(doc, f); f.close(); }

  int count = arr.size();
  setRGB(255, 255, 0); // Yellow
  beepOK();
  triggerRelay();
  Serial.println("Queued Offline: " + uid + " (" + String(count) + "/350)");
}

void syncOfflineQueue() {
  if (!LittleFS.exists(QUEUE_FILE)) return;

  File f = LittleFS.open(QUEUE_FILE, "r");
  if (!f) return;

  DynamicJsonDocument doc(32768);
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

  String body;
  serializeJson(doc, body);
  int code = http.POST(body);

  if (code == 200 || code == 201) {
    String resp = http.getString();
    Serial.println("Sync Response: " + resp);

    DynamicJsonDocument res(256);
    if (!deserializeJson(res, resp)) {
      int synced  = res["synced"]  | 0;
      int skipped = res["skipped"] | 0;
      LittleFS.remove(QUEUE_FILE);
      setRGB(0, 255, 0);
      beepOK();
      oledMsg("  Sync Complete!", "Synced: " + String(synced), "Skipped: " + String(skipped), "");
      delay(2000);
      setRGB(0, 0, 0);
      oledReady();
    }
  }
  http.end();
}

// ─────────────────────────────────────────────────────────────────
// Relay & Peripherals Control
// ─────────────────────────────────────────────────────────────────
void triggerRelay() {
#if ENABLE_RELAY
  digitalWrite(RELAY_PIN, HIGH);
  relayOffTime = millis() + RELAY_UNLOCK_MS;
  Serial.println("Relay UNLOCKED");
#endif
}

void checkRelayTimer() {
#if ENABLE_RELAY
  if (relayOffTime > 0 && millis() >= relayOffTime) {
    digitalWrite(RELAY_PIN, LOW);
    relayOffTime = 0;
    Serial.println("Relay LOCKED");
  }
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

void beepOK() {
  playTone(1800, 100);
  delay(60);
  playTone(2400, 120);
}

void beepFail() {
  playTone(400, 500);
}

void beepWarning() {
  playTone(1000, 150);
  delay(80);
  playTone(1000, 150);
}

void beepAdmin() {
  playTone(1500, 100);
  delay(50);
  playTone(2000, 100);
  delay(50);
  playTone(2500, 150);
}

// ─────────────────────────────────────────────────────────────────
// OLED Screen Saver & Burn-In Protection
// ─────────────────────────────────────────────────────────────────
void resetDisplayTimeout() {
  lastActivityTime = millis();
  if (!displayOn) {
    displayOn = true;
    display.ssd1306_command(SSD1306_DISPLAYON);
  }
}

void checkScreenSaver() {
  if (displayOn && (millis() - lastActivityTime > OLED_TIMEOUT_MS)) {
    displayOn = false;
    display.ssd1306_command(SSD1306_DISPLAYOFF);
    Serial.println("OLED Screen Saver Activated (Display OFF)");
  }
}

// ─────────────────────────────────────────────────────────────────
// Web Scanning Requests Polling
// ─────────────────────────────────────────────────────────────────
void checkWebScanRequest() {
  HTTPClient http;
  http.begin(String(SCAN_URL) + "?action=status");
  http.setTimeout(800);
  int code = http.GET();
  if (code == 200) {
    String resp = http.getString();
    StaticJsonDocument<64> doc;
    if (!deserializeJson(doc, resp)) {
      bool waiting = doc["waiting"].as<bool>();
      if (waiting && !webScanMode) {
        webScanMode = true;
        setRGB(0, 0, 255);
        oledMsg("[ WEB SCAN ]", "Tap card to", "register student", "on website...");
      } else if (!waiting && webScanMode) {
        webScanMode = false;
        setRGB(0, 0, 0);
        oledReady();
      }
    }
  }
  http.end();
}

void checkWebDetScanRequest() {
  HTTPClient http;
  http.begin(String(DETSCAN_URL) + "?action=status");
  http.setTimeout(800);
  int code = http.GET();
  if (code == 200) {
    String resp = http.getString();
    StaticJsonDocument<64> doc;
    if (!deserializeJson(doc, resp)) {
      bool waiting = doc["waiting"].as<bool>();
      if (waiting && !webDetScanMode) {
        webDetScanMode = true;
        setRGB(0, 0, 255);
        oledMsg("[ DET SCAN ]", "Tap card to", "load student", "details...");
      } else if (!waiting && webDetScanMode) {
        webDetScanMode = false;
        setRGB(0, 0, 0);
        oledReady();
      }
    }
  }
  http.end();
}

void checkWebReadRequest() {
  HTTPClient http;
  http.begin(String(CARDREAD_URL) + "?action=status");
  http.setTimeout(800);
  int code = http.GET();
  if (code == 200) {
    String resp = http.getString();
    StaticJsonDocument<64> doc;
    if (!deserializeJson(doc, resp)) {
      bool waiting = doc["waiting"].as<bool>();
      if (waiting && !webReadMode) {
        webReadMode = true;
        setRGB(0, 0, 255);
        oledMsg("[ READ CARD ]", "Tap card to", "view student", "info on website");
      } else if (!waiting && webReadMode) {
        webReadMode = false;
        setRGB(0, 0, 0);
        oledReady();
      }
    }
  }
  http.end();
}

void sendScanUID(String uid) {
  if (WiFi.status() != WL_CONNECTED) return;
  HTTPClient http;
  http.begin(SCAN_URL);
  http.addHeader("Content-Type", "application/json");
  String body = "{\"uid\":\"" + uid + "\"}";
  int code = http.POST(body);
  if (code == 200) {
    beepOK();
    oledMsg("[ WEB SCAN OK ]", "UID sent!", uid, "Fill form on web");
  } else {
    beepFail();
    oledMsg("  Send FAILED", "HTTP: " + String(code), uid, "");
  }
  http.end();
}

void sendReadUID(String uid) {
  HTTPClient http;
  http.begin(CARDREAD_URL);
  http.addHeader("Content-Type", "application/json");
  String body = "{\"uid\":\"" + uid + "\"}";
  int code = http.POST(body);
  if (code == 200) {
    beepOK();
    oledMsg("[ READ OK ]", "Check website", uid, "");
  } else {
    beepFail();
    oledMsg("  Read FAILED", "HTTP: " + String(code), "", "");
  }
  http.end();
}

void sendDetScanUID(String uid) {
  HTTPClient http;
  http.begin(DETSCAN_URL);
  http.addHeader("Content-Type", "application/json");
  String body = "{\"uid\":\"" + uid + "\"}";
  int code = http.POST(body);
  if (code == 200) {
    beepOK();
    oledMsg("[ DET SCAN OK ]", "Check website", uid, "");
  } else {
    beepFail();
    oledMsg("  Send FAILED", "HTTP: " + String(code), "", "");
  }
  http.end();
}

// ─────────────────────────────────────────────────────────────────
// Card Registration & Writing
// ─────────────────────────────────────────────────────────────────
void doWrite(String wID, String wName) {
  Serial.println("Writing card...");
  String uid = getUID();

  byte buf1[16] = {0}, buf2[16] = {0};
  memcpy(buf1, wID.c_str(),   min((int)wID.length(),   15));
  memcpy(buf2, wName.c_str(), min((int)wName.length(), 15));

  MFRC522::StatusCode s = mfrc522.PCD_Authenticate(
      MFRC522::PICC_CMD_MF_AUTH_KEY_A, 1, &mifareKey, &mfrc522.uid);
  if (s != MFRC522::STATUS_OK) { writeFailed(); return; }

  s = mfrc522.MIFARE_Write(1, buf1, 16);
  if (s != MFRC522::STATUS_OK) { mfrc522.PCD_StopCrypto1(); writeFailed(); return; }

  s = mfrc522.MIFARE_Write(2, buf2, 16);
  if (s != MFRC522::STATUS_OK) { mfrc522.PCD_StopCrypto1(); writeFailed(); return; }

  mfrc522.PCD_StopCrypto1();
  saveStudentCache(uid, wID, wName);

  if (WiFi.status() == WL_CONNECTED) {
    oledMsg("[ REGISTERING ]", "Saving to DB...", uid, "");
    registerToDB(uid, wID, wName);
  } else {
    beepOK();
    oledSuccess(wID, wName, uid, "Saved to Local Cache");
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

  String idStr   = buf2str(buf1);
  String nameStr = buf2str(buf2);
  beepOK();
  oledRead(uid, idStr, nameStr);
}

// ─────────────────────────────────────────────────────────────────
// System Diagnostics & Serial Command Handler
// ─────────────────────────────────────────────────────────────────
void handleCommand(String raw) {
  String upper = raw;
  upper.toUpperCase();

  if (upper == "DIAG")       { doDiag(); oledReady(); return; }
  if (upper == "MODE")       { Serial.println("Mode: ATTENDANCE (Active)"); return; }
  if (upper == "CLEAR")      { LittleFS.remove(QUEUE_FILE); Serial.println("Offline queue cleared!"); return; }

  if (upper == "READ") {
    oledMsg("[ READ MODE ]", "Hold card to", "reader...", "");
    if (waitForCard(15000)) doRead();
    else oledMsg("  Timeout", "No card found", "", "");
    mfrc522.PICC_HaltA(); mfrc522.PCD_StopCrypto1();
    delay(1500); oledReady(); return;
  }

  if (upper.startsWith("WRITE,")) {
    String payload = raw.substring(6);
    int c = payload.indexOf(',');
    if (c < 0) { Serial.println("Usage: WRITE,<ID>,<Name>"); return; }
    String wID = payload.substring(0, c); String wName = payload.substring(c + 1);
    wID.trim(); wName.trim();
    oledMsg("[ WRITE MODE ]", "ID: " + wID, "Name: " + wName, "Hold card...");
    if (waitForCard(15000)) doWrite(wID, wName);
    else oledMsg("  Timeout", "No card found", "", "");
    mfrc522.PICC_HaltA(); mfrc522.PCD_StopCrypto1();
    delay(2000); oledReady(); return;
  }

  Serial.println("Unknown Command."); printHelp();
}

void doDiag() {
  Serial.println("=== SYSTEM DIAGNOSTICS ===");
  byte ver = mfrc522.PCD_ReadRegister(MFRC522::VersionReg);
  Serial.printf("RC522 Reg Version: 0x%02X\n", ver);
  Serial.printf("WiFi Status: %s (IP: %s, RSSI: %d dBm)\n",
                WiFi.status() == WL_CONNECTED ? "Connected" : "Offline",
                WiFi.localIP().toString().c_str(), WiFi.RSSI());
  Serial.printf("Offline Queue Count: %d / 350\n", offlineQueueCount());
  Serial.println("==========================");
  oledMsg("  DIAG OK", WiFi.status() == WL_CONNECTED ? WiFi.localIP().toString() : "WiFi Offline",
          "Queue: " + String(offlineQueueCount()), "RC522 OK");
  delay(2500);
}

// ─────────────────────────────────────────────────────────────────
// OLED Screen Display Views
// ─────────────────────────────────────────────────────────────────
void oledReady() {
  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);

  // Status Top Bar
  display.fillRect(0, 0, OLED_W, 14, SSD1306_WHITE);
  display.setTextColor(SSD1306_BLACK);
  display.setTextSize(1);
  display.setCursor(2, 3);
  display.print(getFormattedTime());

  display.setCursor(85, 3);
  if (WiFi.status() == WL_CONNECTED) {
    display.print("WiFi:OK");
  } else {
    display.print("OFFLINE");
  }

  display.setTextColor(SSD1306_WHITE);

  if (WiFi.status() != WL_CONNECTED) {
    int q = offlineQueueCount();
    display.setTextSize(1);
    display.setCursor(10, 20);
    display.print("OFFLINE MODE");
    display.setCursor(10, 34);
    display.print("Queue: " + String(q) + " record(s)");
    display.setCursor(10, 48);
    display.print("Tap card to log");
  } else {
    display.setTextSize(2);
    display.setCursor(35, 24);
    display.print("SCAN");
    display.setCursor(37, 44);
    display.print("CARD");
  }
  display.display();
}

void oledMsg(String l1, String l2, String l3, String l4) {
  display.clearDisplay();
  display.setTextSize(1);
  display.fillRect(0, 0, OLED_W, 14, SSD1306_WHITE);
  display.setTextColor(SSD1306_BLACK);
  display.setCursor(2, 3);
  display.print(l1.substring(0, 21));
  display.setTextColor(SSD1306_WHITE);
  if (l2.length()) { display.setCursor(2, 18); display.print(l2.substring(0, 21)); }
  if (l3.length()) { display.setCursor(2, 34); display.print(l3.substring(0, 21)); }
  if (l4.length()) { display.setCursor(2, 50); display.print(l4.substring(0, 21)); }
  display.display();
}

void oledAttendance(String name, String cardId, String action) {
  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  display.fillRect(0, 0, OLED_W, 14, SSD1306_WHITE);
  display.setTextColor(SSD1306_BLACK);
  display.setTextSize(1);
  display.setCursor(action == "IN" ? 30 : (action == "OUT" ? 28 : 22), 3);
  display.print(action == "IN" ? "CHECKED IN" : (action == "OUT" ? "CHECKED OUT" : "OFFLINE LOG"));

  display.setTextColor(SSD1306_WHITE);
  display.setTextSize(2);
  String n = name.length() > 8 ? name.substring(0, 8) : name;
  int x = (OLED_W - n.length() * 12) / 2;
  display.setCursor(max(0, x), 18);
  display.print(n);

  display.setTextSize(1);
  display.setCursor(28, 44);
  display.print("ID: " + cardId);
  display.drawRect(0, 0, OLED_W, OLED_H, SSD1306_WHITE);
  display.display();
}

void oledSuccess(String id, String name, String uid, String dbStatus) {
  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
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
  display.setTextColor(SSD1306_WHITE);
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
// Utility Helpers
// ─────────────────────────────────────────────────────────────────
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
  return "00:00:00";
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

void writeFailed() {
  setRGB(255, 0, 0);
  beepFail();
  oledMsg("  WRITE FAILED", "See Serial log", "", "");
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
