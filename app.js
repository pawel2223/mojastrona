// app.js - Dashboard M5StickC z MQTT i wykresami

// Tematy MQTT
const topics = {
    compressor: "m5stick/external/compressor",
    fan_rpm: "m5stick/external/fan",
    current_a: "m5stick/external/current",
    temp_module: "m5stick/external/temp_module",
    temp_outside: "m5stick/external/temp_outside",
    temp_exchanger: "m5stick/external/temp_exchanger",
    temp_discharge: "m5stick/external/temp_discharge",
    mode: "m5stick/internal/mode",
    fan_text: "m5stick/internal/fan",
    temp_set: "m5stick/internal/temp_set",
    temp_room: "m5stick/internal/temp_room",
    temp_pipe: "m5stick/internal/temp_pipe"
};

// Konfiguracja kafli z domyślnymi wartościami
const tilesConfig = {
    odu: [
        {id: 'compressor', label: 'Kompresor', unit: 'Hz', icon: 'fa-tachometer-alt', color: '#3b82f6', defaultValue: '45'},
        {id: 'fan_rpm', label: 'Wentylator ODU', unit: 'rpm', icon: 'fa-fan', color: '#10b981', defaultValue: '1200'},
        {id: 'current', label: 'Prąd', unit: 'A', icon: 'fa-bolt', color: '#f59e0b', defaultValue: '3.2'},
        {id: 'temp_module', label: 'Temp. modułu', unit: '°C', icon: 'fa-microchip', color: '#8b5cf6', defaultValue: '35.5'},
        {id: 'temp_outside', label: 'Temp. zewnętrzna', unit: '°C', icon: 'fa-sun', color: '#f97316', defaultValue: '22.0'},
        {id: 'temp_exchanger', label: 'Temp. wymiennika', unit: '°C', icon: 'fa-exchange-alt', color: '#06b6d4', defaultValue: '40.5'},
        {id: 'temp_discharge', label: 'Temp. tłoczenia', unit: '°C', icon: 'fa-fire', color: '#ef4444', defaultValue: '55.0'}
    ],
    idu: [
        {id: 'mode', label: 'Tryb pracy', unit: '', icon: 'fa-cogs', color: '#3b82f6', defaultValue: 'Auto'},
        {id: 'fan_text', label: 'Wentylator IDU', unit: '', icon: 'fa-wind', color: '#10b981', defaultValue: 'Średni'},
        {id: 'temp_set', label: 'Temp. zadana', unit: '°C', icon: 'fa-bullseye', color: '#8b5cf6', defaultValue: '22.0'},
        {id: 'temp_room', label: 'Temp. pokojowa', unit: '°C', icon: 'fa-home', color: '#f59e0b', defaultValue: '21.5'},
        {id: 'temp_pipe', label: 'Temp. rury', unit: '°C', icon: 'fa-water', color: '#06b6d4', defaultValue: '18.5'}
    ]
};

// Zmienne globalne
let mqttClient = null;
let charts = {};
let messageCount = 0;
let topicSet = new Set();
let isPaused = false;
let lastValues = {};
const maxChartPoints = 100;
const maxMessages = 50;
let autoRefreshInterval = null;
let testDataInterval = null;
let settingsChanged = false;
let connectionDiagnostics = [];
const maxDiagnostics = 50;

// Inicjalizacja aplikacji
document.addEventListener('DOMContentLoaded', function() {
    console.log('Dashboard M5StickC - inicjalizacja...');
    
    // Inicjalizacja komponentów
    initLogin();
    initClock();
    initEventListeners();
    initAppearanceSettings();
});

// Inicjalizacja logowania
function initLogin() {
    const btnLogin = document.getElementById('btnLogin');
    const loginToggle = document.getElementById('loginTogglePw');
    
    if (!btnLogin) {
        console.error('Nie znaleziono przycisku logowania!');
        return;
    }
    
    btnLogin.addEventListener('click', handleLogin);
    
    if (loginToggle) {
        loginToggle.addEventListener('click', function() {
            const passwordInput = document.getElementById('password');
            if (!passwordInput) return;
            
            const icon = loginToggle.querySelector('i');
            if (passwordInput.type === 'password') {
                passwordInput.type = 'text';
                icon.className = 'fas fa-eye-slash';
            } else {
                passwordInput.type = 'password';
                icon.className = 'fas fa-eye';
            }
        });
    }
    
    // Pozwól na logowanie za pomocą Enter
    const passwordInput = document.getElementById('password');
    if (passwordInput) {
        passwordInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                handleLogin();
            }
        });
    }
}

// Obsługa logowania
function handleLogin() {
    const username = document.getElementById('login')?.value.trim() || '';
    const password = document.getElementById('password')?.value.trim() || '';
    const errorMsg = document.getElementById('login-msg');
    
    // Prosta walidacja
    if (username === 'admin' && password === 'admin') {
        if (errorMsg) errorMsg.textContent = '';
        showApp();
        loadSavedSettings();
    } else {
        if (errorMsg) {
            errorMsg.textContent = 'Nieprawidłowy login lub hasło!';
            errorMsg.classList.remove('shake');
            void errorMsg.offsetWidth;
            errorMsg.classList.add('shake');
        }
    }
}

// Pokazanie głównej aplikacji
function showApp() {
    const loginScreen = document.getElementById('login-screen');
    const appScreen = document.getElementById('app');
    
    if (loginScreen) loginScreen.style.display = 'none';
    if (appScreen) appScreen.style.display = 'flex';
    
    updateGlobalStatus('Rozłączony', 'disconnected');
    
    // Inicjalizuj komponenty po załadowaniu aplikacji
    setTimeout(() => {
        buildTiles();
        initCharts();
        showTab('home');
        initializeTileValues();
        createDiagnosticsSection();
        addQuickConfigButtons();
    }, 100);
}

// Tworzenie sekcji diagnostycznej
function createDiagnosticsSection() {
    const mqttConfigCard = document.querySelector('.mqtt-config-card');
    if (!mqttConfigCard) return;
    
    // Dodaj przyciski testowe
    const configActions = document.querySelector('.config-actions');
    if (configActions) {
        const testButtons = document.createElement('div');
        testButtons.className = 'config-test-buttons';
        testButtons.innerHTML = `
            <button class="btn-test-connection" id="testConnection">
                <i class="fas fa-vial"></i> Testuj konfigurację
            </button>
            <button class="btn-test-connection" id="showDiagnostics">
                <i class="fas fa-eye"></i> Pokaż diagnostykę
            </button>
        `;
        configActions.appendChild(testButtons);
    }
    
    // Dodaj sekcję diagnostyczną
    const diagnosticsSection = document.createElement('div');
    diagnosticsSection.className = 'connection-diagnostics';
    diagnosticsSection.id = 'connectionDiagnostics';
    diagnosticsSection.style.display = 'none';
    diagnosticsSection.innerHTML = `
        <div class="diagnostics-header">
            <span class="diagnostics-title">Diagnostyka połączenia</span>
            <button class="btn-test-connection" id="clearDiagnostics">
                <i class="fas fa-trash-alt"></i> Wyczyść
            </button>
        </div>
        <div class="diagnostics-content">
            Rozpoczęcie diagnostyki...
        </div>
    `;
    
    mqttConfigCard.appendChild(diagnosticsSection);
    
    // Dodaj obsługę czyszczenia diagnostyki
    setTimeout(() => {
        const clearDiagnosticsBtn = document.getElementById('clearDiagnostics');
        if (clearDiagnosticsBtn) {
            clearDiagnosticsBtn.addEventListener('click', () => {
                connectionDiagnostics = ['Diagnostyka wyczyszczona'];
                updateDiagnosticsDisplay();
            });
        }
    }, 100);
}

