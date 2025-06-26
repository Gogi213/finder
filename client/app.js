const btnStart      = document.getElementById('btnStart');
const btnStop       = document.getElementById('btnStop');
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
let lsHighlightValue = 3;
let deltaHighlightValue = 1000;

// WS управление
function startWS() {
  if (running) return;
  ws = new WebSocket('ws://localhost:3000');
  ws.onopen  = () => {
    running = true;
    btnStart.disabled = true;
    btnStop.disabled  = false;
  };
  ws.onmessage = e => handleMessage(JSON.parse(e.data));
  ws.onclose   = () => stopWS();
}

function stopWS() {
  if (!running) return;
  running = false;
  btnStart.disabled = false;
  btnStop.disabled  = true;
  ws && ws.close();
}

// Приём сообщений
function handleMessage(msg) {
  if (msg.type === 'summary') {
    coinMetrics[msg.symbol] = msg;
    renderCoinList();
  } else if (msg.type === 'pattern') {
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
  // Добавляем/убираем класс filtered на thead
  const thead = coinList.querySelector('thead');
  if (activeCoinFilter) {
    thead.classList.add('filtered');
  } else {
    thead.classList.remove('filtered');
  }

  const list = Object.values(coinMetrics);
  const sorted = sortBy(list, currentCoinSort);
  coinListTbody.innerHTML = '';

  sorted.forEach(m => {
    const tr = document.createElement('tr');
    if (m.symbol === activeCoinFilter) tr.classList.add('active');
    tr.onclick = () => {
      activeCoinFilter = (activeCoinFilter === m.symbol ? null : m.symbol);
      renderCoinList();
      renderPatternTable();
    };
    tr.innerHTML = `
      <td>${m.symbol.toUpperCase()}</td>
      <td class="ls-cell${(+m.lsRatio >= lsHighlightValue && isFinite(+m.lsRatio) ? ' ls-highlight' : '')}">${m.lsRatio}</td>
      <td>${m.totalVol}</td>
      <td>${m.buyCnt}</td>
      <td>${m.sellCnt}</td>
      <td>${m.avgSize}</td>
      <td>${m.natr}</td>
      <td class="delta-cell${(+m.delta >= deltaHighlightValue && isFinite(+m.delta) ? ' delta-highlight' : '')}">${m.delta}</td>
    `;
    coinListTbody.appendChild(tr);
  });
}

// Обработка паттернов
function addPattern(data) {
  // Если volume не пришёл с сервера, вычисляем его
  let volume = data.volume;
  if (typeof volume === 'undefined' && data.volumeUsd && data.price) {
    volume = (+data.volumeUsd) / (+data.price);
  }
  // Ключ дублирования по symbol и volume (монеты)
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

// Рендер таблицы паттернов
function renderPatternTable() {
  let data = activeCoinFilter
    ? patterns.filter(p => p.symbol === activeCoinFilter)
    : patterns;
  const sorted = sortBy(data, currentPatternSort);
  patternsTbody.innerHTML = '';

  sorted.forEach(({ time, symbol, price, volume, volumeUsd, lsRatio, count }) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${time}</td>
      <td class="symbol">${symbol.toUpperCase()}</td>
      <td>${price.toFixed(6)}</td>
      <td>${volume}${count > 1 ? ` (${count})` : ''}</td>
      <td>${volumeUsd}</td>
      <td class="ls-cell${(+lsRatio >= lsHighlightValue && isFinite(+lsRatio) ? ' ls-highlight' : '')}">${(+lsRatio).toFixed(2)}</td>
    `;
    patternsTbody.appendChild(tr);
  });
}

// Обработчики клика по заголовкам (они теперь независимы)
document.addEventListener('DOMContentLoaded', () => {
  // Сортировка в списке монет
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
        h.classList.remove('asc', 'desc', 'active');
        if (h.dataset.key === currentCoinSort.key) {
          h.classList.add(currentCoinSort.direction, 'active');
        }
      });
      renderCoinList();
    });
  });
  // Активируем подсветку сортировки для верхней таблицы по умолчанию
  coinList.querySelectorAll('th.sortable').forEach(h => {
    h.classList.remove('asc', 'desc', 'active');
    if (h.dataset.key === currentCoinSort.key) {
      h.classList.add(currentCoinSort.direction, 'active');
    }
  });

  // Сортировка в таблице паттернов
  document.getElementById('patternList').querySelectorAll('th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.dataset.key;
      if (currentPatternSort.key === key) {
        currentPatternSort.direction = currentPatternSort.direction === 'asc' ? 'desc' : 'asc';
      } else {
        currentPatternSort.key = key;
        currentPatternSort.direction = 'asc';
      }
      document.querySelectorAll('#patternList th.sortable').forEach(h => {
        h.classList.remove('asc', 'desc', 'active');
        if (h.dataset.key === currentPatternSort.key) {
          h.classList.add(currentPatternSort.direction, 'active');
        }
      });
      renderPatternTable();
    });
  });
  // Активируем подсветку сортировки для нижней таблицы по умолчанию
  document.querySelectorAll('#patternList th.sortable').forEach(h => {
    h.classList.remove('asc', 'desc', 'active');
    if (h.dataset.key === currentPatternSort.key) {
      h.classList.add(currentPatternSort.direction, 'active');
    }
  });

  // L/S подсветка control
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
  // Delta подсветка control
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

// Кнопки управления
btnStart.addEventListener('click', startWS);
btnStop.addEventListener('click', stopWS);
btnAllCoins.addEventListener('click', () => {
  activeCoinFilter = null;
  renderCoinList();
  renderPatternTable();
});
