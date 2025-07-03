const express = require('express');
const axios = require('axios');
const WebSocket = require('ws');
const path = require('path');
const CONFIG = require('./config');

const app = express();
const server = require('http').createServer(app);
const wss = new WebSocket.Server({ server });

// Хранилище сделок и метаданных
const tradeVolumeStore = {};    // { symbol: { buys: [], sells: [] } }
const symbolMeta = {};          // { symbol: { natr: Number } }
let wsClient = null;
let reconnectAttempts = 0;
let summaryIntervalID = null;
let wsSymbols = [];
let wsReconnectIntervalID = null;
let lastApiCall = 0;            // Rate limiting для API вызовов
let apiCallCount = 0;           // Счетчик API вызовов

// Статика
app.use(express.static(path.join(__dirname, 'public')));
app.use('/client', express.static(path.join(__dirname, 'client')));

// Утилиты для обработки ошибок и повторных попыток
async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function apiCallWithRetry(apiFunction, retries = CONFIG.API_RETRY_ATTEMPTS) {
  // Rate limiting
  const now = Date.now();
  if (now - lastApiCall < CONFIG.API_RATE_LIMIT_DELAY) {
    await sleep(CONFIG.API_RATE_LIMIT_DELAY - (now - lastApiCall));
  }
  lastApiCall = Date.now();
  apiCallCount++;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`[API Call #${apiCallCount}] Attempt ${attempt}/${retries}`);
      const result = await apiFunction();
      console.log(`[API Call #${apiCallCount}] Success on attempt ${attempt}`);
      return result;
    } catch (error) {
      console.log(`[API Call #${apiCallCount}] Failed attempt ${attempt}/${retries}:`, error.message);
      
      if (attempt === retries) {
        console.error(`[API Call #${apiCallCount}] All ${retries} attempts failed`);
        throw error;
      }
      
      // Exponential backoff
      const delay = CONFIG.API_RETRY_DELAY * Math.pow(2, attempt - 1);
      console.log(`[API Call #${apiCallCount}] Waiting ${delay}ms before retry...`);
      await sleep(delay);
    }
  }
}

// Mock data для тестирования когда API недоступно
const mockTickers = [
  { symbol: 'BTCUSDT', lastPrice: '45000', quoteVolume: '500000', priceChangePercent: '2.5' },
  { symbol: 'ETHUSDT', lastPrice: '3000', quoteVolume: '300000', priceChangePercent: '1.8' },
  { symbol: 'ADAUSDT', lastPrice: '0.5', quoteVolume: '200000', priceChangePercent: '-1.2' },
];

const mockKlines = [
  [1640000000000, '44900', '45100', '44800', '45000', '100', 1640000059999, '4500000', 1000, '50', '2250000', '0'],
  [1640000060000, '45000', '45200', '44900', '45100', '110', 1640000119999, '4955000', 1100, '55', '2477500', '0'],
  // ... добавляем еще 29 записей для полного расчета NATR
];

// Заполняем массив до 31 элемента
for (let i = mockKlines.length; i < 31; i++) {
  const prev = mockKlines[i - 1] || mockKlines[0];
  mockKlines.push([
    parseInt(prev[0]) + 60000,
    prev[4], // open = prev close
    (parseFloat(prev[4]) * (1 + (Math.random() - 0.5) * 0.02)).toFixed(2), // high
    (parseFloat(prev[4]) * (1 - Math.random() * 0.02)).toFixed(2), // low
    (parseFloat(prev[4]) * (1 + (Math.random() - 0.5) * 0.01)).toFixed(2), // close
    '100',
    parseInt(prev[0]) + 60000 - 1,
    '4500000',
    1000,
    '50',
    '2250000',
    '0'
  ]);
}

// Генератор mock торговых данных для тестирования
let mockTradeGenerator = null;

