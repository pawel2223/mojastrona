#include <WiFi.h>
#include <WebServer.h>
#include <Preferences.h>
#include <PubSubClient.h>
#include <WiFiClientSecure.h>

// ---------- Piny UART ----------
#define UART_RX 16
#define UART_TX 17

// ---------- AP domyślne ----------
const char* ap_ssid = "ESP32_RAC_Debugger";
const char* ap_pass = "12345678";

// ---------- Web + MQTT ----------
WebServer server(80);
Preferences preferences;

// ---------- MQTT ----------
WiFiClient espClient;
WiFiClientSecure espClientSecure;
PubSubClient* mqttClient = nullptr;
unsigned long lastMqttReconnectAttempt = 0;
const unsigned long MQTT_RECONNECT_INTERVAL = 5000;
bool mqttWasConnected = false;

// ---------- Bufory / dane ----------
struct UnitData { uint8_t bytes[17]; };
UnitData externalUnit;
UnitData internalUnit;

uint8_t uartBuffer[128];
int uartIndex = 0;

String saved_wifi_ssid = "";
String saved_wifi_pass = "";
String mqtt_server = "";
String mqtt_user = "";
String mqtt_passw = "";
int mqtt_port = 1883;
bool mqtt_use_tls = false;

unsigned long lastMqttPub = 0;
const unsigned long MQTT_PUB_INTERVAL = 2000;

// ---------- Zmienne dla diody ramek ----------
unsigned long lastFrameTime = 0;
bool frameLedState = false;
const unsigned long FRAME_LED_DURATION = 500;
const unsigned long FRAME_TIMEOUT = 3000;

#define LED_PIN 2

// ---------- Hasło do konfiguracji MQTT ----------
const String MQTT_CONFIG_PASSWORD = "gree12345";
bool mqttConfigAuthenticated = false;
unsigned long mqttConfigAuthTime = 0;
const unsigned long MQTT_CONFIG_TIMEOUT = 300000;

// ---------- Funkcje pomocnicze ----------
String modeDescription(uint8_t D2) {
  switch(D2){
    case 0: return "OFF";
    case 1: return "OFF";
    case 2: return "OFF";
    case 3: return "OFF";
    case 4: return "OFF";
    case 17: return "Cooling";
    case 18: return "Dry";
    case 19: return "Fan";
    case 20: return "Heating";
    default: return "Unknown";
  }
}

String fanDescription(uint8_t D3) {
  switch(D3){
    case 0: return "Standby";
    case 1: return "Low";
    case 2: return "Medium";
    case 3: return "High";
    case 4: return "Turbo";
    case 128: return "OFF";
    default: return "Unknown";
  }
}

// ---------- MQTT Callback ----------
void mqttCallback(char* topic, byte* payload, unsigned int length) {
  String message;
  for (unsigned int i = 0; i < length; i++) {
    message += (char)payload[i];
  }
  
  if (String(topic) == "rac/command/reset") {
    if (message == "reset" || message == "1") {
      Serial.println("MQTT Reset command received!");
      if (mqttClient != nullptr && mqttClient->connected()) {
        mqttClient->publish("rac/status/reset", "Restarting...", true);
      }
      delay(500);
      ESP.restart();
    }
  }
}

// ---------- MQTT ----------
void initMQTTClient() {
  if (mqttClient != nullptr) {
    delete mqttClient;
    mqttClient = nullptr;
  }
  
  if (mqtt_server.length() == 0) return;
  
  if (mqtt_port == 8883) {
    mqtt_use_tls = true;
    espClientSecure.setInsecure();
    mqttClient = new PubSubClient(espClientSecure);
  } else {
    mqtt_use_tls = false;
    mqttClient = new PubSubClient(espClient);
  }
  
  mqttClient->setServer(mqtt_server.c_str(), mqtt_port);
  mqttClient->setCallback(mqttCallback);
  mqttClient->setKeepAlive(30);
  mqttClient->setSocketTimeout(10);
}