// Dodaj przyciski szybkiej konfiguracji
function addQuickConfigButtons() {
    const mqttConfigCard = document.querySelector('.mqtt-config-card .config-section:first-child');
    if (!mqttConfigCard) return;
    
    const quickConfigDiv = document.createElement('div');
    quickConfigDiv.className = 'quick-config';
    quickConfigDiv.innerHTML = `
        <div style="margin-top: var(--spacing-md);">
            <label style="font-size: 0.875rem; color: var(--text-muted); margin-bottom: var(--spacing-xs); display: block;">
                <i class="fas fa-bolt"></i> Szybka konfiguracja:
            </label>
            <div style="display: flex; gap: var(--spacing-sm); flex-wrap: wrap;">
                <button class="btn-quick-config" data-type="hivemq">HiveMQ WSS</button>
                <button class="btn-quick-config" data-type="hivemq_tls">HiveMQ TLS</button>
                <button class="btn-quick-config" data-type="mosquitto">Mosquitto</button>
                <button class="btn-quick-config" data-type="localhost">Localhost</button>
            </div>
        </div>
    `;
    
    mqttConfigCard.appendChild(quickConfigDiv);
    
    // Dodaj obsługę przycisków
    setTimeout(() => {
        document.querySelectorAll('.btn-quick-config').forEach(btn => {
            btn.addEventListener('click', function() {
                const type = this.getAttribute('data-type');
                autoConfigureMQTT(type);
            });
        });
    }, 100);
}

// Automatyczna konfiguracja MQTT
function autoConfigureMQTT(brokerType) {
    const brokerInput = document.getElementById('broker');
    const portSelect = document.getElementById('port');
    const protocolSelect = document.getElementById('protocol');
    const useTLSCheckbox = document.getElementById('useTLS');
    
    if (!brokerInput || !portSelect || !protocolSelect) return;
    
    switch(brokerType) {
        case 'hivemq':
            brokerInput.value = 'wss://772ebcf7129c4692affb3fc74ac5737f.s1.eu.hivemq.cloud:8884/mqtt';
            portSelect.value = '8884';
            protocolSelect.value = 'wss';
            if (useTLSCheckbox) useTLSCheckbox.checked = true;
            addDiagnostic('Skonfigurowano dla HiveMQ Cloud (WSS)');
            break;
            
        case 'hivemq_tls':
            brokerInput.value = 'mqtts://772ebcf7129c4692affb3fc74ac5737f.s1.eu.hivemq.cloud:8883';
            portSelect.value = '8883';
            protocolSelect.value = 'mqtts';
            if (useTLSCheckbox) useTLSCheckbox.checked = true;
            addDiagnostic('Skonfigurowano dla HiveMQ Cloud (MQTTS)');
            break;
            
        case 'mosquitto':
            brokerInput.value = 'ws://test.mosquitto.org:8080';
            portSelect.value = '8080';
            protocolSelect.value = 'ws';
            if (useTLSCheckbox) useTLSCheckbox.checked = false;
            addDiagnostic('Skonfigurowano dla Mosquitto test server');
            break;
            
        case 'mosquitto_tls':
            brokerInput.value = 'wss://test.mosquitto.org:8081';
            portSelect.value = '8081';
            protocolSelect.value = 'wss';
            if (useTLSCheckbox) useTLSCheckbox.checked = true;
            addDiagnostic('Skonfigurowano dla Mosquitto test server (WSS)');
            break;
            
        case 'localhost':
            brokerInput.value = 'ws://localhost:9001';
            portSelect.value = '9001';
            protocolSelect.value = 'ws';
            if (useTLSCheckbox) useTLSCheckbox.checked = false;
            addDiagnostic('Skonfigurowano dla localhost (WebSocket)');
            break;
            
        case 'localhost_tls':
            brokerInput.value = 'wss://localhost:9443';
            portSelect.value = '9443';
            protocolSelect.value = 'wss';
            if (useTLSCheckbox) useTLSCheckbox.checked = true;
            addDiagnostic('Skonfigurowano dla localhost (WSS)');
            break;
    }
}