function startMockTradeGenerator() {
  if (mockTradeGenerator) return;
  
  console.log('[Mock] Starting mock trade generator...');
  mockTradeGenerator = setInterval(() => {
    const symbols = Object.keys(symbolMeta);
    if (symbols.length === 0) return;
    
    const symbol = symbols[Math.floor(Math.random() * symbols.length)];
    const basePrice = symbol === 'BTCUSDT' ? 45000 : 
                     symbol === 'ETHUSDT' ? 3000 : 0.5;
    
    const price = basePrice * (1 + (Math.random() - 0.5) * 0.001); // 0.1% вариация
    const qty = Math.random() * 1000 + 100; // от 100 до 1100
    const volumeUsd = price * qty;
    
    if (volumeUsd < CONFIG.MIN_VOLUME_USD) return;
    
    if (!tradeVolumeStore[symbol]) {
      tradeVolumeStore[symbol] = { buys: [], sells: [] };
    }
    
    const isMaker = Math.random() > 0.5;
    const sideList = isMaker ? 'sells' : 'buys';
    const ts = Date.now();
    
    tradeVolumeStore[symbol][sideList].push({ timestamp: ts, volumeUsd });
    
    const lsRatio = calculateLSRatio(symbol);
    const pattern = {
      type: 'pattern',
      symbol,
      time: new Date(ts).toISOString().slice(11,19),
      timeStamp: ts,
      price: price.toFixed(8),
      volumeUsd: volumeUsd.toFixed(2),
      volume: qty.toFixed(6),
      lsRatio
    };
    
    wss.clients.forEach(c => c.readyState === WebSocket.OPEN && c.send(JSON.stringify(pattern)));
  }, 1000 + Math.random() * 2000); // каждые 1-3 секунды
  
  console.log('[Mock] Mock trade generator started');
}

function stopMockTradeGenerator() {
  if (mockTradeGenerator) {
    clearInterval(mockTradeGenerator);
    mockTradeGenerator = null;
    console.log('[Mock] Mock trade generator stopped');
  }
}

// Подключаем WebSocket к Binance
async function connectBinanceWS() {
  if (wsClient && wsClient.readyState === WebSocket.OPEN) return;

  let symbols = await getFilteredSymbols();
  if (symbols.length === 0) {
    console.log('No symbols passing filter');
    return;
  }

  // Периодически обновляем пул валютных пар
  setInterval(async () => {
    try {
      const newSymbols = await getFilteredSymbols();
      // Добавляем только новые пары
      newSymbols.forEach(sym => {
        if (!symbols.includes(sym)) {
          symbols.push(sym);
          // Инициализация хранилища для новых пар
          if (!tradeVolumeStore[sym]) {
            tradeVolumeStore[sym] = { buys: [], sells: [] };
          }
          if (!symbolMeta[sym]) {
            symbolMeta[sym] = { natr: 0 };
          }
        }
      });
      // Можно добавить лог: console.log('Пул валютных пар обновлён');
    } catch (e) {
      console.error('Ошибка обновления пула валютных пар', e);
    }
  }, 5 * 60 * 1000); // 5 минут

  const stream = symbols.map(s => `${s}@trade`).join('/');
  wsClient = new WebSocket(`wss://stream.binance.com:9443/stream?streams=${stream}`);

  wsClient.on('open', () => {
    console.log('Connected to Binance WS', new Date().toISOString());
    reconnectAttempts = 0;
    // Только ручной вызов для мгновенного обновления
    broadcastSummaries();
  });

  wsClient.on('message', data => {
    try {
      const msg = JSON.parse(data);
      if (!msg.data) return;
      const { s: symbol, T: ts, q: qtyRaw, m: isMaker, p: priceRaw } = msg.data;
      const price = parseFloat(priceRaw);
      const qty = parseFloat(qtyRaw);
      if (!price || !qty) return;

      const volumeUsd = price * qty;
      if (volumeUsd < CONFIG.MIN_VOLUME_USD) return;

      // Инициализация хранилища
      if (!tradeVolumeStore[symbol]) {
        tradeVolumeStore[symbol] = { buys: [], sells: [] };
      }
      const sideList = isMaker ? 'sells' : 'buys';
      tradeVolumeStore[symbol][sideList].push({ timestamp: ts, volumeUsd });

      // Рассылаем паттерн
      const lsRatio = calculateLSRatio(symbol);
      const pattern = {
        type: 'pattern',
        symbol,
        time: new Date(ts).toISOString().slice(11,19),
        timeStamp: ts,
        price,
        volumeUsd: volumeUsd.toFixed(2),
        volume: qty, // Новый столбец: объём в монетах
        lsRatio
      };
      wss.clients.forEach(c => c.readyState === WebSocket.OPEN && c.send(JSON.stringify(pattern)));
    } catch (e) {
      console.error('WS data error', e);
    }
  });

  wsClient.on('close', () => {
    if (reconnectAttempts < CONFIG.RECONNECT_ATTEMPTS) {
      setTimeout(connectBinanceWS, 5000);
      reconnectAttempts++;
    }
  });
}