void mqttReconnect() {
  if (mqtt_server.length() == 0 || mqttClient == nullptr) return;
  if (mqttClient->connected()) return;
  
  unsigned long now = millis();
  if (now - lastMqttReconnectAttempt < MQTT_RECONNECT_INTERVAL) return;
  lastMqttReconnectAttempt = now;
  
  Serial.print("MQTT reconnect...");
  
  String clientId = "ESP32_RAC_" + String(random(0xffff), HEX);
  bool connected = false;
  
  if (mqtt_user.length() > 0 && mqtt_passw.length() > 0) {
    connected = mqttClient->connect(clientId.c_str(), 
                                   mqtt_user.c_str(), 
                                   mqtt_passw.c_str());
  } else {
    connected = mqttClient->connect(clientId.c_str());
  }
  
  if (connected) {
    Serial.println("OK");
    mqttClient->subscribe("rac/command/#");
    mqttClient->publish("rac/status/online", "1", true);
    mqttWasConnected = true;
  } else {
    Serial.print("FAIL, rc=");
    Serial.println(mqttClient->state());
  }
}

void mqttPublishAll() {
  if (mqtt_server.length() == 0 || mqttClient == nullptr || !mqttClient->connected()) return;
  
  static unsigned long lastSuccessPub = 0;
  unsigned long now = millis();
  
  if (now - lastSuccessPub < MQTT_PUB_INTERVAL) return;
  
  bool publishSuccess = true;
  
  publishSuccess &= mqttClient->publish("rac/external/compressor", String(externalUnit.bytes[2]).c_str(), true);
  publishSuccess &= mqttClient->publish("rac/external/fan_rpm", String(externalUnit.bytes[3] * 10).c_str(), true);
  publishSuccess &= mqttClient->publish("rac/external/current", String(externalUnit.bytes[5] / 10.0, 1).c_str(), true);
  publishSuccess &= mqttClient->publish("rac/external/temp_module", String((int)externalUnit.bytes[8] - 20).c_str(), true);
  publishSuccess &= mqttClient->publish("rac/external/temp_outside", String((int)externalUnit.bytes[10] - 40).c_str(), true);
  publishSuccess &= mqttClient->publish("rac/external/temp_exchanger", String((int)externalUnit.bytes[11] - 40).c_str(), true);
  publishSuccess &= mqttClient->publish("rac/external/temp_discharge", String((int)externalUnit.bytes[12] - 40).c_str(), true);
  publishSuccess &= mqttClient->publish("rac/internal/mode", modeDescription(internalUnit.bytes[1]).c_str(), true);
  publishSuccess &= mqttClient->publish("rac/internal/fan_speed", fanDescription(internalUnit.bytes[2]).c_str(), true);
  publishSuccess &= mqttClient->publish("rac/internal/temp_set", String((int)internalUnit.bytes[4] - 40).c_str(), true);
  publishSuccess &= mqttClient->publish("rac/internal/temp_room", String((int)internalUnit.bytes[5] - 40).c_str(), true);
  publishSuccess &= mqttClient->publish("rac/internal/temp_pipe", String((int)internalUnit.bytes[7] - 40).c_str(), true);
  
  if (publishSuccess) {
    lastSuccessPub = now;
  }
}

// ---------- Reset przez HTTP ----------
void handleReset() {
  String html = "<!DOCTYPE html><html><head><meta charset='utf-8'><meta http-equiv='refresh' content='10;url=/'><style>";
  html += "body{font-family:'Segoe UI',Arial,sans-serif;background:#121212;color:#e0e0e0;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0}";
  html += ".reset-card{background:#1e1e1e;border-left:4px solid #f44336;padding:30px;border-radius:8px;text-align:center;max-width:400px}";
  html += "h2{color:#f44336}.spinner{width:40px;height:40px;border:4px solid #333;border-top-color:#f44336;border-radius:50%;animation:spin 1s linear infinite;margin:20px auto}";
  html += "@keyframes spin{to{transform:rotate(360deg)}}</style></head><body>";
  html += "<div class='reset-card'><h2>🔄 Resetowanie ESP32</h2><div class='spinner'></div><p>Urządzenie zostanie zrestartowane...</p></div></body></html>";
  server.send(200, "text/html", html);
  delay(500);
  ESP.restart();
}