// Dodaj wpis diagnostyczny
function addDiagnostic(message) {
    const timestamp = new Date().toLocaleTimeString('pl-PL', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
    
    connectionDiagnostics.push(`[${timestamp}] ${message}`);
    
    // Ogranicz liczbę wpisów
    if (connectionDiagnostics.length > maxDiagnostics) {
        connectionDiagnostics.shift();
    }
    
    // Aktualizuj UI jeśli jest dostępne
    updateDiagnosticsDisplay();
}

// Aktualizuj wyświetlanie diagnostyki
function updateDiagnosticsDisplay() {
    const diagnosticsEl = document.getElementById('connectionDiagnostics');
    if (diagnosticsEl) {
        const contentEl = diagnosticsEl.querySelector('.diagnostics-content');
        if (contentEl) {
            contentEl.textContent = connectionDiagnostics.join('\n');
            diagnosticsEl.scrollTop = diagnosticsEl.scrollHeight;
        }
    }
}

// Inicjalizuj wartości w kafelkach z domyślnymi danymi
function initializeTileValues() {
    [...tilesConfig.odu, ...tilesConfig.idu].forEach(tile => {
        updateTile(tile.id, tile.defaultValue);
    });
}

// Wylogowanie
function logout() {
    // Zatrzymaj interwały
    if (autoRefreshInterval) clearInterval(autoRefreshInterval);
    if (testDataInterval) clearInterval(testDataInterval);
    
    // Rozłącz MQTT
    if (mqttClient && mqttClient.connected) {
        try {
            mqttClient.end();
        } catch (e) {
            console.error('Błąd podczas rozłączania MQTT:', e);
        }
    }
    
    // Resetuj aplikację
    resetApp();
    
    // Przełącz ekrany
    const loginScreen = document.getElementById('login-screen');
    const appScreen = document.getElementById('app');
    
    if (appScreen) appScreen.style.display = 'none';
    if (loginScreen) loginScreen.style.display = 'flex';
    
    // Wyczyść formularz logowania
    const passwordInput = document.getElementById('password');
    if (passwordInput) passwordInput.value = 'admin';
}

// Reset aplikacji
function resetApp() {
    messageCount = 0;
    topicSet.clear();
    lastValues = {};
    updateMessageCount();
    updateTopicCount();
    
    // Zresetuj wykresy
    Object.values(charts).forEach(chart => {
        if (chart) {
            chart.data.labels = [];
            chart.data.datasets.forEach(dataset => dataset.data = []);
            chart.update();
        }
    });
    
    // Zresetuj kafelki
    [...tilesConfig.odu, ...tilesConfig.idu].forEach(tile => {
        const valueEl = document.getElementById(`${tile.id}-value`);
        const updatedEl = document.getElementById(`${tile.id}-updated`);
        if (valueEl) valueEl.textContent = '--';
        if (updatedEl) updatedEl.textContent = 'ostatnia: -';
    });
}

// Inicjalizacja zegara
function initClock() {
    function updateClock() {
        const now = new Date();
        const timeString = now.toLocaleTimeString('pl-PL', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
        const clockElement = document.getElementById('clock');
        if (clockElement) {
            clockElement.textContent = timeString;
        }
    }
    
    updateClock();
    setInterval(updateClock, 1000);
}

// Budowanie kafli
function buildTiles() {
    console.log('Budowanie kafelków...');
    
    // Kafelki ODU
    const oduContainer = document.getElementById('odu-tiles');
    if (oduContainer) {
        oduContainer.innerHTML = '';
        tilesConfig.odu.forEach(tile => {
            oduContainer.appendChild(createTileElement(tile));
        });
    }
    
    // Kafelki IDU
    const iduContainer = document.getElementById('idu-tiles');
    if (iduContainer) {
        iduContainer.innerHTML = '';
        tilesConfig.idu.forEach(tile => {
            iduContainer.appendChild(createTileElement(tile));
        });
    }
    
    console.log('Kafelki zbudowane pomyślnie');
}

// Tworzenie elementu kafelka
function createTileElement(tile) {
    const tileEl = document.createElement('div');
    tileEl.className = 'tile';
    tileEl.id = `tile-${tile.id}`;
    tileEl.innerHTML = `
        <div class="tile-header">
            <div class="tile-label">
                <i class="fas ${tile.icon}" style="color: ${tile.color}"></i>
                ${tile.label}
            </div>
            <div class="tile-trend"></div>
        </div>
        <div class="tile-value" id="${tile.id}-value">${tile.defaultValue}</div>
        <div class="tile-unit">${tile.unit}</div>
        <div class="tile-footer">
            <div class="tile-updated" id="${tile.id}-updated">ostatnia: -</div>
        </div>
    `;
    return tileEl;
}

// Aktualizacja kafelka
function updateTile(id, value) {
    const valueEl = document.getElementById(`${id}-value`);
    const updatedEl = document.getElementById(`${id}-updated`);
    const trendEl = document.querySelector(`#tile-${id} .tile-trend`);
    const tileEl = document.getElementById(`tile-${id}`);
    
    if (!valueEl || !updatedEl || !tileEl) {
        console.warn(`Nie znaleziono elementów dla kafelka ${id}`);
        return;
    }
    
    const previousValue = parseFloat(valueEl.textContent);
    const currentValue = parseFloat(value);
    
    // Aktualizacja wartości
    valueEl.textContent = value;
    
    // Aktualizacja czasu
    const now = new Date();
    updatedEl.textContent = `aktualne: ${now.toLocaleTimeString('pl-PL', {hour: '2-digit', minute:'2-digit'})}`;
    
    // Aktualizacja trendu
    if (trendEl) {
        if (!isNaN(currentValue) && !isNaN(previousValue) && valueEl.textContent !== '--') {
            const diff = currentValue - previousValue;
            if (Math.abs(diff) > 0.01) {
                trendEl.className = `tile-trend ${diff > 0 ? 'up' : 'down'}`;
                trendEl.textContent = diff > 0 ? '↑' : '↓';
                trendEl.title = `Zmiana: ${diff > 0 ? '+' : ''}${diff.toFixed(2)}`;
            } else {
                trendEl.className = '';
                trendEl.textContent = '';
                trendEl.title = '';
            }
        } else {
            trendEl.className = '';
            trendEl.textContent = '';
            trendEl.title = '';
        }
    }
    
    // Efekt wizualny aktualizacji
    tileEl.classList.remove('updated');
    void tileEl.offsetWidth;
    tileEl.classList.add('updated');
    
    // Zapisz ostatnią wartość
    lastValues[id] = {
        value: value,
        timestamp: now.getTime(),
        formattedTime: now.toLocaleTimeString('pl-PL', {hour: '2-digit', minute:'2-digit'})
    };
    
    console.log(`Zaktualizowano kafelek ${id}: ${value}`);
}

// Inicjalizacja wykresów
function initCharts() {
    if (typeof Chart === 'undefined') {
        console.error('Chart.js nie jest dostępny!');
        return;
    }
    
    const chartOptions = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: {
                labels: { color: '#94a3b8' }
            },
            tooltip: {
                mode: 'index',
                intersect: false,
                backgroundColor: 'rgba(15, 23, 42, 0.9)',
                titleColor: '#f8fafc',
                bodyColor: '#f8fafc'
            }
        },
        scales: {
            x: {
                grid: { color: 'rgba(255, 255, 255, 0.05)' },
                ticks: { color: '#94a3b8', maxTicksLimit: 8 }
            },
            y: {
                grid: { color: 'rgba(255, 255, 255, 0.05)' },
                ticks: { color: '#94a3b8' }
            }
        },
        animation: false,
        elements: {
            point: { radius: 0, hoverRadius: 3 }
        }
    };
    
    try {
        // Temperatury IDU
        const indoorCtx = document.getElementById('chartIndoor')?.getContext('2d');
        if (indoorCtx) {
            charts.indoor = new Chart(indoorCtx, {
                type: 'line',
                data: {
                    labels: [],
                    datasets: [
                        { label: 'Pokój', data: [], borderColor: '#3b82f6', backgroundColor: 'rgba(59, 130, 246, 0.1)', fill: true, tension: 0.4 },
                        { label: 'Rura', data: [], borderColor: '#10b981', backgroundColor: 'rgba(16, 185, 129, 0.1)', fill: true, tension: 0.4 },
                        { label: 'Zadana', data: [], borderColor: '#f59e0b', backgroundColor: 'rgba(245, 158, 11, 0.1)', fill: true, tension: 0.4 }
                    ]
                },
                options: chartOptions
            });
        }
        
        // Temperatury ODU
        const outdoorCtx = document.getElementById('chartOutdoor')?.getContext('2d');
        if (outdoorCtx) {
            charts.outdoor = new Chart(outdoorCtx, {
                type: 'line',
                data: {
                    labels: [],
                    datasets: [
                        { label: 'Moduł', data: [], borderColor: '#3b82f6', backgroundColor: 'rgba(59, 130, 246, 0.1)', fill: true, tension: 0.4 },
                        { label: 'Zewnętrzna', data: [], borderColor: '#10b981', backgroundColor: 'rgba(16, 185, 129, 0.1)', fill: true, tension: 0.4 },
                        { label: 'Wymiennik', data: [], borderColor: '#f59e0b', backgroundColor: 'rgba(245, 158, 11, 0.1)', fill: true, tension: 0.4 },
                        { label: 'Tłoczenie', data: [], borderColor: '#ef4444', backgroundColor: 'rgba(239, 68, 68, 0.1)', fill: true, tension: 0.4 }
                    ]
                },
                options: chartOptions
            });
        }
        
        // Prąd kompresora
        const currentCtx = document.getElementById('chartCurrent')?.getContext('2d');
        if (currentCtx) {
            charts.current = new Chart(currentCtx, {
                type: 'line',
                data: {
                    labels: [],
                    datasets: [
                        { label: 'Prąd [A]', data: [], borderColor: '#f59e0b', backgroundColor: 'rgba(245, 158, 11, 0.1)', fill: true, tension: 0.4 }
                    ]
                },
                options: chartOptions
            });
        }
        
        // Częstotliwość kompresora
        const compressorCtx = document.getElementById('chartCompressor')?.getContext('2d');
        if (compressorCtx) {
            charts.compressor = new Chart(compressorCtx, {
                type: 'line',
                data: {
                    labels: [],
                    datasets: [
                        { label: 'Częstotliwość [Hz]', data: [], borderColor: '#8b5cf6', backgroundColor: 'rgba(139, 92, 246, 0.1)', fill: true, tension: 0.4 }
                    ]
                },
                options: chartOptions
            });
        }
        
        // Wentylator ODU
        const fanCtx = document.getElementById('chartFanRpm')?.getContext('2d');
        if (fanCtx) {
            charts.fan = new Chart(fanCtx, {
                type: 'line',
                data: {
                    labels: [],
                    datasets: [
                        { label: 'Wentylator [rpm]', data: [], borderColor: '#06b6d4', backgroundColor: 'rgba(6, 182, 212, 0.1)', fill: true, tension: 0.4 }
                    ]
                },
                options: chartOptions
            });
        }
        
        console.log('Wykresy zainicjalizowane pomyślnie');
        
    } catch (error) {
        console.error('Błąd inicjalizacji wykresów:', error);
    }
}