async function recreateBinanceWS() {
  try {
    console.log('[recreateBinanceWS] Starting WebSocket recreation...');
    const newSymbols = await getFilteredSymbols();
    
    // Если пул не изменился — ничего не делаем
    if (JSON.stringify(newSymbols) === JSON.stringify(wsSymbols)) {
      console.log('[recreateBinanceWS] Symbol pool unchanged, skipping reconnection');
      return;
    }
    
    if (newSymbols.length === 0) {
      console.log('[recreateBinanceWS] No symbols available, skipping WebSocket creation');
      return;
    }

    console.log(`[recreateBinanceWS] Creating WebSocket for ${newSymbols.length} symbols`);
    const newStream = newSymbols.map(s => `${s}@trade`).join('/');
    const wsUrl = `wss://stream.binance.com:9443/stream?streams=${newStream}`;
    
    const newWS = new WebSocket(wsUrl);

    newWS.on('open', () => {
      console.log(`[recreateBinanceWS] Connected to Binance WS with ${newSymbols.length} symbols at`, new Date().toISOString());
      wsSymbols = newSymbols;
      stopMockTradeGenerator(); // Останавливаем mock генератор при успешном подключении
      // Только ручной вызов для мгновенного обновления
      broadcastSummaries();
      // Закрываем старый wsClient
      if (wsClient && wsClient.readyState === WebSocket.OPEN) {
        console.log('[recreateBinanceWS] Closing old WebSocket connection');
        wsClient.close();
      }
      wsClient = newWS;
      reconnectAttempts = 0;
    });

    newWS.on('message', data => {
      try {
        const msg = JSON.parse(data);
        if (!msg.data) return;
        const { s: symbol, T: ts, q: qtyRaw, m: isMaker, p: priceRaw } = msg.data;
        const price = parseFloat(priceRaw);
        const qty = parseFloat(qtyRaw);
        if (!price || !qty) return;
        const volumeUsd = price * qty;
        if (volumeUsd < CONFIG.MIN_VOLUME_USD) return;
        if (!tradeVolumeStore[symbol]) {
          tradeVolumeStore[symbol] = { buys: [], sells: [] };
        }
        const sideList = isMaker ? 'sells' : 'buys';
        tradeVolumeStore[symbol][sideList].push({ timestamp: ts, volumeUsd });
        const lsRatio = calculateLSRatio(symbol);
        const pattern = {
          type: 'pattern',
          symbol,
          time: new Date(ts).toISOString().slice(11,19),
          timeStamp: ts,
          price,
          volumeUsd: volumeUsd.toFixed(2),
          volume: qty,
          lsRatio
        };
        wss.clients.forEach(c => c.readyState === WebSocket.OPEN && c.send(JSON.stringify(pattern)));
      } catch (e) {
        console.error('[recreateBinanceWS] WS data processing error:', e.message);
      }
    });

    newWS.on('error', (error) => {
      console.error('[recreateBinanceWS] WebSocket error:', error.message);
    });

    newWS.on('close', (code, reason) => {
      console.log(`[recreateBinanceWS] WebSocket closed with code ${code}, reason: ${reason}`);
      if (reconnectAttempts < CONFIG.RECONNECT_ATTEMPTS) {
        reconnectAttempts++;
        const delay = CONFIG.API_RETRY_DELAY * Math.pow(2, reconnectAttempts - 1);
        console.log(`[recreateBinanceWS] Reconnecting in ${delay}ms (attempt ${reconnectAttempts}/${CONFIG.RECONNECT_ATTEMPTS})`);
        setTimeout(recreateBinanceWS, delay);
      } else {
        console.error('[recreateBinanceWS] Max reconnection attempts reached, starting mock trade generator');
        wsSymbols = newSymbols; // Сохраняем символы для mock генератора
        startMockTradeGenerator();
      }
    });
  } catch (error) {
    console.error('[recreateBinanceWS] Failed to recreate WebSocket:', error.message);
    if (reconnectAttempts < CONFIG.RECONNECT_ATTEMPTS) {
      reconnectAttempts++;
      const delay = CONFIG.API_RETRY_DELAY * Math.pow(2, reconnectAttempts - 1);
      console.log(`[recreateBinanceWS] Retrying in ${delay}ms (attempt ${reconnectAttempts}/${CONFIG.RECONNECT_ATTEMPTS})`);
      setTimeout(recreateBinanceWS, delay);
    } else {
      console.error('[recreateBinanceWS] All attempts failed, starting mock trade generator');
      // Если у нас есть символы из getFilteredSymbols, используем их для mock
      const mockSymbols = Object.keys(symbolMeta);
      if (mockSymbols.length > 0) {
        wsSymbols = mockSymbols;
        startMockTradeGenerator();
      }
    }
  }
}