// ---------- Web UI ----------
String htmlHeader(const char* title) {
  String s = "<!doctype html><html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>";
  s += "<title>"; s += title; s += "</title><style>";
  s += "*{margin:0;padding:0;box-sizing:border-box}";
  s += "body{font-family:'Segoe UI',Arial,sans-serif;background:#121212;color:#e0e0e0}";
  s += "header{background:#1a1a1a;padding:15px;text-align:center;border-bottom:2px solid #00bcd4}";
  s += "nav{display:flex;flex-wrap:wrap;justify-content:center;gap:8px;padding:10px;background:#1f1f1f}";
  s += "nav a{color:#00bcd4;text-decoration:none;padding:8px 15px;border-radius:4px;background:#2a2a2a;transition:all 0.3s}";
  s += "nav a:hover{background:#00bcd4;color:#000}";
  s += "nav a.reset-btn{background:#f44336;color:white}";
  s += "nav a.reset-btn:hover{background:#d32f2f}";
  s += "section{padding:15px;max-width:1200px;margin:0 auto}";
  s += ".card{background:#1e1e1e;border-left:4px solid #00bcd4;padding:15px;margin:15px 0;border-radius:0 8px 8px 0;box-shadow:0 2px 5px rgba(0,0,0,0.3)}";
  s += "h2{color:#00bcd4}h3{color:#4caf50;border-bottom:1px solid #333;padding-bottom:5px}";
  s += ".data-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px;margin:10px 0}";
  s += ".data-item{background:#252525;padding:8px;border-radius:4px}";
  s += ".label{color:#aaa}.value{color:#fff;font-weight:bold;font-size:1.1em}.unit{color:#00bcd4}";
  s += ".status-online{color:#4caf50}.status-offline{color:#f44336}.status-standby{color:#ff9800}";
  s += "form label{display:block;margin:10px 0}form input,form select{width:100%;padding:8px;margin-top:5px;background:#333;border:1px solid #444;color:#fff;border-radius:4px}";
  s += "form input[type='submit']{background:#00bcd4;color:#000;border:none;padding:10px;font-weight:bold;cursor:pointer;margin-top:15px}";
  s += ".info-box{background:#1a237e;padding:10px;border-radius:6px;margin:10px 0}";
  s += ".led{display:inline-block;width:12px;height:12px;border-radius:50%;margin-right:5px}";
  s += ".led-green{background:#4caf50}.led-red{background:#f44336}.led-yellow{background:#ff9800}.led-grey{background:#757575}";
  s += ".password-form{max-width:400px;margin:50px auto;text-align:center}";
  s += "</style></head><body>";
  s += "<header><h1>GREE RAC DEBUGGER (ESP32)</h1></header>";
  s += "<nav>";
  s += "<a href='/'>Status</a>";
  s += "<a href='/net'>Konfiguracja WiFi</a>";
  s += "<a href='/mqtt'>Konfiguracja MQTT</a>";
  s += "<a href='/reset' class='reset-btn'>🔴 Reset ESP32</a>";
  s += "</nav><section>";
  return s;
}

String formatValueWithUnit(String label, String value, String unit) {
  return "<div class='data-item'><span class='label'>" + label + "</span><br><span class='value'>" + value + "</span> <span class='unit'>" + unit + "</span></div>";
}