// Aktualizacja wykresu
function updateChart(chart, value, datasetIndex = 0) {
    if (!chart) return;
    
    const now = new Date();
    const timeLabel = now.toLocaleTimeString('pl-PL', {hour: '2-digit', minute:'2-digit'});
    const numValue = parseFloat(value);
    
    if (isNaN(numValue)) return;
    
    // Dodaj nową etykietę i wartość
    chart.data.labels.push(timeLabel);
    
    if (!chart.data.datasets[datasetIndex]) return;
    
    chart.data.datasets[datasetIndex].data.push(numValue);
    
    // Ogranicz do maksymalnej liczby punktów
    if (chart.data.labels.length > maxChartPoints) {
        chart.data.labels.shift();
        chart.data.datasets.forEach(dataset => {
            if (dataset.data) dataset.data.shift();
        });
    }
    
    // Aktualizuj wykres
    chart.update('none');
}

// Inicjalizacja nasłuchiwania zdarzeń
function initEventListeners() {
    console.log('Inicjalizacja nasłuchiwania zdarzeń...');
    
    // Przyciski MQTT
    const btnConnect = document.getElementById('btnConnect');
    const btnDisconnect = document.getElementById('btnDisconnect');
    const btnTest = document.getElementById('btnTest');
    const mqttToggle = document.getElementById('mqttTogglePw');
    
    if (btnConnect) btnConnect.addEventListener('click', connectMQTT);
    if (btnDisconnect) btnDisconnect.addEventListener('click', disconnectMQTT);
    if (btnTest) btnTest.addEventListener('click', sendTestData);
    
    // Double-click do resetowania ustawień
    if (btnConnect) btnConnect.addEventListener('dblclick', resetMQTTSettings);
    
    // Toggle hasła MQTT
    if (mqttToggle) {
        mqttToggle.addEventListener('click', function() {
            const passwordInput = document.getElementById('mqttPass');
            if (!passwordInput) return;
            
            const icon = mqttToggle.querySelector('i');
            if (passwordInput.type === 'password') {
                passwordInput.type = 'text';
                icon.className = 'fas fa-eye-slash';
            } else {
                passwordInput.type = 'password';
                icon.className = 'fas fa-eye';
            }
        });
    }
    
    // Przycisk testowania połączenia
    const testConnectionBtn = document.getElementById('testConnection');
    if (testConnectionBtn) {
        testConnectionBtn.addEventListener('click', testMQTTConnection);
    }
    
    // Przycisk diagnostyki
    const showDiagnosticsBtn = document.getElementById('showDiagnostics');
    if (showDiagnosticsBtn) {
        showDiagnosticsBtn.addEventListener('click', function() {
            const diagnosticsEl = document.getElementById('connectionDiagnostics');
            if (diagnosticsEl) {
                if (diagnosticsEl.style.display === 'none') {
                    diagnosticsEl.style.display = 'block';
                    this.innerHTML = '<i class="fas fa-eye-slash"></i> Ukryj diagnostykę';
                } else {
                    diagnosticsEl.style.display = 'none';
                    this.innerHTML = '<i class="fas fa-eye"></i> Pokaż diagnostykę';
                }
            }
        });
    }
    
    // Automatyczna aktualizacja portu i protokołu
    const portSelect = document.getElementById('port');
    const protocolSelect = document.getElementById('protocol');
    
    if (portSelect && protocolSelect) {
        portSelect.addEventListener('change', function() {
            const port = this.value;
            if (port === '8883') {
                protocolSelect.value = 'mqtts';
            } else if (port === '8884') {
                protocolSelect.value = 'wss';
            } else if (port === '8080') {
                protocolSelect.value = 'ws';
            } else if (port === '1883') {
                protocolSelect.value = 'mqtt';
            }
        });
        
        protocolSelect.addEventListener('change', function() {
            const protocol = this.value;
            if (protocol === 'mqtts') {
                portSelect.value = '8883';
            } else if (protocol === 'wss') {
                portSelect.value = '8884';
            } else if (protocol === 'ws') {
                portSelect.value = '8080';
            } else if (protocol === 'mqtt') {
                portSelect.value = '1883';
            }
        });
    }
    
    // Monitor wiadomości
    const clearMessagesBtn = document.getElementById('clearMessages');
    const pauseMessagesBtn = document.getElementById('pauseMessages');
    
    if (clearMessagesBtn) clearMessagesBtn.addEventListener('click', clearMessages);
    if (pauseMessagesBtn) pauseMessagesBtn.addEventListener('click', togglePauseMessages);
    
    // Przycisk odświeżania
    const refreshBtn = document.getElementById('refreshBtn');
    if (refreshBtn) refreshBtn.addEventListener('click', refreshData);
    
    // Przycisk czyszczenia wykresów
    const clearChartsBtn = document.getElementById('clearCharts');
    if (clearChartsBtn) clearChartsBtn.addEventListener('click', clearCharts);
    
    // Przycisk ładowania historii
    const loadHistoryBtn = document.getElementById('loadHistory');
    if (loadHistoryBtn) loadHistoryBtn.addEventListener('click', loadHistoryData);
    
    // Przycisk eksportu wykresów
    const exportChartsBtn = document.getElementById('exportCharts');
    if (exportChartsBtn) exportChartsBtn.addEventListener('click', exportChartsData);
    
    // Ustawienia
    document.querySelectorAll('.settings-nav-item').forEach(item => {
        item.addEventListener('click', function() {
            const tab = this.getAttribute('data-tab');
            showSettingsTab(tab);
        });
    });
    
    // Ustawienia automatycznego odświeżania
    const autoRefreshSelect = document.getElementById('autoRefresh');
    if (autoRefreshSelect) {
        autoRefreshSelect.addEventListener('change', function() {
            const interval = parseInt(this.value);
            setupAutoRefresh(interval);
        });
    }
    
    console.log('Wszystkie zdarzenia zarejestrowane');
}

// Inicjalizacja ustawień wyglądu
function initAppearanceSettings() {
    const saveAppearanceBtn = document.getElementById('saveAppearance');
    const appearanceSelects = document.querySelectorAll('#settingsAppearance select');
    
    if (saveAppearanceBtn) {
        saveAppearanceBtn.addEventListener('click', saveAppearanceSettings);
    }
    
    // Nasłuchuj zmian w ustawieniach wyglądu
    if (appearanceSelects) {
        appearanceSelects.forEach(select => {
            select.addEventListener('change', function() {
                settingsChanged = true;
                showSaveButton();
            });
        });
    }
}

// Pokaz przycisk zapisu
function showSaveButton() {
    const saveBtn = document.getElementById('saveAppearance');
    if (saveBtn) {
        saveBtn.style.display = 'flex';
    }
}

// Testowanie konfiguracji MQTT
function testMQTTConnection() {
    addDiagnostic('=== TEST POŁĄCZENIA ===');
    addDiagnostic('Sprawdzanie konfiguracji...');
    
    const brokerInput = document.getElementById('broker');
    const userInput = document.getElementById('mqttUser');
    const passInput = document.getElementById('mqttPass');
    
    if (!brokerInput || !userInput || !passInput) {
        addDiagnostic('BŁĄD: Brak pól konfiguracyjnych');
        return;
    }
    
    const broker = brokerInput.value.trim();
    const user = userInput.value.trim();
    const pass = passInput.value.trim();
    
    addDiagnostic(`Broker: ${broker}`);
    addDiagnostic(`Użytkownik: ${user}`);
    addDiagnostic(`Hasło: ${pass ? 'ustawione' : 'brak'}`);
    
    // Sprawdź czy URL jest poprawny
    try {
        new URL(broker);
        addDiagnostic('✓ URL jest poprawny');
    } catch (e) {
        addDiagnostic(`✗ Niepoprawny URL: ${e.message}`);
    }
}

