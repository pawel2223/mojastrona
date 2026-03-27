// app.js - Dashboard RAC Monitor z MQTT i wykresami

// Tematy MQTT
const topics = {
    compressor: "rac/external/compressor",
    fan_rpm: "rac/external/fan_rpm",
    current_a: "rac/external/current",
    temp_module: "rac/external/temp_module",
    temp_outside: "rac/external/temp_outside",
    temp_exchanger: "rac/external/temp_exchanger",
    temp_discharge: "rac/external/temp_discharge",
    mode: "rac/internal/mode",
    fan_speed: "rac/internal/fan_speed",
    temp_set: "rac/internal/temp_set",
    temp_room: "rac/internal/temp_room",
    temp_pipe: "rac/internal/temp_pipe"
};

// Konfiguracja kafli
const tilesConfig = {
    odu: [
        {id: 'compressor', label: 'Kompresor', unit: 'Hz', icon: 'fa-tachometer-alt', color: '#8b5cf6', defaultValue: '0'},
        {id: 'fan_rpm', label: 'Wentylator ODU', unit: 'rpm', icon: 'fa-fan', color: '#06b6d4', defaultValue: '0'},
        {id: 'current', label: 'Prąd', unit: 'A', icon: 'fa-bolt', color: '#f59e0b', defaultValue: '0'},
        {id: 'temp_module', label: 'Temp. modułu', unit: '°C', icon: 'fa-microchip', color: '#8b5cf6', defaultValue: '0'},
        {id: 'temp_outside', label: 'Temp. zewnętrzna', unit: '°C', icon: 'fa-sun', color: '#f97316', defaultValue: '0'},
        {id: 'temp_exchanger', label: 'Temp. wymiennika', unit: '°C', icon: 'fa-exchange-alt', color: '#a855f7', defaultValue: '0'},
        {id: 'temp_discharge', label: 'Temp. tłoczenia', unit: '°C', icon: 'fa-fire', color: '#ef4444', defaultValue: '0'}
    ],
    idu: [
        {id: 'mode', label: 'Tryb pracy', unit: '', icon: 'fa-cogs', color: '#3b82f6', defaultValue: '---'},
        {id: 'fan_speed', label: 'Wentylator IDU', unit: '', icon: 'fa-wind', color: '#10b981', defaultValue: '---'},
        {id: 'temp_set', label: 'Temp. zadana', unit: '°C', icon: 'fa-bullseye', color: '#f59e0b', defaultValue: '0'},
        {id: 'temp_room', label: 'Temp. pokojowa', unit: '°C', icon: 'fa-home', color: '#3b82f6', defaultValue: '0'},
        {id: 'temp_pipe', label: 'Temp. rury', unit: '°C', icon: 'fa-water', color: '#10b981', defaultValue: '0'}
    ]
};

// Zmienne globalne
let mqttClient = null;
let charts = {};
let messageCount = 0;
let topicSet = new Set();
let isPaused = false;
let lastValues = {};
let maxChartPoints = 60;
const maxMessages = 50;
let autoRefreshInterval = null;
let lastUpdateTime = null;
let historyData = [];
const MAX_HISTORY = 500;
let lastMqttMessageTime = 0;
const MQTT_TIMEOUT = 30000;

// Inicjalizacja
document.addEventListener('DOMContentLoaded', function() {
    initLogin();
    initClock();
    initEventListeners();
    initAppearanceSettings();
    loadHistoryFromStorage();
    initResetButton();
    startMqttWatchdog();
});

// Funkcja do resetu ESP32
function resetESP32() {
    if (mqttClient && mqttClient.connected) {
        mqttClient.publish("rac/command/reset", "reset");
        showSaveMessage('Wysłano komendę resetu przez MQTT!');
        setTimeout(() => showSaveMessage('ESP32 powinien się zrestartować...'), 1000);
    } else {
        fetch('/reset', { method: 'GET' })
            .then(() => showSaveMessage('Resetowanie ESP32 przez HTTP...'))
            .catch(() => showSaveMessage('Nie można zresetować ESP32!', true));
    }
}

// Watchdog dla MQTT
function startMqttWatchdog() {
    setInterval(() => {
        if (mqttClient && mqttClient.connected) {
            const now = Date.now();
            if (lastMqttMessageTime > 0 && (now - lastMqttMessageTime) > MQTT_TIMEOUT) {
                console.log('MQTT timeout - reconnecting...');
                mqttClient.end();
                connectMQTT();
            }
        }
    }, 10000);
}

function initResetButton() {
    const resetBtn = document.getElementById('resetEspBtn');
    const modal = document.getElementById('resetModal');
    const cancelBtn = document.getElementById('cancelReset');
    const confirmBtn = document.getElementById('confirmReset');
    
    if (resetBtn) resetBtn.addEventListener('click', () => { if (modal) modal.style.display = 'flex'; });
    if (cancelBtn) cancelBtn.addEventListener('click', () => { if (modal) modal.style.display = 'none'; });
    if (confirmBtn) confirmBtn.addEventListener('click', () => { if (modal) modal.style.display = 'none'; resetESP32(); });
    window.addEventListener('click', (e) => { if (modal && e.target === modal) modal.style.display = 'none'; });
}

