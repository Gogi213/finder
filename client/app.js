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
let selectedCoins = [];

// WS управление
function startWS() {
  if (running) return;
  ws = new WebSocket('ws://localhost:3000');
  ws.onopen  = () => {
    running = true;
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
  if (activeCoinFilter) {
    thead.classList.add('filtered');
  } else {
    thead.classList.remove('filtered');
  }
  const sorted = sortBy(list, currentCoinSort);

  // Progressive update: обновляем только содержимое строк, не пересоздаём их полностью
  // Если количество строк не совпадает — пересоздаём всё
  if (coinListTbody.children.length !== sorted.length) {
    coinListTbody.innerHTML = '';
    sorted.forEach(m => {
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
  // Теперь обновляем содержимое и классы
  Array.from(coinListTbody.children).forEach((tr, i) => {
    const m = sorted[i];
    if (!m) return;
    // Классы
    if (selectedCoins.includes(m.symbol)) tr.classList.add('active');
    else tr.classList.remove('active');
    // Ячейки
    const tds = tr.children;
    tds[0].textContent = m.symbol.toUpperCase();
    tds[0].className = 'coin-symbol-cell';
    tds[0].style.cursor = 'pointer';
    tds[1].textContent = m.lsRatio;
    tds[1].className = 'ls-cell' + ((+m.lsRatio >= lsHighlightValue && isFinite(+m.lsRatio)) ? ' ls-highlight' : '');
    tds[2].textContent = m.buyCnt;
    tds[3].textContent = m.sellCnt;
    tds[4].textContent = m.natr;
    tds[5].textContent = m.delta;
    tds[5].className = 'delta-cell' + ((+m.delta >= deltaHighlightValue && isFinite(+m.delta)) ? ' delta-highlight' : '');
    // Обработчики (навешиваем только один раз)
    if (!tr._handlersSet) {
      tr.addEventListener('mousedown', (e) => {
        if (e.button === 0 || e.button === 1) {
          // Получаем символ из DOM, а не из замыкания/индекса
          const symbol = tr.querySelector('.coin-symbol-cell').textContent.trim();
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
  // Кнопка "Показать все"
  if (selectedCoins.length > 0) {
    btnAllCoins.classList.add('btn--blue');
  } else {
    btnAllCoins.classList.remove('btn--blue');
  }
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

// Вспомогательная функция для перевода времени (HH:MM:SS) из UTC в локальное время пользователя
function toLocalTime(timeStr) {
  // timeStr: 'HH:MM:SS' (UTC)
  const [h, m, s] = timeStr.split(':').map(Number);
  const now = new Date();
  // Создаём дату в UTC с сегодняшним днём
  const utcDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), h, m, s));
  return utcDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// Рендер таблицы паттернов
function renderPatternTable() {
  let data = selectedCoins.length > 0
    ? patterns.filter(p => selectedCoins.includes(p.symbol))
    : patterns;
  // ЛОГИРОВАНИЕ для отладки
  console.log('[renderPatternTable] Количество паттернов:', data.length);
  if (data.length) {
    console.log('[renderPatternTable] Символы:', data.map(p => p.symbol));
    data.forEach(p => {
      console.log(`[renderPatternTable] ${p.symbol}: time=${p.time}, price=${p.price}, volume=${p.volume}, volumeUsd=${p.volumeUsd}, lsRatio=${p.lsRatio}, count=${p.count}`);
    });
  } else {
    console.log('[renderPatternTable] Нет паттернов для отображения');
  }
  const sorted = sortBy(data, currentPatternSort);
  patternsTbody.innerHTML = '';

  // --- Новый блок: поиск сигналов ---
  // Для каждой монеты ищем пары подряд идущих сделок с L/S >= lsHighlightValue и разницей <= 30 сек
  const signalIndexes = new Set();
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (
      a.symbol === b.symbol &&
      +a.lsRatio >= lsHighlightValue &&
      +b.lsRatio >= lsHighlightValue &&
      Math.abs((+a.timeStamp - +b.timeStamp)) <= 30000
    ) {
      signalIndexes.add(i);
      signalIndexes.add(i + 1);
    }
  }

  sorted.forEach(({ time, symbol, price, volume, volumeUsd, lsRatio, count, timeStamp }, idx) => {
    const tr = document.createElement('tr');
    let signalClass = signalIndexes.has(idx) ? ' signal-row' : '';
    tr.innerHTML = `
      <td>${toLocalTime(time)}</td>
      <td class="symbol">${symbol.toUpperCase()}</td>
      <td>${price.toFixed(6)}</td>
      <td>${volume}${count > 1 ? ` (${count})` : ''}</td>
      <td>${volumeUsd}</td>
      <td class="ls-cell${(+lsRatio >= lsHighlightValue && isFinite(+lsRatio) ? ' ls-highlight' : '')}">${(+lsRatio).toFixed(2)}</td>
    `;
    if (signalClass) tr.classList.add('signal-row');
    patternsTbody.appendChild(tr);
  });
}

// Обработчики клика по заголовкам (они теперь независимы)
document.addEventListener('DOMContentLoaded', () => {
  startWS(); // Автоматически открываем сокет при загрузке страницы
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
btnAllCoins.addEventListener('click', () => {
  selectedCoins = [];
  renderCoinList();
  renderPatternTable();
});