// Рассылка метрик для «Списка монет»
function broadcastSummaries() {
  const now = Date.now();
  const nowStr = new Date(now).toISOString();
  console.log(`[broadcastSummaries] call at ${nowStr}`);
  const symbols = Object.keys(tradeVolumeStore);
  console.log('[broadcastSummaries] symbols count:', symbols.length);
  if (symbols.length) {
    console.log('[broadcastSummaries] symbols:', symbols);
  }
  for (const symbol of symbols) {
    cleanupOldData(symbol);
    const data = tradeVolumeStore[symbol];
    if (!data) continue;  // пропускаем, если после очистки удалили
    const buyVol   = data.buys.reduce((sum, t) => sum + t.volumeUsd, 0);
    const sellVol  = data.sells.reduce((sum, t) => sum + t.volumeUsd, 0);
    const buyCnt   = data.buys.length;
    const sellCnt  = data.sells.length;
    const totalVol = buyVol + sellVol;
    const avgSize  = totalVol > 0 ? (totalVol / (buyCnt + sellCnt)) : 0;
    // L/S: если sellCnt > 0, то buyCnt/sellCnt, иначе buyCnt
    const lsRatio  = sellCnt > 0 ? buyCnt / sellCnt : buyCnt;
    const delta    = buyVol - sellVol;
    const natr     = symbolMeta[symbol]?.natr || 0;

    const summary = {
      type: 'summary',
      symbol,
      lsRatio:  lsRatio.toFixed(2),
      totalVol: totalVol.toFixed(2),
      buyCnt,
      sellCnt,
      avgSize:  avgSize.toFixed(2),
      natr:     natr.toFixed(2),
      delta:    delta.toFixed(2)
    };
    // Лог по каждой summary
    console.log(`[broadcastSummaries] ${symbol}: buyCnt=${buyCnt}, sellCnt=${sellCnt}, totalVol=${totalVol.toFixed(2)}, delta=${delta.toFixed(2)}, natr=${natr.toFixed(2)}, lsRatio=${lsRatio.toFixed(2)}`);
    wss.clients.forEach(c => c.readyState === WebSocket.OPEN && c.send(JSON.stringify(summary)));
  }
}

// Удаляем старые трейды по таймстемпу
function cleanupOldData(symbol) {
  const now = Date.now();
  if (!tradeVolumeStore[symbol]) return;
  ['buys', 'sells'].forEach(side => {
    tradeVolumeStore[symbol][side] =
      tradeVolumeStore[symbol][side].filter(t => now - t.timestamp <= CONFIG.TIME_WINDOW);
  });
  if (tradeVolumeStore[symbol].buys.length === 0 &&
      tradeVolumeStore[symbol].sells.length === 0) {
    delete tradeVolumeStore[symbol];
    delete symbolMeta[symbol];
  }
}

function calculateLSRatio(symbol) {
  const data   = tradeVolumeStore[symbol] || { buys: [], sells: [] };
  const buyVol = data.buys.reduce((s,t) => s + t.volumeUsd, 0);
  const sellVol= data.sells.reduce((s,t) => s + t.volumeUsd, 0);
  return sellVol > 0 ? buyVol / sellVol : Infinity;
}