function initLogin() {
    const btnLogin = document.getElementById('btnLogin');
    const loginToggle = document.getElementById('loginTogglePw');
    const errorMsg = document.getElementById('login-msg');
    
    if (btnLogin) btnLogin.addEventListener('click', handleLogin);
    if (loginToggle) {
        loginToggle.addEventListener('click', () => {
            const pw = document.getElementById('password');
            if (pw) pw.type = pw.type === 'password' ? 'text' : 'password';
        });
    }
    document.getElementById('password')?.addEventListener('keypress', e => { if (e.key === 'Enter') handleLogin(); });
}

function handleLogin() {
    const username = document.getElementById('login')?.value.trim();
    const password = document.getElementById('password')?.value.trim();
    const errorMsg = document.getElementById('login-msg');
    
    if (username === 'admin' && password === 'admin') {
        if (errorMsg) errorMsg.style.display = 'none';
        showApp();
        loadSavedSettings();
    } else {
        if (errorMsg) {
            errorMsg.style.display = 'block';
            errorMsg.textContent = 'Nieprawidłowy login lub hasło! (admin/admin)';
        }
    }
}

function showApp() {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('app').style.display = 'flex';
    updateGlobalStatus('Rozłączony', 'disconnected');
    setTimeout(() => {
        buildTiles();
        initCharts();
        showTab('home');
        initializeTileValues();
        addQuickConfigButtons();
    }, 100);
}

function addQuickConfigButtons() {
    const container = document.querySelector('.mqtt-config-card .config-section:first-child');
    if (!container) return;
    const div = document.createElement('div');
    div.className = 'quick-config';
    div.innerHTML = `<div style="margin-top:20px"><label style="font-size:0.8rem;color:var(--text-muted)">Szybka konfiguracja:</label><div style="display:flex;gap:8px;margin-top:8px"><button class="btn-quick-config" data-type="hivemq" style="padding:6px 12px;background:rgba(59,130,246,0.1);border:1px solid rgba(59,130,246,0.3);border-radius:8px;cursor:pointer">HiveMQ WSS</button><button class="btn-quick-config" data-type="hivemq_tls" style="padding:6px 12px;background:rgba(59,130,246,0.1);border:1px solid rgba(59,130,246,0.3);border-radius:8px;cursor:pointer">HiveMQ TLS</button><button class="btn-quick-config" data-type="mosquitto" style="padding:6px 12px;background:rgba(59,130,246,0.1);border:1px solid rgba(59,130,246,0.3);border-radius:8px;cursor:pointer">Mosquitto</button></div></div>`;
    container.appendChild(div);
    document.querySelectorAll('.btn-quick-config').forEach(btn => {
        btn.addEventListener('click', () => autoConfigureMQTT(btn.dataset.type));
    });
}

function autoConfigureMQTT(type) {
    const broker = document.getElementById('broker');
    const port = document.getElementById('port');
    const protocol = document.getElementById('protocol');
    const useTLS = document.getElementById('useTLS');
    if (!broker || !port || !protocol) return;
    if (type === 'hivemq') {
        broker.value = 'wss://772ebcf7129c4692affb3fc74ac5737f.s1.eu.hivemq.cloud:8884/mqtt';
        port.value = '8884';
        protocol.value = 'wss';
        if (useTLS) useTLS.checked = true;
    } else if (type === 'hivemq_tls') {
        broker.value = 'mqtts://772ebcf7129c4692affb3fc74ac5737f.s1.eu.hivemq.cloud:8883';
        port.value = '8883';
        protocol.value = 'mqtts';
        if (useTLS) useTLS.checked = true;
    } else if (type === 'mosquitto') {
        broker.value = 'ws://test.mosquitto.org:8080';
        port.value = '8080';
        protocol.value = 'ws';
        if (useTLS) useTLS.checked = false;
    }
}

function initializeTileValues() {
    [...tilesConfig.odu, ...tilesConfig.idu].forEach(tile => updateTile(tile.id, tile.defaultValue));
}

function logout() {
    if (autoRefreshInterval) clearInterval(autoRefreshInterval);
    if (mqttClient && mqttClient.connected) mqttClient.end();
    resetApp();
    document.getElementById('app').style.display = 'none';
    document.getElementById('login-screen').style.display = 'flex';
    document.getElementById('password').value = '';
}

function resetApp() {
    messageCount = 0;
    topicSet.clear();
    lastValues = {};
    updateMessageCount();
    updateTopicCount();
    Object.values(charts).forEach(chart => {
        if (chart) {
            chart.data.labels = [];
            chart.data.datasets.forEach(ds => ds.data = []);
            chart.update();
        }
    });
    [...tilesConfig.odu, ...tilesConfig.idu].forEach(tile => {
        const el = document.getElementById(`${tile.id}-value`);
        if (el) el.textContent = '--';
    });
}

function initClock() {
    const update = () => {
        const el = document.getElementById('clock');
        if (el) el.textContent = new Date().toLocaleTimeString('pl-PL');
    };
    update();
    setInterval(update, 1000);
}

function buildTiles() {
    const odu = document.getElementById('odu-tiles');
    const idu = document.getElementById('idu-tiles');
    if (odu) { odu.innerHTML = ''; tilesConfig.odu.forEach(t => odu.appendChild(createTileElement(t))); }
    if (idu) { idu.innerHTML = ''; tilesConfig.idu.forEach(t => idu.appendChild(createTileElement(t))); }
}