// Zapisz ustawienia wyglądu
function saveAppearanceSettings() {
    const themeSelect = document.getElementById('themeSelect');
    const tileLayout = document.getElementById('tileLayout');
    
    if (themeSelect && tileLayout) {
        const settings = {
            theme: themeSelect.value,
            tileLayout: tileLayout.value
        };
        
        // Zapisz do localStorage
        try {
            localStorage.setItem('appearanceSettings', JSON.stringify(settings));
            
            // Aplikuj zmiany
            applyAppearanceSettings(settings);
            
            // Wyświetl komunikat
            showSaveMessage('Ustawienia wyglądu zostały zapisane!');
            
            // Ukryj przycisk zapisu
            const saveBtn = document.getElementById('saveAppearance');
            if (saveBtn) {
                saveBtn.style.display = 'none';
            }
            
            settingsChanged = false;
            
        } catch (e) {
            console.error('Błąd zapisywania ustawień wyglądu:', e);
            showSaveMessage('Błąd zapisywania ustawień!', true);
        }
    }
}

// Aplikuj ustawienia wyglądu
function applyAppearanceSettings(settings) {
    // Zmiana motywu
    if (settings.theme === 'light') {
        document.body.classList.add('light-theme');
        document.body.classList.remove('dark-theme');
    } else if (settings.theme === 'dark') {
        document.body.classList.add('dark-theme');
        document.body.classList.remove('light-theme');
    } else {
        // Auto - sprawdź preferencje systemu
        if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
            document.body.classList.add('light-theme');
            document.body.classList.remove('dark-theme');
        } else {
            document.body.classList.add('dark-theme');
            document.body.classList.remove('light-theme');
        }
    }
    
    // Zmiana układu kafelków
    const oduGrid = document.querySelector('.odu-grid');
    const iduGrid = document.querySelector('.idu-grid');
    
    if (oduGrid && iduGrid) {
        if (settings.tileLayout === 'list') {
            oduGrid.style.gridTemplateColumns = '1fr';
            iduGrid.style.gridTemplateColumns = '1fr';
        } else {
            oduGrid.style.gridTemplateColumns = 'repeat(auto-fit, minmax(200px, 1fr))';
            iduGrid.style.gridTemplateColumns = 'repeat(auto-fit, minmax(200px, 1fr))';
        }
    }
}

// Wyświetl komunikat o zapisie
function showSaveMessage(message, isError = false) {
    const msgElement = document.createElement('div');
    msgElement.className = `save-message ${isError ? 'error' : 'success'}`;
    msgElement.textContent = message;
    msgElement.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 12px 24px;
        background: ${isError ? '#ef4444' : '#10b981'};
        color: white;
        border-radius: 8px;
        z-index: 10000;
        animation: slideIn 0.3s ease, fadeOut 0.3s ease 2.7s;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    `;
    
    document.body.appendChild(msgElement);
    
    // Usuń komunikat po 3 sekundach
    setTimeout(() => {
        if (msgElement.parentNode) {
            msgElement.parentNode.removeChild(msgElement);
        }
    }, 3000);
}

// Załaduj zapisane ustawienia wyglądu
function loadAppearanceSettings() {
    try {
        const saved = localStorage.getItem('appearanceSettings');
        if (saved) {
            const settings = JSON.parse(saved);
            
            const themeSelect = document.getElementById('themeSelect');
            const tileLayout = document.getElementById('tileLayout');
            
            if (themeSelect) themeSelect.value = settings.theme || 'dark';
            if (tileLayout) tileLayout.value = settings.tileLayout || 'grid';
            
            applyAppearanceSettings(settings);
        }
    } catch (e) {
        console.error('Błąd ładowania ustawień wyglądu:', e);
    }
}

// Funkcja eksportu danych wykresów
function exportChartsData() {
    try {
        const data = {
            timestamp: new Date().toISOString(),
            indoor: getChartData(charts.indoor),
            outdoor: getChartData(charts.outdoor),
            current: getChartData(charts.current),
            compressor: getChartData(charts.compressor),
            fan: getChartData(charts.fan)
        };
        
        const dataStr = JSON.stringify(data, null, 2);
        const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
        
        const exportFileDefaultName = `mqtt_dashboard_export_${new Date().toISOString().slice(0, 10)}.json`;
        
        const linkElement = document.createElement('a');
        linkElement.setAttribute('href', dataUri);
        linkElement.setAttribute('download', exportFileDefaultName);
        linkElement.click();
        
        addMessage('export', 'Dane wykresów wyeksportowane');
        showSaveMessage('Dane wykresów zostały wyeksportowane!');
    } catch (error) {
        console.error('Błąd eksportu danych:', error);
        showSaveMessage('Wystąpił błąd podczas eksportu danych!', true);
    }
}

function getChartData(chart) {
    if (!chart) return { labels: [], datasets: [] };
    return {
        labels: chart.data.labels,
        datasets: chart.data.datasets.map(ds => ({ label: ds.label, data: ds.data }))
    };
}

// Załaduj zapisane ustawienia
function loadSavedSettings() {
    try {
        const saved = localStorage.getItem('mqttSettings');
        if (saved) {
            const settings = JSON.parse(saved);
            
            const brokerInput = document.getElementById('broker');
            const userInput = document.getElementById('mqttUser');
            const passInput = document.getElementById('mqttPass');
            const clientIdInput = document.getElementById('clientId');
            const keepAliveInput = document.getElementById('keepAlive');
            const portSelect = document.getElementById('port');
            const protocolSelect = document.getElementById('protocol');
            const useTLSCheckbox = document.getElementById('useTLS');
            
            if (brokerInput) brokerInput.value = settings.broker || '';
            if (userInput) userInput.value = settings.user || '';
            if (passInput) passInput.value = settings.pass || '';
            if (clientIdInput) clientIdInput.value = settings.clientId || `M5StickC_Dashboard_${Date.now()}`;
            if (keepAliveInput) keepAliveInput.value = settings.keepAlive || '60';
            if (portSelect) portSelect.value = settings.port || '8884';
            if (protocolSelect) protocolSelect.value = settings.protocol || 'wss';
            if (useTLSCheckbox) useTLSCheckbox.checked = settings.useTLS !== false;
            
            addDiagnostic('Ustawienia załadowane z localStorage');
            
            const autoConnect = document.getElementById('autoConnect');
            if (autoConnect && autoConnect.checked && settings.broker && settings.user) {
                setTimeout(() => {
                    addDiagnostic('Automatyczne łączenie...');
                    connectMQTT();
                }, 2000);
            }
        }
        
        // Załaduj ustawienia wyglądu
        loadAppearanceSettings();
        
    } catch (e) {
        console.error('Błąd ładowania ustawień:', e);
        addDiagnostic(`Błąd ładowania ustawień: ${e.message}`);
    }
}

// Zapisz ustawienia
function saveSettings() {
    try {
        const brokerInput = document.getElementById('broker');
        const userInput = document.getElementById('mqttUser');
        const passInput = document.getElementById('mqttPass');
        const clientIdInput = document.getElementById('clientId');
        const keepAliveInput = document.getElementById('keepAlive');
        const portSelect = document.getElementById('port');
        const protocolSelect = document.getElementById('protocol');
        const useTLSCheckbox = document.getElementById('useTLS');
        
        if (!brokerInput || !userInput || !passInput) return;
        
        const settings = {
            broker: brokerInput.value,
            user: userInput.value,
            pass: passInput.value,
            clientId: clientIdInput ? clientIdInput.value : 'M5StickC_Dashboard',
            keepAlive: keepAliveInput ? keepAliveInput.value : '60',
            port: portSelect ? portSelect.value : '8884',
            protocol: protocolSelect ? protocolSelect.value : 'wss',
            useTLS: useTLSCheckbox ? useTLSCheckbox.checked : true,
            timestamp: new Date().toISOString()
        };
        
        localStorage.setItem('mqttSettings', JSON.stringify(settings));
        addDiagnostic('Ustawienia zapisane do localStorage');
        
    } catch (e) {
        console.error('Błąd zapisywania ustawień:', e);
        addDiagnostic(`Błąd zapisywania ustawień: ${e.message}`);
    }
}

// Resetuj ustawienia MQTT
function resetMQTTSettings() {
    if (confirm('Czy na pewno chcesz zresetować ustawienia MQTT do wartości domyślnych?')) {
        localStorage.removeItem('mqttSettings');
        
        const brokerInput = document.getElementById('broker');
        const userInput = document.getElementById('mqttUser');
        const passInput = document.getElementById('mqttPass');
        const clientIdInput = document.getElementById('clientId');
        const keepAliveInput = document.getElementById('keepAlive');
        const portSelect = document.getElementById('port');
        const protocolSelect = document.getElementById('protocol');
        const useTLSCheckbox = document.getElementById('useTLS');
        
        if (brokerInput) brokerInput.value = 'wss://772ebcf7129c4692affb3fc74ac5737f.s1.eu.hivemq.cloud:8884/mqtt';
        if (userInput) userInput.value = 'pawel22224';
        if (passInput) passInput.value = 'Klocek12';
        if (clientIdInput) clientIdInput.value = 'M5StickC_Dashboard';
        if (keepAliveInput) keepAliveInput.value = '60';
        if (portSelect) portSelect.value = '8884';
        if (protocolSelect) protocolSelect.value = 'wss';
        if (useTLSCheckbox) useTLSCheckbox.checked = true;
        
        showSaveMessage('Ustawienia MQTT zostały zresetowane!');
    }
}

// Połącz z brokerem MQTT
function connectMQTT() {
    const brokerInput = document.getElementById('broker');
    const userInput = document.getElementById('mqttUser');
    const passInput = document.getElementById('mqttPass');
    const clientIdInput = document.getElementById('clientId');
    const keepAliveInput = document.getElementById('keepAlive');
    const portSelect = document.getElementById('port');
    const protocolSelect = document.getElementById('protocol');
    const useTLSCheckbox = document.getElementById('useTLS');
    
    if (!brokerInput || !userInput || !passInput) {
        alert('Nie znaleziono pól konfiguracyjnych MQTT!');
        return;
    }
    
    let broker = brokerInput.value.trim();
    const user = userInput.value.trim();
    const pass = passInput.value.trim();
    const clientId = clientIdInput ? clientIdInput.value.trim() : `M5StickC_Dashboard_${Date.now()}`;
    const keepAlive = keepAliveInput ? parseInt(keepAliveInput.value) : 60;
    const port = portSelect ? portSelect.value : '8884';
    const protocol = protocolSelect ? protocolSelect.value : 'wss';
    const useTLS = useTLSCheckbox ? useTLSCheckbox.checked : true;
    
    // Wyczyść diagnostykę
    connectionDiagnostics = [];
    addDiagnostic('Rozpoczynanie połączenia...');
    
    // Jeśli broker nie zawiera protokołu, dodaj go
    if (!broker.startsWith('ws://') && !broker.startsWith('wss://') && 
        !broker.startsWith('mqtt://') && !broker.startsWith('mqtts://')) {
        
        // Usuń istniejący port jeśli jest w adresie
        broker = broker.split(':')[0];
        
        // Utwórz pełny URL
        if (protocol === 'wss' || protocol === 'mqtts') {
            broker = `${protocol}://${broker}:${port}/mqtt`;
        } else {
            broker = `${protocol}://${broker}:${port}`;
        }
        
        brokerInput.value = broker;
        addDiagnostic(`Skonstruowano URL: ${broker}`);
    }
    
    if (!broker) {
        alert('Proszę wprowadzić adres brokera MQTT!');
        return;
    }
    
    // Rozłącz istniejące połączenie
    if (mqttClient && mqttClient.connected) {
        try {
            addDiagnostic('Rozłączanie istniejącego połączenia...');
            mqttClient.end();
        } catch (e) {
            console.log('Błąd rozłączania poprzedniego klienta:', e);
            addDiagnostic(`Błąd rozłączania: ${e.message}`);
        }
    }
    
    updateMQTTStatus('Łączenie...', 'connecting');
    updateGlobalStatus('Łączenie...', 'connecting');
    addDiagnostic(`Status: Łączenie z ${broker}`);
    
    try {
        const options = {
            username: user,
            password: pass,
            clientId: clientId,
            clean: true,
            reconnectPeriod: 5000,
            connectTimeout: 10000,
            keepalive: keepAlive,
            rejectUnauthorized: false // Pozwala na samopodpisane certyfikaty
        };
        
        // Dodaj informacje diagnostyczne
        addDiagnostic(`ID Klienta: ${clientId}`);
        addDiagnostic(`Keep Alive: ${keepAlive}s`);
        addDiagnostic(`Użytkownik: ${user}`);
        addDiagnostic(`TLS: ${useTLS ? 'Tak' : 'Nie'}`);
        
        mqttClient = mqtt.connect(broker, options);
        addDiagnostic('Klient MQTT utworzony, nawiązywanie połączenia...');
        
        setupMQTTListeners();
        saveSettings();
        
    } catch (error) {
        console.error('Błąd połączenia MQTT:', error);
        updateMQTTStatus('Błąd połączenia', 'disconnected');
        updateGlobalStatus('Błąd', 'disconnected');
        addMessage('error', 'Błąd połączenia: ' + error.message);
        addDiagnostic(`BŁĄD: ${error.message}`);
        addDiagnostic(`Stack: ${error.stack}`);
    }
}