void handleRoot() {
  String html = htmlHeader("Status");
  html += "<meta http-equiv='refresh' content='2'>";
  
  html += "<div class='info-box'>";
  html += "<strong>AP IP:</strong> " + WiFi.softAPIP().toString() + " | ";
  html += "<strong>SSID:</strong> " + String(ap_ssid);
  if (WiFi.status() == WL_CONNECTED) {
    html += " | <strong>STA IP:</strong> " + WiFi.localIP().toString();
    html += " | <strong>WiFi:</strong> <span class='status-online'>Połączono</span>";
  } else {
    html += " | <strong>WiFi:</strong> <span class='status-standby'>Tryb AP</span>";
  }
  if (mqtt_server.length() > 0) {
    html += " | <strong>MQTT:</strong> ";
    html += (mqttClient != nullptr && mqttClient->connected()) ? 
           "<span class='status-online'>Połączono</span>" : 
           "<span class='status-offline'>Brak połączenia</span>";
  }
  html += "</div>";
  
  html += "<div class='card'><h3>Status systemu</h3>";
  html += "<p><span class='led " + String(WiFi.status() == WL_CONNECTED ? "led-green" : "led-yellow") + "'></span> WiFi: ";
  html += (WiFi.status() == WL_CONNECTED ? "Połączono z siecią" : "Tryb Access Point");
  html += "</p>";
  
  if (mqtt_server.length() > 0) {
    html += "<p><span class='led " + String((mqttClient != nullptr && mqttClient->connected()) ? "led-green" : "led-red") + "'></span> MQTT: ";
    html += (mqttClient != nullptr && mqttClient->connected()) ? "Połączono" : "Brak połączenia";
    html += "</p>";
  }
  
  html += "<p>";
  unsigned long timeSinceLastFrame = lastFrameTime > 0 ? millis() - lastFrameTime : 0;
  if (lastFrameTime == 0) html += "<span class='led led-grey'></span> Ramki UART: Brak od startu";
  else if (timeSinceLastFrame < FRAME_TIMEOUT) html += "<span class='led led-green'></span> Ramki UART: Aktywne";
  else html += "<span class='led led-red'></span> Ramki UART: Brak";
  html += "</p></div>";
  
  html += "<div class='card'><h2>Jednostka zewnętrzna (ODU)</h2><div class='data-grid'>";
  html += formatValueWithUnit("Kompresor", String(externalUnit.bytes[2]), "Hz");
  html += formatValueWithUnit("Wentylator", String(externalUnit.bytes[3] * 10), "rpm");
  html += formatValueWithUnit("Prąd", String(externalUnit.bytes[5] / 10.0, 1), "A");
  html += formatValueWithUnit("Temp. modułu", String((int)externalUnit.bytes[8] - 20), "°C");
  html += formatValueWithUnit("Temp. zewnętrzna", String((int)externalUnit.bytes[10] - 40), "°C");
  html += formatValueWithUnit("Temp. wymiennika", String((int)externalUnit.bytes[11] - 40), "°C");
  html += formatValueWithUnit("Temp. tłoczenia", String((int)externalUnit.bytes[12] - 40), "°C");
  html += "</div></div>";
  
  html += "<div class='card'><h2>Jednostka wewnętrzna (IDU)</h2><div class='data-grid'>";
  html += formatValueWithUnit("Tryb pracy", modeDescription(internalUnit.bytes[1]), "");
  html += formatValueWithUnit("Wentylator", fanDescription(internalUnit.bytes[2]), "");
  html += formatValueWithUnit("Temp. zadana", String((int)internalUnit.bytes[4] - 40), "°C");
  html += formatValueWithUnit("Temp. pomieszczenia", String((int)internalUnit.bytes[5] - 40), "°C");
  html += formatValueWithUnit("Temp. rury", String((int)internalUnit.bytes[7] - 40), "°C");
  html += "</div></div></section></body></html>";
  server.send(200, "text/html", html);
}

void handleNetworkConfig() {
  int n = WiFi.scanNetworks(false, true);
  String html = htmlHeader("Konfiguracja WiFi");
  html += "<div class='card'><h2>Konfiguracja sieci WiFi</h2><form action='/saveNet' method='POST'>";
  
  if (n > 0) {
    html += "<label>Wybierz sieć SSID:<select name='ssid'><option value=''>-- Wybierz sieć --</option>";
    for (int i = 0; i < n; i++) {
      String ssid = WiFi.SSID(i);
      bool isCurrent = (ssid == saved_wifi_ssid);
      html += "<option value='" + ssid + "'" + (isCurrent ? " selected" : "") + ">" + ssid + " (" + String(WiFi.RSSI(i)) + " dBm)</option>";
    }
    html += "</select></label>";
  } else {
    html += "<p>Nie znaleziono sieci WiFi w zasięgu</p>";
    html += "<label>Wprowadź SSID ręcznie:<input type='text' name='ssid' value='" + saved_wifi_ssid + "'></label>";
  }
  
  html += "<label>Hasło WiFi:<input type='password' name='pass' value='" + saved_wifi_pass + "'></label>";
  html += "<input type='submit' value='Zapisz i uruchom ponownie'>";
  html += "</form></div></section></body></html>";
  server.send(200, "text/html", html);
  WiFi.scanDelete();
}