function createTileElement(tile) {
    const div = document.createElement('div');
    div.className = 'tile';
    div.id = `tile-${tile.id}`;
    div.innerHTML = `<div class="tile-header"><div class="tile-label"><i class="fas ${tile.icon}" style="color:${tile.color}"></i>${tile.label}</div><div class="tile-trend"></div></div><div class="tile-value" id="${tile.id}-value">${tile.defaultValue}</div><div class="tile-unit">${tile.unit}</div><div class="tile-footer"><div class="tile-updated" id="${tile.id}-updated">ostatnia: -</div></div>`;
    return div;
}

function updateTile(id, value) {
    const valueEl = document.getElementById(`${id}-value`);
    const updatedEl = document.getElementById(`${id}-updated`);
    const tileEl = document.getElementById(`tile-${id}`);
    if (!valueEl || !updatedEl || !tileEl) return;
    const prev = parseFloat(valueEl.textContent);
    const curr = parseFloat(value);
    valueEl.textContent = value;
    updatedEl.textContent = `aktualne: ${new Date().toLocaleTimeString('pl-PL', {hour:'2-digit', minute:'2-digit'})}`;
    const trend = tileEl.querySelector('.tile-trend');
    if (trend && !isNaN(curr) && !isNaN(prev) && valueEl.textContent !== '--') {
        const diff = curr - prev;
        if (Math.abs(diff) > 0.01) {
            trend.className = `tile-trend ${diff > 0 ? 'up' : 'down'}`;
            trend.textContent = diff > 0 ? '↑' : '↓';
        } else { trend.className = ''; trend.textContent = ''; }
    }
    tileEl.classList.remove('updated');
    void tileEl.offsetWidth;
    tileEl.classList.add('updated');
    lastValues[id] = { value, timestamp: Date.now() };
}

function saveToHistory() {
    const now = new Date();
    const dateStr = now.toLocaleDateString('pl-PL');
    const timeStr = now.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    
    const data = {
        timestamp: now.toISOString(),
        date: dateStr,
        time: timeStr,
        temp_room: lastValues.temp_room?.value || '0',
        temp_set: lastValues.temp_set?.value || '0',
        temp_pipe: lastValues.temp_pipe?.value || '0',
        temp_outside: lastValues.temp_outside?.value || '0',
        temp_module: lastValues.temp_module?.value || '0',
        temp_exchanger: lastValues.temp_exchanger?.value || '0',
        temp_discharge: lastValues.temp_discharge?.value || '0',
        compressor: lastValues.compressor?.value || '0',
        current: lastValues.current?.value || '0',
        fan_rpm: lastValues.fan_rpm?.value || '0',
        fan_speed: lastValues.fan_speed?.value || '---',
        mode: lastValues.mode?.value || '---'
    };
    historyData.unshift(data);
    if (historyData.length > MAX_HISTORY) historyData.pop();
    try { localStorage.setItem('racHistoryData', JSON.stringify(historyData)); } catch(e) {}
}

function loadHistoryFromStorage() {
    try { const saved = localStorage.getItem('racHistoryData'); if (saved) historyData = JSON.parse(saved); } catch(e) { historyData = []; }
}

function clearHistory() {
    if (confirm('Czy na pewno chcesz wyczyścić historię?')) {
        historyData = [];
        saveHistoryToStorage();
        loadHistoryData();
        showSaveMessage('Historia została wyczyszczona!');
    }
}

function saveHistoryToStorage() {
    try { localStorage.setItem('racHistoryData', JSON.stringify(historyData)); } catch(e) {}
}