// Ustaw nasłuchiwacze MQTT
function setupMQTTListeners() {
    if (!mqttClient) return;
    
    mqttClient.on('connect', () => {
        console.log('✅ Połączono z brokerem MQTT');
        addDiagnostic('✅ Połączono z brokerem MQTT');
        updateMQTTStatus('Połączony', 'connected');
        updateGlobalStatus('Online', 'connected');
        addMessage('system', 'Połączono z brokerem MQTT');
        
        // Subskrybuj tematy
        Object.values(topics).forEach(topic => {
            mqttClient.subscribe(topic, { qos: 0 }, (err) => {
                if (!err) {
                    console.log(`Subskrybowano temat: ${topic}`);
                    addDiagnostic(`✓ Subskrybowano: ${topic}`);
                    topicSet.add(topic);
                    updateTopicCount();
                } else {
                    console.error('Błąd subskrypcji:', err);
                    addDiagnostic(`✗ Błąd subskrypcji ${topic}: ${err.message}`);
                }
            });
        });
        
        // Ustaw automatyczne odświeżanie
        setupAutoRefresh(10);
        
        // Rozpocznij symulację danych testowych
        startTestDataSimulation();
    });
    
    mqttClient.on('message', (topic, message) => {
        if (isPaused) return;
        
        const value = message.toString();
        messageCount++;
        updateMessageCount();
        addMessage(topic, value);
        processMQTTMessage(topic, value);
        
        // Dodaj diagnostykę dla pierwszej wiadomości
        if (messageCount === 1) {
            addDiagnostic(`📨 Pierwsza wiadomość: ${topic} = ${value}`);
        }
    });
    
    mqttClient.on('error', (err) => {
        console.error('❌ Błąd MQTT:', err);
        addDiagnostic(`❌ Błąd MQTT: ${err.message}`);
        updateMQTTStatus('Błąd: ' + err.message, 'disconnected');
        updateGlobalStatus('Błąd', 'disconnected');
        addMessage('error', 'Błąd MQTT: ' + err.message);
    });
    
    mqttClient.on('close', () => {
        console.log('🔌 Rozłączono z brokerem MQTT');
        addDiagnostic('🔌 Rozłączono z brokerem MQTT');
        updateMQTTStatus('Rozłączony', 'disconnected');
        updateGlobalStatus('Offline', 'disconnected');
        addMessage('system', 'Rozłączono z brokerem MQTT');
        
        // Wyczyść interwały
        if (autoRefreshInterval) clearInterval(autoRefreshInterval);
        if (testDataInterval) clearInterval(testDataInterval);
    });
    
    mqttClient.on('reconnect', () => {
        console.log('🔄 Ponowne łączenie...');
        addDiagnostic('🔄 Ponowne łączenie...');
        updateMQTTStatus('Łączenie...', 'connecting');
        updateGlobalStatus('Łączenie...', 'connecting');
    });
    
    mqttClient.on('offline', () => {
        console.log('📴 Klient offline');
        addDiagnostic('📴 Klient offline');
        updateMQTTStatus('Offline', 'disconnected');
        updateGlobalStatus('Offline', 'disconnected');
    });
    
    mqttClient.on('end', () => {
        console.log('🔚 Połączenie zakończone');
        addDiagnostic('🔚 Połączenie zakończone');
    });
}