void handleSaveNet() {
  String ssid = server.arg("ssid");
  String pass = server.arg("pass");
  preferences.putString("wifi_ssid", ssid);
  preferences.putString("wifi_pass", pass);
  
  String html = "<html><head><meta charset='utf-8'><meta http-equiv='refresh' content='5;url=/'></head><body>";
  html += "<h2>Ustawienia zapisane</h2><p>Restartowanie...</p></body></html>";
  server.send(200, "text/html", html);
  delay(1000);
  ESP.restart();
}

void handleMqttLogin() {
  String html = htmlHeader("Logowanie do konfiguracji MQTT");
  html += "<div class='card password-form'><h2>Wprowadź hasło</h2>";
  html += "<form action='/mqtt/auth' method='POST'>";
  html += "<input type='password' name='password' placeholder='Hasło dostępu'>";
  html += "<input type='submit' value='Zaloguj'>";
  html += "</form>";
  if (server.hasArg("error")) html += "<p style='color:#f44336;'>❌ Nieprawidłowe hasło!</p>";
  html += "</div></section></body></html>";
  server.send(200, "text/html", html);
}

void handleMqttAuth() {
  if (server.arg("password") == MQTT_CONFIG_PASSWORD) {
    mqttConfigAuthenticated = true;
    mqttConfigAuthTime = millis();
    server.sendHeader("Location", "/mqtt/config", true);
    server.send(302, "text/plain", "");
  } else {
    server.sendHeader("Location", "/mqtt/login?error=1", true);
    server.send(302, "text/plain", "");
  }
}

void handleMqttConfig() {
  if (!mqttConfigAuthenticated || (millis() - mqttConfigAuthTime > MQTT_CONFIG_TIMEOUT)) {
    mqttConfigAuthenticated = false;
    server.sendHeader("Location", "/mqtt/login", true);
    server.send(302, "text/plain", "");
    return;
  }
  
  String html = htmlHeader("Konfiguracja MQTT");
  html += "<div class='card'><h2>Konfiguracja brokera MQTT</h2>";
  html += "<div style='background:#00bcd4; color:#000; padding:8px; border-radius:4px; margin-bottom:15px; text-align:center;'>✅ Zalogowano pomyślnie</div>";
  html += "<form action='/saveMQTT' method='POST'>";
  html += "<label>Adres brokera:<input type='text' name='server' value='" + mqtt_server + "'></label>";
  html += "<label>Port:<select name='port'><option value='1883'" + String(mqtt_port == 1883 ? " selected" : "") + ">1883</option><option value='8883'" + String(mqtt_port == 8883 ? " selected" : "") + ">8883 (SSL)</option></select></label>";
  html += "<label>Użytkownik:<input type='text' name='user' value='" + mqtt_user + "'></label>";
  html += "<label>Hasło:<input type='password' name='pass' value='" + mqtt_passw + "'></label>";
  html += "<input type='submit' value='Zapisz ustawienia'>";
  html += "</form><p><a href='/mqtt/logout' style='color:#f44336;'>🚪 Wyloguj</a></p></div></section></body></html>";
  server.send(200, "text/html", html);
}

void handleMqttLogout() {
  mqttConfigAuthenticated = false;
  server.sendHeader("Location", "/mqtt/login", true);
  server.send(302, "text/plain", "");
}

void handleSaveMQTT() {
  if (!mqttConfigAuthenticated || (millis() - mqttConfigAuthTime > MQTT_CONFIG_TIMEOUT)) {
    server.sendHeader("Location", "/mqtt/login", true);
    server.send(302, "text/plain", "");
    return;
  }
  
  mqtt_server = server.arg("server");
  mqtt_port = server.arg("port").toInt();
  mqtt_user = server.arg("user");
  mqtt_passw = server.arg("pass");
  
  preferences.putString("mqtt_server", mqtt_server);
  preferences.putInt("mqtt_port", mqtt_port);
  preferences.putString("mqtt_user", mqtt_user);
  preferences.putString("mqtt_pass", mqtt_passw);
  
  String html = "<html><head><meta charset='utf-8'><meta http-equiv='refresh' content='5;url=/'></head><body>";
  html += "<h2>Ustawienia MQTT zapisane</h2><p>Restartowanie...</p></body></html>";
  server.send(200, "text/html", html);
  delay(1000);
  ESP.restart();
}