function exportHistoryToCSV() {
    if (!historyData.length) { alert('Brak danych do eksportu!'); return; }
    
    // 14 kolumn: Data, Godzina, i 12 parametrów
    const headers = [
        'Data',
        'Godzina',
        'Temperatura pokojowa [°C]',
        'Temperatura zadana [°C]',
        'Temperatura rury [°C]',
        'Temperatura zewnętrzna [°C]',
        'Temperatura modułu [°C]',
        'Temperatura wymiennika [°C]',
        'Temperatura tłoczenia [°C]',
        'Kompresor [Hz]',
        'Prąd [A]',
        'Wentylator ODU [rpm]',
        'Wentylator IDU',
        'Tryb pracy'
    ];
    
    const rows = historyData.map(r => [
        r.date,
        r.time,
        r.temp_room,
        r.temp_set,
        r.temp_pipe,
        r.temp_outside,
        r.temp_module,
        r.temp_exchanger,
        r.temp_discharge,
        r.compressor,
        r.current,
        r.fan_rpm,
        r.fan_speed,
        r.mode
    ]);
    
    const csvContent = [headers, ...rows].map(row => row.join(',')).join('\n');
    const blob = new Blob(["\uFEFF" + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `rac_history_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showSaveMessage('Dane wyeksportowane do CSV! (14 kolumn)');
}

function loadHistoryData() {
    const tbody = document.getElementById('historyTableBody');
    if (!tbody) return;
    const range = document.getElementById('historyRange')?.value;
    const limit = document.getElementById('historyLimit')?.value;
    let filtered = [...historyData];
    if (range && range !== '0') {
        const days = parseInt(range);
        const cutoff = Date.now() - days * 86400000;
        filtered = filtered.filter(r => new Date(r.timestamp).getTime() >= cutoff);
    }
    if (limit && limit !== '0') filtered = filtered.slice(0, parseInt(limit));
    if (!filtered.length) {
        tbody.innerHTML = '<tr><td colspan="14" style="text-align:center;padding:40px"><i class="fas fa-database"></i><p>Brak danych historycznych</p><p style="font-size:0.75rem">Połącz się z MQTT aby zbierać dane</p></td></tr>';
        return;
    }
    tbody.innerHTML = filtered.map(d => `
        <tr>
            <td>${d.date}</td>
            <td>${d.time}</td>
            <td>${d.temp_room}°C</td>
            <td>${d.temp_set}°C</td>
            <td>${d.temp_pipe}°C</td>
            <td>${d.temp_outside}°C</td>
            <td>${d.temp_module}°C</td>
            <td>${d.temp_exchanger}°C</td>
            <td>${d.temp_discharge}°C</td>
            <td>${d.compressor} Hz</td>
            <td>${d.current} A</td>
            <td>${d.fan_rpm} rpm</td>
            <td>${d.fan_speed}</td>
            <td>${d.mode}</td>
         </tr>
    `).join('');
}

function initCharts() {
    if (typeof Chart === 'undefined') return;
    
    const commonOpts = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: { display: true, position: 'top', labels: { color: '#94a3b8', font: { size: 11 }, usePointStyle: true, boxWidth: 8 } },
            tooltip: { mode: 'index', intersect: false, backgroundColor: 'rgba(15,23,42,0.9)', titleColor: '#f8fafc', bodyColor: '#f8fafc', padding: 10, cornerRadius: 8 }
        },
        scales: {
            x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8', maxRotation: 45, minRotation: 45, font: { size: 10 } } },
            y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8', font: { size: 10 } } }
        },
        elements: { point: { radius: 3, hoverRadius: 6, borderWidth: 2, backgroundColor: 'white' }, line: { tension: 0.3, borderWidth: 2 } },
        interaction: { intersect: false, mode: 'index' },
        animation: { duration: 0 }
    };
    
    // Wykres temperatury IDU (może przyjmować wartości ujemne)
    const indoorOpts = JSON.parse(JSON.stringify(commonOpts));
    indoorOpts.scales.y.beginAtZero = false;
    
    const indoor = document.getElementById('chartIndoor')?.getContext('2d');
    if (indoor) charts.indoor = new Chart(indoor, {
        type: 'line',
        data: { labels: [], datasets: [
            { label: 'Temperatura pokojowa', data: [], borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,0.05)', fill: true, pointBackgroundColor: '#3b82f6', pointBorderColor: '#fff', pointRadius: 3, pointHoverRadius: 6 },
            { label: 'Temperatura rury', data: [], borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,0.05)', fill: true, pointBackgroundColor: '#10b981', pointBorderColor: '#fff', pointRadius: 3, pointHoverRadius: 6 },
            { label: 'Temperatura zadana', data: [], borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,0.05)', fill: true, pointBackgroundColor: '#f59e0b', pointBorderColor: '#fff', pointRadius: 3, pointHoverRadius: 6 }
        ] },
        options: indoorOpts
    });
    
    // Wykres temperatury ODU (może przyjmować wartości ujemne)
    const outdoorOpts = JSON.parse(JSON.stringify(commonOpts));
    outdoorOpts.scales.y.beginAtZero = false;
    
    const outdoor = document.getElementById('chartOutdoor')?.getContext('2d');
    if (outdoor) charts.outdoor = new Chart(outdoor, {
        type: 'line',
        data: { labels: [], datasets: [
            { label: 'Temperatura modułu', data: [], borderColor: '#8b5cf6', backgroundColor: 'rgba(139,92,246,0.05)', fill: true, pointBackgroundColor: '#8b5cf6', pointBorderColor: '#fff', pointRadius: 3, pointHoverRadius: 6 },
            { label: 'Temperatura zewnętrzna', data: [], borderColor: '#f97316', backgroundColor: 'rgba(249,115,22,0.05)', fill: true, pointBackgroundColor: '#f97316', pointBorderColor: '#fff', pointRadius: 3, pointHoverRadius: 6 },
            { label: 'Temperatura wymiennika', data: [], borderColor: '#a855f7', backgroundColor: 'rgba(168,85,247,0.05)', fill: true, pointBackgroundColor: '#a855f7', pointBorderColor: '#fff', pointRadius: 3, pointHoverRadius: 6 },
            { label: 'Temperatura tłoczenia', data: [], borderColor: '#ef4444', backgroundColor: 'rgba(239,68,68,0.05)', fill: true, pointBackgroundColor: '#ef4444', pointBorderColor: '#fff', pointRadius: 3, pointHoverRadius: 6 }
        ] },
        options: outdoorOpts
    });
    
    // Wykres prądu (skala od 0)
    const currentOpts = JSON.parse(JSON.stringify(commonOpts));
    currentOpts.scales.y.beginAtZero = true;
    
    const current = document.getElementById('chartCurrent')?.getContext('2d');
    if (current) charts.current = new Chart(current, {
        type: 'line',
        data: { labels: [], datasets: [{ label: 'Prąd [A]', data: [], borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,0.05)', fill: true, pointBackgroundColor: '#f59e0b', pointBorderColor: '#fff', pointRadius: 3, pointHoverRadius: 6 }] },
        options: currentOpts
    });
    
    // Wykres częstotliwości kompresora (skala od 0)
    const compressorOpts = JSON.parse(JSON.stringify(commonOpts));
    compressorOpts.scales.y.beginAtZero = true;
    
    const compressor = document.getElementById('chartCompressor')?.getContext('2d');
    if (compressor) charts.compressor = new Chart(compressor, {
        type: 'line',
        data: { labels: [], datasets: [{ label: 'Kompresor [Hz]', data: [], borderColor: '#8b5cf6', backgroundColor: 'rgba(139,92,246,0.05)', fill: true, pointBackgroundColor: '#8b5cf6', pointBorderColor: '#fff', pointRadius: 3, pointHoverRadius: 6 }] },
        options: compressorOpts
    });
    
    // Wykres wentylatora (skala od 0)
    const fanOpts = JSON.parse(JSON.stringify(commonOpts));
    fanOpts.scales.y.beginAtZero = true;
    
    const fan = document.getElementById('chartFanRpm')?.getContext('2d');
    if (fan) charts.fan = new Chart(fan, {
        type: 'line',
        data: { labels: [], datasets: [{ label: 'Wentylator [rpm]', data: [], borderColor: '#06b6d4', backgroundColor: 'rgba(6,182,212,0.05)', fill: true, pointBackgroundColor: '#06b6d4', pointBorderColor: '#fff', pointRadius: 3, pointHoverRadius: 6 }] },
        options: fanOpts
    });
    
    // Dodaj interaktywne punkty - po kliknięciu pokazują wartość
    Object.values(charts).forEach(chart => {
        if (chart) {
            chart.canvas.addEventListener('click', (e) => {
                const points = chart.getElementsAtEvent(e);
                if (points.length) {
                    const point = points[0];
                    const dataset = chart.data.datasets[point.datasetIndex];
                    const label = chart.data.labels[point.index];
                    const value = dataset.data[point.index];
                    showSaveMessage(`${dataset.label}: ${value} (${label})`);
                }
            });
        }
    });
}

function updateChart(chart, value, idx) {
    if (!chart) return;
    const now = new Date();
    const label = now.toLocaleTimeString('pl-PL', {hour:'2-digit', minute:'2-digit', second:'2-digit'});
    const num = parseFloat(value);
    if (isNaN(num)) return;
    const last = chart.data.labels[chart.data.labels.length-1];
    if (last !== label) {
        chart.data.labels.push(label);
        chart.data.datasets.forEach((ds, i) => {
            if (idx === null || i === idx) ds.data.push(num);
            else ds.data.push(ds.data[ds.data.length-1] || 0);
        });
    } else if (idx !== null && chart.data.datasets[idx]) {
        const pos = chart.data.datasets[idx].data.length - 1;
        if (pos >= 0) chart.data.datasets[idx].data[pos] = num;
    }
    while (chart.data.labels.length > maxChartPoints) {
        chart.data.labels.shift();
        chart.data.datasets.forEach(ds => ds.data.shift());
    }
    chart.update('none');
}

function initEventListeners() {
    document.getElementById('btnConnect')?.addEventListener('click', connectMQTT);
    document.getElementById('btnDisconnect')?.addEventListener('click', disconnectMQTT);
    document.getElementById('btnConnect')?.addEventListener('dblclick', resetMQTTSettings);
    document.getElementById('resetSettings')?.addEventListener('click', resetMQTTSettings);
    document.getElementById('mqttTogglePw')?.addEventListener('click', () => { const p = document.getElementById('mqttPass'); if(p) p.type = p.type === 'password' ? 'text' : 'password'; });
    document.getElementById('clearMessages')?.addEventListener('click', clearMessages);
    document.getElementById('pauseMessages')?.addEventListener('click', togglePauseMessages);
    document.getElementById('refreshBtn')?.addEventListener('click', refreshData);
    document.getElementById('clearCharts')?.addEventListener('click', clearCharts);
    document.getElementById('loadHistory')?.addEventListener('click', loadHistoryData);
    document.getElementById('clearHistory')?.addEventListener('click', clearHistory);
    document.getElementById('exportHistory')?.addEventListener('click', exportHistoryToCSV);
    document.getElementById('exportCharts')?.addEventListener('click', exportChartsData);
    document.getElementById('applyRangeBtn')?.addEventListener('click', () => { const s = document.getElementById('rangeSelect'); if(s) updateMaxChartPoints(parseInt(s.value)); });
    document.getElementById('saveAppearance')?.addEventListener('click', saveAppearanceSettings);
    document.getElementById('themeSelect')?.addEventListener('change', () => { const s = { theme: document.getElementById('themeSelect').value, tileLayout: document.getElementById('tileLayout')?.value || 'grid' }; applyAppearanceSettings(s); localStorage.setItem('appearanceSettings', JSON.stringify(s)); showSaveMessage('Motyw zmieniony!'); });
    document.getElementById('tileLayout')?.addEventListener('change', () => { const s = { theme: document.getElementById('themeSelect')?.value || 'dark', tileLayout: document.getElementById('tileLayout').value }; applyAppearanceSettings(s); localStorage.setItem('appearanceSettings', JSON.stringify(s)); showSaveMessage('Układ zmieniony!'); });
    document.getElementById('autoRefresh')?.addEventListener('change', () => setupAutoRefresh(parseInt(document.getElementById('autoRefresh').value)));
    document.getElementById('temperatureUnit')?.addEventListener('change', () => localStorage.setItem('temperatureUnit', document.getElementById('temperatureUnit').value));
    document.getElementById('timeFormat')?.addEventListener('change', () => { localStorage.setItem('timeFormat', document.getElementById('timeFormat').value); initClock(); });
    document.querySelectorAll('.settings-nav-item').forEach(item => item.addEventListener('click', () => showSettingsTab(item.dataset.tab)));
}

function updateMaxChartPoints(sec) {
    if (sec <= 300) maxChartPoints = 30;
    else if (sec <= 1800) maxChartPoints = 60;
    else if (sec <= 3600) maxChartPoints = 60;
    else if (sec <= 21600) maxChartPoints = 72;
    else if (sec <= 43200) maxChartPoints = 72;
    else maxChartPoints = 96;
}

function initAppearanceSettings() { loadAppearanceSettings(); }
function saveAppearanceSettings() { const s = { theme: document.getElementById('themeSelect').value, tileLayout: document.getElementById('tileLayout').value }; localStorage.setItem('appearanceSettings', JSON.stringify(s)); applyAppearanceSettings(s); showSaveMessage('Ustawienia zapisane!'); }
function applyAppearanceSettings(s) {
    if (s.theme === 'light') document.body.classList.add('light-theme');
    else if (s.theme === 'dark') document.body.classList.remove('light-theme');
    else if (window.matchMedia('(prefers-color-scheme: light)').matches) document.body.classList.add('light-theme');
    else document.body.classList.remove('light-theme');
    const odu = document.querySelector('.odu-grid'), idu = document.querySelector('.idu-grid');
    if (odu && idu) { const col = s.tileLayout === 'list' ? '1fr' : 'repeat(auto-fit, minmax(220px, 1fr))'; odu.style.gridTemplateColumns = col; idu.style.gridTemplateColumns = col; }
}
function showSaveMessage(msg, err = false) { const d = document.createElement('div'); d.className = `save-message ${err ? 'error' : 'success'}`; d.textContent = msg; document.body.appendChild(d); setTimeout(() => d.remove(), 3000); }
function loadAppearanceSettings() {
    try { const s = JSON.parse(localStorage.getItem('appearanceSettings')); if(s) { if(document.getElementById('themeSelect')) document.getElementById('themeSelect').value = s.theme; if(document.getElementById('tileLayout')) document.getElementById('tileLayout').value = s.tileLayout; applyAppearanceSettings(s); } } catch(e) {}
    const tu = localStorage.getItem('temperatureUnit'); if(tu && document.getElementById('temperatureUnit')) document.getElementById('temperatureUnit').value = tu;
    const tf = localStorage.getItem('timeFormat'); if(tf && document.getElementById('timeFormat')) document.getElementById('timeFormat').value = tf;
    const ar = localStorage.getItem('autoRefresh'); if(ar && document.getElementById('autoRefresh')) { document.getElementById('autoRefresh').value = ar; setupAutoRefresh(parseInt(ar)); }
}
function exportChartsData() {
    const data = { timestamp: new Date().toISOString(), indoor: getChartData(charts.indoor), outdoor: getChartData(charts.outdoor), current: getChartData(charts.current), compressor: getChartData(charts.compressor), fan: getChartData(charts.fan), history: historyData.slice(0,100) };
    const a = document.createElement('a'); a.href = 'data:application/json,' + encodeURIComponent(JSON.stringify(data,null,2)); a.download = `rac_export_${new Date().toISOString().slice(0,19)}.json`; a.click(); showSaveMessage('Eksport zakończony!');
}
function getChartData(c) { return c ? { labels: c.data.labels, datasets: c.data.datasets.map(ds => ({ label: ds.label, data: ds.data })) } : { labels: [], datasets: [] }; }
function loadSavedSettings() {
    try { const s = JSON.parse(localStorage.getItem('mqttSettings')); if(s) { if(document.getElementById('broker')) document.getElementById('broker').value = s.broker || ''; if(document.getElementById('mqttUser')) document.getElementById('mqttUser').value = s.user || ''; if(document.getElementById('mqttPass')) document.getElementById('mqttPass').value = s.pass || ''; if(document.getElementById('clientId')) document.getElementById('clientId').value = s.clientId || `RAC_Dashboard_${Date.now()}`; if(document.getElementById('keepAlive')) document.getElementById('keepAlive').value = s.keepAlive || '60'; if(document.getElementById('port')) document.getElementById('port').value = s.port || '8884'; if(document.getElementById('protocol')) document.getElementById('protocol').value = s.protocol || 'wss'; if(document.getElementById('useTLS')) document.getElementById('useTLS').checked = s.useTLS !== false; if(document.getElementById('autoConnect')?.checked && s.broker) setTimeout(() => connectMQTT(), 2000); } } catch(e) {}
    loadAppearanceSettings();
}
function saveSettings() {
    const s = { broker: document.getElementById('broker')?.value || '', user: document.getElementById('mqttUser')?.value || '', pass: document.getElementById('mqttPass')?.value || '', clientId: document.getElementById('clientId')?.value || 'RAC_Dashboard', keepAlive: document.getElementById('keepAlive')?.value || '60', port: document.getElementById('port')?.value || '8884', protocol: document.getElementById('protocol')?.value || 'wss', useTLS: document.getElementById('useTLS')?.checked || false };
    localStorage.setItem('mqttSettings', JSON.stringify(s));
}
function resetMQTTSettings() {
    if(confirm('Resetować ustawienia MQTT?')) { localStorage.removeItem('mqttSettings'); if(document.getElementById('broker')) document.getElementById('broker').value = 'wss://772ebcf7129c4692affb3fc74ac5737f.s1.eu.hivemq.cloud:8884/mqtt'; if(document.getElementById('mqttUser')) document.getElementById('mqttUser').value = ''; if(document.getElementById('mqttPass')) document.getElementById('mqttPass').value = ''; if(document.getElementById('clientId')) document.getElementById('clientId').value = 'RAC_Dashboard'; if(document.getElementById('keepAlive')) document.getElementById('keepAlive').value = '60'; if(document.getElementById('port')) document.getElementById('port').value = '8884'; if(document.getElementById('protocol')) document.getElementById('protocol').value = 'wss'; if(document.getElementById('useTLS')) document.getElementById('useTLS').checked = true; showSaveMessage('Ustawienia zresetowane!'); }
}
function connectMQTT() {
    const brokerInp = document.getElementById('broker'), userInp = document.getElementById('mqttUser'), passInp = document.getElementById('mqttPass'), clientIdInp = document.getElementById('clientId'), keepAliveInp = document.getElementById('keepAlive'), portSel = document.getElementById('port'), protocolSel = document.getElementById('protocol'), tlsChk = document.getElementById('useTLS');
    if(!brokerInp || !userInp || !passInp) return;
    let broker = brokerInp.value.trim();
    const user = userInp.value.trim(), pass = passInp.value.trim(), clientId = clientIdInp?.value.trim() || `RAC_Dashboard_${Date.now()}`, keepAlive = parseInt(keepAliveInp?.value) || 60, port = portSel?.value || '8884', protocol = protocolSel?.value || 'wss';
    if(!broker.startsWith('ws://') && !broker.startsWith('wss://') && !broker.startsWith('mqtt://') && !broker.startsWith('mqtts://')) { broker = broker.split(':')[0]; broker = `${protocol}://${broker}:${port}${(protocol === 'wss' || protocol === 'mqtts') ? '/mqtt' : ''}`; brokerInp.value = broker; }
    if(!broker) return alert('Wprowadź adres brokera!');
    if(mqttClient && mqttClient.connected) mqttClient.end();
    updateMQTTStatus('Łączenie...', 'connecting');
    updateGlobalStatus('Łączenie...', 'connecting');
    try {
        mqttClient = mqtt.connect(broker, { username: user, password: pass, clientId, clean: true, reconnectPeriod: 5000, connectTimeout: 10000, keepalive: keepAlive, rejectUnauthorized: false });
        mqttClient.on('connect', () => { updateMQTTStatus('Połączony', 'connected'); updateGlobalStatus('Online', 'connected'); addMessage('system', 'Połączono z brokerem MQTT'); Object.values(topics).forEach(t => mqttClient.subscribe(t)); mqttClient.subscribe('rac/status/#'); setupAutoRefresh(parseInt(document.getElementById('autoRefresh')?.value) || 0); });
        mqttClient.on('message', (topic, msg) => { if(!isPaused) { const val = msg.toString(); messageCount++; updateMessageCount(); addMessage(topic, val); processMQTTMessage(topic, val); lastMqttMessageTime = Date.now(); } });
        mqttClient.on('error', (err) => { updateMQTTStatus('Błąd', 'disconnected'); updateGlobalStatus('Błąd', 'disconnected'); addMessage('error', err.message); });
        mqttClient.on('close', () => { updateMQTTStatus('Rozłączony', 'disconnected'); updateGlobalStatus('Offline', 'disconnected'); addMessage('system', 'Rozłączono z brokerem MQTT'); if(autoRefreshInterval) clearInterval(autoRefreshInterval); });
        mqttClient.on('reconnect', () => { updateMQTTStatus('Łączenie...', 'connecting'); updateGlobalStatus('Łączenie...', 'connecting'); });
        saveSettings();
    } catch(e) { updateMQTTStatus('Błąd', 'disconnected'); addMessage('error', e.message); }
}
function processMQTTMessage(topic, val) {
    const map = {
        [topics.temp_room]: { chart: 'indoor', ds: 0, tile: 'temp_room' }, [topics.temp_pipe]: { chart: 'indoor', ds: 1, tile: 'temp_pipe' }, [topics.temp_set]: { chart: 'indoor', ds: 2, tile: 'temp_set' },
        [topics.temp_module]: { chart: 'outdoor', ds: 0, tile: 'temp_module' }, [topics.temp_outside]: { chart: 'outdoor', ds: 1, tile: 'temp_outside' }, [topics.temp_exchanger]: { chart: 'outdoor', ds: 2, tile: 'temp_exchanger' }, [topics.temp_discharge]: { chart: 'outdoor', ds: 3, tile: 'temp_discharge' },
        [topics.current_a]: { chart: 'current', ds: 0, tile: 'current' }, [topics.compressor]: { chart: 'compressor', ds: 0, tile: 'compressor' }, [topics.fan_rpm]: { chart: 'fan', ds: 0, tile: 'fan_rpm' },
        [topics.mode]: { tile: 'mode' }, [topics.fan_speed]: { tile: 'fan_speed' }
    };
    const m = map[topic];
    if(!m) return;
    updateTile(m.tile, val);
    if(m.chart && charts[m.chart]) updateChart(charts[m.chart], val, m.ds);
    if(topic === topics.temp_room || topic === topics.compressor) { if(window.histTimeout) clearTimeout(window.histTimeout); window.histTimeout = setTimeout(() => { saveToHistory(); if(document.getElementById('history')?.classList.contains('active')) loadHistoryData(); }, 500); }
}
function disconnectMQTT() { if(mqttClient && mqttClient.connected) mqttClient.end(); }
function addMessage(topic, val) {
    if(isPaused) return;
    const cont = document.getElementById('mqttMessages');
    if(!cont) return;
    if(cont.querySelector('.empty-messages')) cont.innerHTML = '';
    const div = document.createElement('div');
    div.className = 'message-item';
    div.innerHTML = `<span class="message-time">${new Date().toLocaleTimeString('pl-PL')}</span><span class="message-topic">${topic}</span><span class="message-value"> = ${val}</span>`;
    cont.prepend(div);
    while(cont.children.length > maxMessages) cont.removeChild(cont.lastChild);
}
function clearMessages() { const c = document.getElementById('mqttMessages'); if(c) c.innerHTML = '<div class="empty-messages" style="text-align:center;padding:40px;color:var(--text-muted)"><i class="fas fa-comment-slash" style="font-size:2rem"></i><p>Brak wiadomości. Połącz się z brokerem.</p></div>'; messageCount = 0; updateMessageCount(); }
function togglePauseMessages() { isPaused = !isPaused; const b = document.getElementById('pauseMessages'); if(b) b.innerHTML = isPaused ? '<i class="fas fa-play"></i> Wznów' : '<i class="fas fa-pause"></i> Wstrzymaj'; addMessage('system', isPaused ? 'Monitor wstrzymany' : 'Monitor wznowiony'); }
function updateMQTTStatus(txt, st) { const s = document.getElementById('mqttStatus'); if(s) { const i = s.querySelector('.status-indicator'), t = s.querySelector('.status-text'); if(i) i.className = `status-indicator ${st}`; if(t) t.textContent = txt; } }
function updateGlobalStatus(txt, st) { const s = document.getElementById('globalStatus'); if(s) { const i = s.querySelector('.status-indicator'), t = s.querySelector('.status-text'); if(i) i.className = `status-indicator ${st}`; if(t) t.textContent = txt; } }
function updateMessageCount() { const e = document.getElementById('messageCount'); if(e) e.textContent = messageCount; }
function updateTopicCount() { const e = document.getElementById('topicCount'); if(e) e.textContent = topicSet.size; }
function refreshData() {
    if(mqttClient && mqttClient.connected) { addMessage('command', 'Odświeżanie danych'); Object.keys(lastValues).forEach(id => { const v = lastValues[id]; if(v && Date.now() - v.timestamp < 60000) updateTile(id, v.value); }); const b = document.getElementById('refreshBtn'); if(b) { b.classList.add('refreshing'); setTimeout(() => b.classList.remove('refreshing'), 500); } } else alert('Brak połączenia MQTT!');
}
function clearCharts() { if(confirm('Wyczyścić wszystkie wykresy?')) { Object.values(charts).forEach(c => { if(c) { c.data.labels = []; c.data.datasets.forEach(ds => ds.data = []); c.update(); } }); addMessage('system', 'Wykresy wyczyszczone'); } }
function setupAutoRefresh(sec) { if(autoRefreshInterval) clearInterval(autoRefreshInterval); if(sec > 0) { localStorage.setItem('autoRefresh', sec); autoRefreshInterval = setInterval(() => { if(mqttClient && mqttClient.connected) refreshData(); }, sec * 1000); } else localStorage.setItem('autoRefresh', '0'); }
function showTab(id) {
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.menu-item').forEach(b => b.classList.remove('active'));
    document.getElementById(id)?.classList.add('active');
    document.querySelectorAll('.menu-item').forEach(b => { if(b.onclick && b.onclick.toString().includes(`'${id}'`)) b.classList.add('active'); });
    const titles = { home: 'Dashboard Systemu', charts: 'Wykresy Historyczne', mqtt: 'Konfiguracja MQTT', history: 'Historia Danych', settings: 'Ustawienia Aplikacji' };
    const pt = document.getElementById('pageTitle'); if(pt && titles[id]) pt.textContent = titles[id];
    if(id === 'charts') setTimeout(() => { Object.values(charts).forEach(c => { if(c) { try { c.resize(); c.update(); } catch(e) {} } }); }, 100);
    if(id === 'history') loadHistoryData();
}
function showSettingsTab(tab) {
    document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.settings-nav-item').forEach(b => b.classList.remove('active'));
    document.getElementById(`settings${tab.charAt(0).toUpperCase() + tab.slice(1)}`)?.classList.add('active');
    document.querySelector(`.settings-nav-item[data-tab="${tab}"]`)?.classList.add('active');
}

window.showTab = showTab;
window.logout = logout;
window.showSettingsTab = showSettingsTab;