// Rozpocznij symulację danych testowych
function startTestDataSimulation() {
    if (testDataInterval) clearInterval(testDataInterval);
    
    testDataInterval = setInterval(() => {
        if (mqttClient && mqttClient.connected) {
            sendTestData();
        }
    }, 5000);
}

// Przetwarzanie wiadomości MQTT
function processMQTTMessage(topic, value) {
    try {
        if (topic === topics.temp_room) {
            updateTile('temp_room', value);
            if (charts.indoor) updateChart(charts.indoor, parseFloat(value), 0);
        }
        else if (topic === topics.temp_pipe) {
            updateTile('temp_pipe', value);
            if (charts.indoor) updateChart(charts.indoor, parseFloat(value), 1);
        }
        else if (topic === topics.temp_set) {
            updateTile('temp_set', value);
            if (charts.indoor) updateChart(charts.indoor, parseFloat(value), 2);
        }
        else if (topic === topics.temp_module) {
            updateTile('temp_module', value);
            if (charts.outdoor) updateChart(charts.outdoor, parseFloat(value), 0);
        }
        else if (topic === topics.temp_outside) {
            updateTile('temp_outside', value);
            if (charts.outdoor) updateChart(charts.outdoor, parseFloat(value), 1);
        }
        else if (topic === topics.temp_exchanger) {
            updateTile('temp_exchanger', value);
            if (charts.outdoor) updateChart(charts.outdoor, parseFloat(value), 2);
        }
        else if (topic === topics.temp_discharge) {
            updateTile('temp_discharge', value);
            if (charts.outdoor) updateChart(charts.outdoor, parseFloat(value), 3);
        }
        else if (topic === topics.current_a) {
            updateTile('current', value);
            if (charts.current) updateChart(charts.current, parseFloat(value));
        }
        else if (topic === topics.compressor) {
            updateTile('compressor', value);
            if (charts.compressor) updateChart(charts.compressor, parseFloat(value));
        }
        else if (topic === topics.fan_rpm) {
            updateTile('fan_rpm', value);
            if (charts.fan) updateChart(charts.fan, parseFloat(value));
        }
        else if (topic === topics.mode) {
            updateTile('mode', value);
        }
        else if (topic === topics.fan_text) {
            updateTile('fan_text', value);
        }
    } catch (error) {
        console.error('Błąd przetwarzania wiadomości:', error);
        addMessage('error', 'Błąd parsowania: ' + value);
    }
}

// Rozłącz z brokerem MQTT
function disconnectMQTT() {
    if (mqttClient && mqttClient.connected) {
        mqttClient.end();
        updateMQTTStatus('Rozłączony', 'disconnected');
        updateGlobalStatus('Offline', 'disconnected');
        addMessage('system', 'Rozłączono ręcznie');
    }
}

// Wyślij dane testowe
function sendTestData() {
    if (!mqttClient || !mqttClient.connected) {
        console.warn('Nie można wysłać danych testowych - brak połączenia MQTT');
        return;
    }
    
    const now = new Date();
    const hour = now.getHours();
    const isDaytime = hour >= 6 && hour < 22;
    
    const testData = {
        [topics.temp_room]: (21 + Math.sin(now.getMinutes() / 30) * 1.5 + Math.random() * 0.5).toFixed(1),
        [topics.temp_outside]: (isDaytime ? 18 : 12 + Math.random() * 3).toFixed(1),
        [topics.compressor]: Math.floor(40 + Math.sin(now.getMinutes() / 15) * 10 + Math.random() * 5).toString(),
        [topics.fan_rpm]: Math.floor(800 + Math.sin(now.getMinutes() / 20) * 200 + Math.random() * 50).toString(),
        [topics.current_a]: (2.5 + Math.sin(now.getMinutes() / 30) * 0.8 + Math.random() * 0.2).toFixed(2),
        [topics.temp_module]: (35 + Math.sin(now.getMinutes() / 25) * 5 + Math.random() * 2).toFixed(1),
        [topics.temp_exchanger]: (40 + Math.sin(now.getMinutes() / 20) * 7 + Math.random() * 3).toFixed(1),
        [topics.temp_discharge]: (55 + Math.sin(now.getMinutes() / 15) * 10 + Math.random() * 5).toFixed(1),
        [topics.mode]: ['Chłodzenie', 'Ogrzewanie', 'Auto'][Math.floor(Math.random() * 3)],
        [topics.fan_text]: ['Niski', 'Średni', 'Wysoki'][Math.floor(Math.random() * 3)],
        [topics.temp_set]: (22 + Math.random() * 1).toFixed(1),
        [topics.temp_pipe]: (18 + Math.sin(now.getMinutes() / 35) * 3 + Math.random() * 1).toFixed(1)
    };
    
    Object.entries(testData).forEach(([topic, value]) => {
        mqttClient.publish(topic, value);
    });
    
    console.log('Wysłano dane testowe');
}

// Dodaj wiadomość do monitora
function addMessage(topic, value) {
    if (isPaused) return;
    
    const messagesContainer = document.getElementById('mqttMessages');
    if (!messagesContainer) return;
    
    const emptyMessages = messagesContainer.querySelector('.empty-messages');
    
    if (emptyMessages) {
        emptyMessages.remove();
    }
    
    const messageEl = document.createElement('div');
    messageEl.className = 'message-item';
    messageEl.innerHTML = `
        <span class="message-time">${new Date().toLocaleTimeString('pl-PL', {hour: '2-digit', minute:'2-digit', second:'2-digit'})}</span>
        <span class="message-topic">${topic}</span>
        <span class="message-value"> = ${value}</span>
    `;
    
    messagesContainer.prepend(messageEl);
    
    const messages = messagesContainer.querySelectorAll('.message-item');
    if (messages.length > maxMessages) {
        messages[messages.length - 1].remove();
    }
}

// Wyczyść wiadomości
function clearMessages() {
    const messagesContainer = document.getElementById('mqttMessages');
    if (!messagesContainer) return;
    
    messagesContainer.innerHTML = `
        <div class="empty-messages">
            <i class="fas fa-comment-slash"></i>
            <p>Brak wiadomości. Połącz się z brokerem, aby zobaczyć dane.</p>
        </div>
    `;
    messageCount = 0;
    updateMessageCount();
}

// Wstrzymaj/wznów wiadomości
function togglePauseMessages() {
    isPaused = !isPaused;
    const pauseBtn = document.getElementById('pauseMessages');
    if (!pauseBtn) return;
    
    const icon = pauseBtn.querySelector('i');
    
    if (isPaused) {
        icon.className = 'fas fa-play';
        pauseBtn.innerHTML = '<i class="fas fa-play"></i> Wznów';
        addMessage('system', 'Monitor wiadomości wstrzymany');
    } else {
        icon.className = 'fas fa-pause';
        pauseBtn.innerHTML = '<i class="fas fa-pause"></i> Wstrzymaj';
        addMessage('system', 'Monitor wiadomości wznowiony');
    }
}

