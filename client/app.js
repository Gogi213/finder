// public/app.js

const btnAllCoins   = document.getElementById('btnAllCoins');
const patternsTbody = document.getElementById('patterns');
const coinList      = document.getElementById('coinList');
const coinListTbody = coinList.querySelector('tbody');
const patternList   = document.getElementById('patternList');

// State
let ws = null;
let running = false;
let patterns = [];
let coinMetrics = {};      // { symbol: summary }
let tradeCounter = {};
let currentPatternSort = { key: 'time', direction: 'desc' };
let currentCoinSort    = { key: 'lsRatio', direction: 'desc' };
let activeCoinFilter = null;
let lsHighlightValue = 2.5;
let deltaHighlightValue = 10000;
let selectedCoins = [];

/**
 * Возвращает правильный URL для WebSocket:
 * - при локальном тесте (localhost/file://) — ws://localhost:3000
 * - в продакшне — к тому же хосту, откуда отдана страница (IP или домен), порт по умолчанию
 */
function getWebSocketUrl() {
  const locProtocol = window.location.protocol;          // 'http:' или 'https:' или 'file:'
  const hostname    = window.location.hostname;          // 'localhost', '66.42.39.138' и т.п.
  const port        = window.location.port;              // '3000', '' и т.п.
  const isLocal     = (
    locProtocol === 'file:' ||
    hostname === 'localhost' ||
    hostname === '127.0.0.1'
  );

  const wsProto = locProtocol === 'https:' ? 'wss' : 'ws';

  if (isLocal) {
    return `${wsProto}://localhost:3000`;
  } else {
    // если страница отдается с нестандартного порта (например, 8080), его тоже укажем
    const portSegment = port && port !== '80' && port !== '443' ? `:${port}` : '';
    return `${wsProto}://${hostname}${portSegment}`;
  }
}

// WS управление
function startWS() {
  if (running) return;
  const wsUrl = getWebSocketUrl();
  console.log('Connecting WS to', wsUrl);
  ws = new WebSocket(wsUrl);

  ws.onopen  = () => {
    running = true;
    console.log('WebSocket opened');
    // Сбрасываем состояние при переподключении для актуализации списка
    coinMetrics = {};
    patterns = [];
    tradeCounter = {};
    renderCoinList();
    renderPatternTable();
  };
  ws.onmessage = e => handleMessage(JSON.parse(e.data));
  ws.onclose   = () => stopWS();
}

function stopWS() {
  if (!running) return;
  running = false;
  ws && ws.close();
}

// Приём сообщений
function handleMessage(msg) {
  if (msg.type === 'summary') {
    coinMetrics[msg.symbol] = msg;
    renderCoinList();
  } else if (msg.type === 'pattern') {
    console.log('[DEBUG] Pattern received:', {
      symbol: msg.symbol,
      lsRatio: msg.lsRatio,
      lsRatioTrades: msg.lsRatioTrades,
      hasLsRatioTrades: msg.lsRatioTrades !== undefined
    });
    addPattern(msg);
  }
}

// Универсальная сортировка
function sortBy(arr, sort) {
  return arr.slice().sort((a, b) => {
    let A = a[sort.key], B = b[sort.key];
    if (sort.key !== 'symbol' && sort.key !== 'time') {
      A = +A; B = +B;
    }
    if (A < B) return sort.direction === 'asc' ? -1 : 1;
    if (A > B) return sort.direction === 'asc' ? 1 : -1;
    return 0;
  });
}