// ---------- Parsowanie UART ----------
void parseUARTStream() {
  for(int i=0;i<=uartIndex-20;i++){
    if((uartBuffer[i]==0x31&&(uartBuffer[i+1]==0x10||uartBuffer[i+1]==0x20))){
      uint8_t sum=0;
      for(int j=0;j<19;j++) sum+=uartBuffer[i+j];
      if(sum!=uartBuffer[i+19]) continue;

      if(uartBuffer[i+1]==0x10) {
        for(int k=0;k<17;k++) externalUnit.bytes[k]=uartBuffer[i+2+k];
        lastFrameTime = millis();
        frameLedState = true;
      } else {
        for(int k=0;k<17;k++) internalUnit.bytes[k]=uartBuffer[i+2+k];
        lastFrameTime = millis();
        frameLedState = true;
      }

      int remaining = uartIndex-(i+20);
      if(remaining>0) memmove(uartBuffer,uartBuffer+i+20,remaining);
      uartIndex=remaining;
      i=-1;
    }
  }
  if (frameLedState && (millis() - lastFrameTime > FRAME_LED_DURATION)) frameLedState = false;
}

void updateStatusLED() {
  unsigned long currentTime = millis();
  unsigned long timeSinceLastFrame = currentTime - lastFrameTime;
  
  if (lastFrameTime == 0) digitalWrite(LED_PIN, (currentTime / 2000) % 2);
  else if (timeSinceLastFrame < FRAME_LED_DURATION) digitalWrite(LED_PIN, frameLedState);
  else if (timeSinceLastFrame < FRAME_TIMEOUT) digitalWrite(LED_PIN, (currentTime / 500) % 2);
  else digitalWrite(LED_PIN, (currentTime / 250) % 2);
}

// ---------- Setup ----------
void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);

  preferences.begin("config",false);
  saved_wifi_ssid = preferences.getString("wifi_ssid","");
  saved_wifi_pass = preferences.getString("wifi_pass","");
  mqtt_server = preferences.getString("mqtt_server","");
  mqtt_port = preferences.getInt("mqtt_port",1883);
  mqtt_user = preferences.getString("mqtt_user","");
  mqtt_passw = preferences.getString("mqtt_pass","");

  initMQTTClient();
  Serial2.begin(1200, SERIAL_8N1, UART_RX, UART_TX);

  WiFi.mode(WIFI_AP_STA);
  WiFi.softAP(ap_ssid, ap_pass);
  
  if(saved_wifi_ssid.length() > 0) {
    WiFi.begin(saved_wifi_ssid.c_str(), saved_wifi_pass.c_str());
    Serial.print("Łączenie z WiFi");
    int attempts = 0;
    while (WiFi.status() != WL_CONNECTED && attempts < 20) {
      delay(500);
      Serial.print(".");
      attempts++;
    }
    if (WiFi.status() == WL_CONNECTED) {
      Serial.println("\nWiFi OK");
      Serial.print("IP: ");
      Serial.println(WiFi.localIP());
    } else {
      Serial.println("\nWiFi FAIL - tryb AP");
    }
  }

  server.on("/", handleRoot);
  server.on("/net", handleNetworkConfig);
  server.on("/saveNet", HTTP_POST, handleSaveNet);
  server.on("/reset", handleReset);
  server.on("/mqtt", handleMqttLogin);
  server.on("/mqtt/login", handleMqttLogin);
  server.on("/mqtt/auth", HTTP_POST, handleMqttAuth);
  server.on("/mqtt/config", handleMqttConfig);
  server.on("/mqtt/logout", handleMqttLogout);
  server.on("/saveMQTT", HTTP_POST, handleSaveMQTT);
  
  server.begin();
  
  Serial.println("ESP32 RAC Debugger uruchomiony");
  Serial.print("AP IP: "); Serial.println(WiFi.softAPIP());
}

// ---------- Loop ----------
void loop() {
  server.handleClient();
  
  if(mqtt_server.length()>0 && mqttClient != nullptr){
    mqttReconnect();
    mqttClient->loop();
  }

  while(Serial2.available()){
    uint8_t b = Serial2.read();
    if(uartIndex<sizeof(uartBuffer)) uartBuffer[uartIndex++]=b;
  }

  parseUARTStream();
  updateStatusLED();

  if(millis()-lastMqttPub>MQTT_PUB_INTERVAL){
    mqttPublishAll();
    lastMqttPub = millis();
  }
}