// Aktualizuj status MQTT
function updateMQTTStatus(text, status) {
    const statusEl = document.getElementById('mqttStatus');
    if (!statusEl) return;
    
    const indicator = statusEl.querySelector('.status-indicator');
    const textEl = statusEl.querySelector('.status-text');
    
    if (indicator) indicator.className = `status-indicator ${status}`;
    if (textEl) textEl.textContent = text;
}

// Aktualizuj globalny status
function updateGlobalStatus(text, status) {
    const statusEl = document.getElementById('globalStatus');
    if (!statusEl) return;
    
    const indicator = statusEl.querySelector('.status-indicator');
    const textEl = statusEl.querySelector('.status-text');
    
    if (indicator) indicator.className = `status-indicator ${status}`;
    if (textEl) textEl.textContent = text;
}

// Aktualizuj licznik wiadomości
function updateMessageCount() {
    const messageCountEl = document.getElementById('messageCount');
    if (messageCountEl) {
        messageCountEl.textContent = messageCount;
    }
}

// Aktualizuj licznik tematów
function updateTopicCount() {
    const topicCountEl = document.getElementById('topicCount');
    if (topicCountEl) {
        topicCountEl.textContent = topicSet.size;
    }
}

// Odśwież dane
function refreshData() {
    if (mqttClient && mqttClient.connected) {
        mqttClient.publish('m5stick/command/refresh', '1');
        addMessage('command', 'Wysłano żądanie odświeżenia');
        
        Object.keys(lastValues).forEach(id => {
            const value = lastValues[id];
            if (value && Date.now() - value.timestamp < 60000) {
                updateTile(id, value.value);
            }
        });
        
        const refreshBtn = document.getElementById('refreshBtn');
        if (refreshBtn) {
            refreshBtn.classList.add('refreshing');
            setTimeout(() => refreshBtn.classList.remove('refreshing'), 500);
        }
    } else {
        alert('Nie jesteś połączony z brokerem MQTT!');
    }
}

// Wyczyść wykresy
function clearCharts() {
    if (confirm('Czy na pewno chcesz wyczyścić wszystkie wykresy?')) {
        Object.values(charts).forEach(chart => {
            if (chart) {
                chart.data.labels = [];
                chart.data.datasets.forEach(dataset => dataset.data = []);
                chart.update();
            }
        });
        addMessage('system', 'Wykresy zostały wyczyszczone');
    }
}

// Ustaw automatyczne odświeżanie
function setupAutoRefresh(intervalSeconds) {
    if (autoRefreshInterval) clearInterval(autoRefreshInterval);
    
    if (intervalSeconds > 0) {
        autoRefreshInterval = setInterval(() => {
            if (mqttClient && mqttClient.connected) {
                const randomTemp = (21 + Math.random() * 2).toFixed(1);
                mqttClient.publish(topics.temp_room, randomTemp);
            }
        }, intervalSeconds * 1000);
    }
}

// Załaduj dane historyczne
function loadHistoryData() {
    const tableBody = document.getElementById('historyTableBody');
    if (!tableBody) return;
    
    const now = new Date();
    const historyData = [];
    
    for (let i = 0; i < 10; i++) {
        const date = new Date(now.getTime() - i * 3600000);
        historyData.push({
            time: date.toLocaleString('pl-PL'),
            tempRoom: (21 + Math.random() * 3).toFixed(1),
            tempOutside: (15 + Math.random() * 8).toFixed(1),
            current: (2.5 + Math.random() * 1.5).toFixed(2),
            mode: ['Chłodzenie', 'Ogrzewanie', 'Auto'][Math.floor(Math.random() * 3)],
            status: Math.random() > 0.5 ? 'Aktywny' : 'Nieaktywny'
        });
    }
    
    tableBody.innerHTML = '';
    historyData.forEach(data => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${data.time}</td>
            <td>${data.tempRoom}°C</td>
            <td>${data.tempOutside}°C</td>
            <td>${data.current} A</td>
            <td>${data.mode}</td>
            <td><span class="status-badge ${data.status === 'Aktywny' ? 'active' : ''}">${data.status}</span></td>
        `;
        tableBody.appendChild(row);
    });
    
    addMessage('history', 'Załadowano dane historyczne');
}

// Przełączanie zakładek
function showTab(tabId) {
    document.querySelectorAll('.tab-content').forEach(tab => {
        tab.classList.remove('active');
    });
    
    document.querySelectorAll('.menu-item').forEach(btn => {
        btn.classList.remove('active');
    });
    
    const selectedTab = document.getElementById(tabId);
    if (selectedTab) {
        selectedTab.classList.add('active');
    }
    
    document.querySelectorAll('.menu-item').forEach(btn => {
        if (btn.onclick && btn.onclick.toString().includes(`'${tabId}'`)) {
            btn.classList.add('active');
        }
    });
    
    const titles = {
        'home': 'Dashboard Systemu',
        'charts': 'Wykresy Historyczne',
        'mqtt': 'Konfiguracja MQTT',
        'history': 'Historia Danych',
        'settings': 'Ustawienia Aplikacji'
    };
    
    const pageTitle = document.getElementById('pageTitle');
    if (pageTitle && titles[tabId]) {
        pageTitle.textContent = titles[tabId];
    }
    
    if (tabId === 'charts') {
        setTimeout(() => {
            Object.values(charts).forEach(chart => {
                if (chart) {
                    chart.resize();
                    chart.update();
                }
            });
        }, 100);
    }
    
    console.log(`Przełączono na zakładkę: ${tabId}`);
}

// Przełączanie zakładek ustawień
function showSettingsTab(tabId) {
    document.querySelectorAll('.settings-tab').forEach(tab => {
        tab.classList.remove('active');
    });
    
    document.querySelectorAll('.settings-nav-item').forEach(btn => {
        btn.classList.remove('active');
    });
    
    const tabElement = document.getElementById(`settings${tabId.charAt(0).toUpperCase() + tabId.slice(1)}`);
    if (tabElement) {
        tabElement.classList.add('active');
    }
    
    const navButton = document.querySelector(`.settings-nav-item[data-tab="${tabId}"]`);
    if (navButton) {
        navButton.classList.add('active');
    }
    
    // Ukryj przycisk zapisu jeśli przechodzimy na inną zakładkę niż wygląd
    if (tabId !== 'appearance') {
        const saveBtn = document.getElementById('saveAppearance');
        if (saveBtn) {
            saveBtn.style.display = 'none';
        }
    }
}

// Dodaj style CSS dla animacji
const style = document.createElement('style');
style.textContent = `
@keyframes shake {
    0%, 100% { transform: translateX(0); }
    10%, 30%, 50%, 70%, 90% { transform: translateX(-5px); }
    20%, 40%, 60%, 80% { transform: translateX(5px); }
}

.shake {
    animation: shake 0.5s ease-in-out;
}

.status-indicator.connecting {
    animation: pulseStatus 1.5s infinite;
}

@keyframes pulseStatus {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
}

.btn-refresh.refreshing i {
    animation: spin 0.5s linear infinite;
}

@keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
}

@keyframes highlight {
    0% { box-shadow: 0 0 0 0 rgba(59, 130, 246, 0.4); }
    70% { box-shadow: 0 0 0 10px rgba(59, 130, 246, 0); }
    100% { box-shadow: 0 0 0 0 rgba(59, 130, 246, 0); }
}

.tile.updated {
    animation: highlight 1s ease;
}

@keyframes slideIn {
    from { transform: translateX(100%); opacity: 0; }
    to { transform: translateX(0); opacity: 1; }
}

@keyframes fadeOut {
    from { opacity: 1; }
    to { opacity: 0; }
}
`;
document.head.appendChild(style);

// Eksportuj funkcje do globalnego scope
window.showTab = showTab;
window.logout = logout;
window.showSettingsTab = showSettingsTab;

console.log('Aplikacja M5StickC Dashboard zainicjalizowana pomyślnie');