// Рендер списка монет
function renderCoinList() {
  const list = Object.values(coinMetrics);
  const thead = coinList.querySelector('thead');
  thead.classList.toggle('filtered', !!activeCoinFilter);

  const sorted = sortBy(list, currentCoinSort);

  if (coinListTbody.children.length !== sorted.length) {
    coinListTbody.innerHTML = '';
    sorted.forEach(() => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="coin-symbol-cell" style="cursor:pointer;"></td>
        <td class="ls-cell"></td>
        <td></td>
        <td></td>
        <td></td>
        <td class="delta-cell"></td>
      `;
      coinListTbody.appendChild(tr);
    });
  }

  Array.from(coinListTbody.children).forEach((tr, i) => {
    const m = sorted[i];
    if (!m) return;
    tr.classList.toggle('active', selectedCoins.includes(m.symbol));

    const tds = tr.children;
    tds[0].textContent = m.symbol.toUpperCase();
    tds[1].textContent = m.lsRatio;
    tds[1].className = 'ls-cell' +
      ((+m.lsRatio >= lsHighlightValue && isFinite(+m.lsRatio)) ? ' ls-highlight' : '');
    tds[2].textContent = m.buyCnt;
    tds[3].textContent = m.sellCnt;
    tds[4].textContent = m.natr;
    tds[5].textContent = m.delta;
    tds[5].className = 'delta-cell' +
      ((+m.delta >= deltaHighlightValue && isFinite(+m.delta)) ? ' delta-highlight' : '');

    if (!tr._handlersSet) {
      // Средняя кнопка мыши — показать график
      tr.addEventListener('mousedown', (e) => {
        const symbol = tr.querySelector('.coin-symbol-cell').textContent.trim();
        if (e.button === 1) { // средняя кнопка
          console.log('Middle button clicked, checking showChartPopup...');
          console.log('typeof window.showChartPopup:', typeof window.showChartPopup);
          if (typeof window.showChartPopup === 'function') {
            console.log('Calling showChartPopup');
            window.showChartPopup(symbol);
          } else {
            console.log('showChartPopup not found!');
            alert('showChartPopup не определён!');
          }
          e.preventDefault();
          e.stopPropagation();
        } else if (e.button === 0) { // левая — выделение
          if (selectedCoins.includes(symbol)) {
            selectedCoins = selectedCoins.filter(s => s !== symbol);
          } else {
            selectedCoins.push(symbol);
          }
          renderCoinList();
          renderPatternTable();
          e.preventDefault();
          e.stopPropagation();
        }
      });
      tds[0].addEventListener('contextmenu', (e) => {
        e.preventDefault();
        navigator.clipboard.writeText(m.symbol.toUpperCase())
          .then(() => {
            tds[0].style.background = 'rgba(76,175,80,0.25)';
            setTimeout(() => tds[0].style.background = '', 350);
          });
      });
      tr._handlersSet = true;
    }
  });

  btnAllCoins.classList.toggle('btn--blue', selectedCoins.length > 0);
  btnAllCoins.classList.toggle('btn--inactive', selectedCoins.length === 0);
  
  // Обновляем стили для активного графика (если функция доступна)
  if (typeof window.updateCoinRowStyles === 'function') {
    window.updateCoinRowStyles();
  }
}

// Обработка паттернов
function addPattern(data) {
  let volume = data.volume;
  if (typeof volume === 'undefined' && data.volumeUsd && data.price) {
    volume = (+data.volumeUsd) / (+data.price);
  }
  const key = `${data.symbol}-${volume}`;
  const now = data.timeStamp || Date.now();
  let count = 1;
  if (tradeCounter[key] && now - tradeCounter[key].lastTime <= 180000) {
    count = tradeCounter[key].count + 1;
  }
  tradeCounter[key] = { count, lastTime: now };

  if (count > 1) {
    patterns.unshift({ ...data, count, volume, volumeSum: volume * count });
    if (patterns.length > 500) patterns.pop();
    renderPatternTable();
  }
}

// Перевод UTC‑времени в локальное
function toLocalTime(timeStr) {
  const [h, m, s] = timeStr.split(':').map(Number);
  const now = new Date();
  const utcDate = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    h, m, s
  ));
  return utcDate.toLocaleTimeString([], {
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
}

// Рендер таблицы паттернов
function renderPatternTable() {
  let data = selectedCoins.length > 0
    ? patterns.filter(p => selectedCoins.includes(p.symbol))
    : patterns;

  console.log('[renderPatternTable] Количество паттернов:', data.length);
  if (data.length === 0) {
    console.log('[renderPatternTable] Нет паттернов для отображения');
  }

  const sorted = sortBy(data, currentPatternSort);
  patternsTbody.innerHTML = '';

  // Поиск сигналов
  const signalIndexes = new Set();
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i], b = sorted[i+1];
    if (
      a.symbol === b.symbol &&
      ((+a.lsRatio >= lsHighlightValue && +b.lsRatio >= lsHighlightValue) ||
       (+a.lsRatioTrades >= lsHighlightValue && +b.lsRatioTrades >= lsHighlightValue)) &&
      Math.abs(a.timeStamp - b.timeStamp) <= 30000
    ) {
      signalIndexes.add(i).add(i+1);
    }
  }

  sorted.forEach((p, idx) => {
    const tr = document.createElement('tr');
    if (signalIndexes.has(idx)) tr.classList.add('signal-row');
    
    // Проверяем наличие lsRatioTrades
    const lsRatioTrades = p.lsRatioTrades;
    const lsRatioTradesDisplay = (lsRatioTrades !== undefined && isFinite(+lsRatioTrades)) 
      ? (+lsRatioTrades).toFixed(2) 
      : '—';
    
    tr.innerHTML = `
      <td>${toLocalTime(p.time)}</td>
      <td class="symbol">${p.symbol.toUpperCase()}</td>
      <td>${p.price.toFixed(6)}</td>
      <td>${p.volume}${p.count > 1 ? ` (${p.count})` : ''}</td>
      <td>${p.volumeUsd}</td>
      <td class="ls-cell${(lsRatioTrades !== undefined && +lsRatioTrades >= lsHighlightValue && isFinite(+lsRatioTrades) ? ' ls-highlight' : '')}">
        ${lsRatioTradesDisplay}
      </td>
      <td class="ls-cell${(+p.lsRatio >= lsHighlightValue && isFinite(+p.lsRatio) ? ' ls-highlight' : '')}">
        ${(+p.lsRatio).toFixed(2)}
      </td>
    `;
    patternsTbody.appendChild(tr);
  });
  // Прокрутка на одну строку вниз (если есть хотя бы одна строка)
  const firstRow = patternsTbody.querySelector('tr');
  if (firstRow) {
    patternsTbody.scrollTop = firstRow.offsetHeight;
  }
}

// Инициализация страницы
document.addEventListener('DOMContentLoaded', () => {
  startWS();

  // Сортировка списка монет
  coinList.querySelectorAll('th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.dataset.key;
      if (currentCoinSort.key === key) {
        currentCoinSort.direction = currentCoinSort.direction === 'asc' ? 'desc' : 'asc';
      } else {
        currentCoinSort.key = key;
        currentCoinSort.direction = 'asc';
      }
      coinList.querySelectorAll('th.sortable').forEach(h => {
        h.classList.remove('asc','desc','active');
        if (h.dataset.key === currentCoinSort.key) {
          h.classList.add(currentCoinSort.direction,'active');
        }
      });
      renderCoinList();
    });
  });
  // Устанавливаем начальную подсветку
  coinList.querySelectorAll('th.sortable').forEach(h => {
    h.classList.remove('asc','desc','active');
    if (h.dataset.key === currentCoinSort.key) {
      h.classList.add(currentCoinSort.direction,'active');
    }
  });

  // Сортировка паттернов
  document.querySelectorAll('#patternList th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.dataset.key;
      if (currentPatternSort.key === key) {
        currentPatternSort.direction = currentPatternSort.direction === 'asc' ? 'desc' : 'asc';
      } else {
        currentPatternSort.key = key;
        currentPatternSort.direction = 'asc';
      }
      document.querySelectorAll('#patternList th.sortable').forEach(h => {
        h.classList.remove('asc','desc','active');
        if (h.dataset.key === currentPatternSort.key) {
          h.classList.add(currentPatternSort.direction,'active');
        }
      });
      renderPatternTable();
    });
  });
  // Начальная подсветка
  document.querySelectorAll('#patternList th.sortable').forEach(h => {
    h.classList.remove('asc','desc','active');
    if (h.dataset.key === currentPatternSort.key) {
      h.classList.add(currentPatternSort.direction,'active');
    }
  });

  // Контролы подсветки
  const lsInput = document.getElementById('lsHighlightValue');
  if (lsInput) {
    lsInput.value = lsHighlightValue;
    lsInput.addEventListener('input', e => {
      let v = parseFloat(e.target.value);
      if (isNaN(v) || v < 1) v = 1;
      if (v > 99) v = 99;
      lsHighlightValue = v;
      renderCoinList();
      renderPatternTable();
    });
  }
  const deltaInput = document.getElementById('deltaHighlightValue');
  if (deltaInput) {
    deltaInput.value = deltaHighlightValue;
    deltaInput.addEventListener('input', e => {
      let v = parseFloat(e.target.value);
      if (isNaN(v)) v = 0;
      deltaHighlightValue = v;
      renderCoinList();
    });
  }
});

// Кнопка «Показать все»
btnAllCoins.addEventListener('click', () => {
  selectedCoins = [];
  renderCoinList();
  renderPatternTable();
});

// --- Выделение строки монеты с открытым графиком Plotly (устойчивое) ---
window.activePlotlySymbol = null;
window.updateCoinRowStyles = function(symbol) {
  if (typeof symbol === 'undefined') symbol = window.activePlotlySymbol;
  document.querySelectorAll('tr.active-plotly-row').forEach(tr => {
    tr.classList.remove('active-plotly-row');
  });
  if (symbol) {
    document.querySelectorAll('#coinList tbody tr').forEach(tr => {
      const cell = tr.querySelector('.coin-symbol-cell');
      if (cell && cell.textContent.trim() === symbol) {
        tr.classList.add('active-plotly-row');
      }
    });
    window.activePlotlySymbol = symbol;
  } else {
    window.activePlotlySymbol = null;
  }
};

// Получение реальных свечей с Binance и отображение в Plotly popup
window.showChartPopup = async function(symbol) {
  window.activeEChartSymbol = symbol;
  try {
    // Получаем 1200 последних минутных свечей (история)
    const resp = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}USDT&interval=1m&limit=1200`);
    const data = await resp.json();
    const candles = data.map(c => ({
      time: Math.floor(c[0] / 1000),
      open: +c[1],
      high: +c[2],
      low: +c[3],
      close: +c[4]
    }));
    // Передаём всю историю свечей
    setTimeout(() => {
      if (typeof window.showEChartPopup === 'function') {
        window.showEChartPopup(symbol, candles);
        window.updateCoinRowStyles(symbol);
      } else {
        alert('showEChartPopup не найден!');
      }
    }, 100);
  } catch (e) {
    alert('Ошибка загрузки свечей: ' + e);
  }
};