// Получаем и фильтруем символы + сохраняем NATR
async function getFilteredSymbols() {
  try {
    console.log('[getFilteredSymbols] Starting symbol fetch...');
    
    const tickers = await apiCallWithRetry(async () => {
      const { data } = await axios.get(
        'https://api.binance.com/api/v3/ticker/24hr',
        { timeout: CONFIG.API_TIMEOUT }
      );
      return data;
    });

    console.log(`[getFilteredSymbols] Got ${tickers.length} tickers from API`);
    
    const filtered = tickers.filter(i =>
      i.symbol.endsWith('USDT') &&
      !i.symbol.includes('1000') &&
      +i.quoteVolume >= CONFIG.MIN_VOL &&
      +i.quoteVolume <= CONFIG.MAX_VOL &&
      +i.priceChangePercent >= CONFIG.MIN_PRICE_CHANGE_24H
    );

    console.log(`[getFilteredSymbols] ${filtered.length} symbols passed initial filter`);

    const result = [];
    for (let i = 0; i < filtered.length; i += 15) {
      const batch = filtered.slice(i, i + 15);
      console.log(`[getFilteredSymbols] Processing batch ${Math.floor(i/15) + 1}/${Math.ceil(filtered.length/15)}`);
      
      const res = await Promise.all(batch.map(async tk => {
        try {
          const klines = await apiCallWithRetry(async () => {
            const { data } = await axios.get(
              'https://api.binance.com/api/v3/klines',
              { params: { symbol: tk.symbol, interval: '1m', limit: 31 }, timeout: CONFIG.API_TIMEOUT }
            );
            return data;
          });
          
          const price = +tk.lastPrice;
          const natr  = calculateNATR(price, klines);
          // Всегда обновляем NATR для всех монет
          symbolMeta[tk.symbol] = { natr };
          if (natr >= CONFIG.MIN_NATR) {
            return tk.symbol.toLowerCase();
          }
        } catch (e) {
          console.log(`[getFilteredSymbols] Failed to get klines for ${tk.symbol}: ${e.message}`);
        }
        return null;
      }));
      result.push(...res.filter(Boolean));
      
      // Добавляем небольшую задержку между батчами для снижения нагрузки на API
      if (i + 15 < filtered.length) {
        await sleep(CONFIG.API_RATE_LIMIT_DELAY);
      }
    }
    
    console.log(`[getFilteredSymbols] Final result: ${result.length} symbols`);
    return result;
  } catch (e) {
    console.error('[getFilteredSymbols] API completely failed, using mock data:', e.message);
    
    // Используем mock данные при полном отказе API
    console.log('[getFilteredSymbols] Falling back to mock data...');
    
    const result = [];
    for (const ticker of mockTickers) {
      try {
        const price = +ticker.lastPrice;
        const natr = calculateNATR(price, mockKlines);
        symbolMeta[ticker.symbol] = { natr };
        if (natr >= CONFIG.MIN_NATR) {
          result.push(ticker.symbol.toLowerCase());
        }
      } catch (e) {
        console.error(`Error processing mock ticker ${ticker.symbol}:`, e.message);
      }
    }
    
    console.log(`[getFilteredSymbols] Mock data result: ${result.length} symbols`);
    return result;
  }
}

// Считаем NATR (30-period ATR)
function calculateNATR(price, candles) {
  const period = 30;
  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    const prev  = +candles[i - 1][4];
    const high  = +candles[i][2];
    const low   = +candles[i][3];
    trs.push(Math.max(high - low, Math.abs(high - prev), Math.abs(low - prev)));
  }
  if (trs.length < period) return 0;
  let atr = trs.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = period; i < trs.length; i++) {
    atr = ((atr * (period - 1)) + trs[i]) / period;
  }
  return price > 0 ? (atr / price) * 100 : 0;
}

// Старт сервера
const PORT = 3000;
server.listen(PORT, () => {
  console.log(`Server: http://localhost:${PORT}`);
  console.log(`[Server] Starting with configuration:`, {
    API_RETRY_ATTEMPTS: CONFIG.API_RETRY_ATTEMPTS,
    API_RETRY_DELAY: CONFIG.API_RETRY_DELAY,
    API_TIMEOUT: CONFIG.API_TIMEOUT,
    SUMMARY_INTERVAL: CONFIG.SUMMARY_INTERVAL
  });
  
  // Инициализация WebSocket подключения
  recreateBinanceWS().catch(err => {
    console.error('[Server] Initial WebSocket creation failed:', err.message);
  });
  
  // Запуск интервала для рассылки summary
  summaryIntervalID = setInterval(() => {
    console.log('[setInterval] broadcastSummaries tick', new Date().toISOString());
    try {
      broadcastSummaries();
    } catch (err) {
      console.error('[setInterval] broadcastSummaries error:', err.message);
    }
  }, CONFIG.SUMMARY_INTERVAL);
  console.log('[setInterval] broadcastSummaries started');
  
  // Запуск интервала для переподключения WebSocket
  wsReconnectIntervalID = setInterval(() => {
    try {
      recreateBinanceWS();
    } catch (err) {
      console.error('[setInterval] recreateBinanceWS error:', err.message);
    }
  }, 2 * 60 * 1000);
  console.log('[setInterval] WebSocket reconnection scheduler started');
});

// Глобальные обработчики ошибок и выхода
process.on('uncaughtException', err => {
  console.error('[uncaughtException]', err);
});
process.on('unhandledRejection', err => {
  console.error('[unhandledRejection]', err);
});
process.on('exit', code => {
  console.log('[process exit] code:', code);
});
