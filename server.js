// server.js

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

// Статика
app.use(express.static(path.join(__dirname, 'public')));
app.use('/client', express.static(path.join(__dirname, 'client')));

// Подключаем WebSocket к Binance
async function connectBinanceWS() {
  if (wsClient && wsClient.readyState === WebSocket.OPEN) return;

  let symbols = await getFilteredSymbols();
  if (symbols.length === 0) {
    // console.log('No symbols passing filter');
    return;
  }

  // Периодически обновляем пул валютных пар
  setInterval(async () => {
    try {
      const newSymbols = await getFilteredSymbols();
      newSymbols.forEach(sym => {
        if (!symbols.includes(sym)) {
          symbols.push(sym);
          if (!tradeVolumeStore[sym]) {
            tradeVolumeStore[sym] = { buys: [], sells: [] };
          }
          // Не создаём symbolMeta[sym] с natr: 0 — пусть появится только после расчёта NATR
        }
      });
    } catch (e) {
      console.error('Ошибка обновления пула валютных пар', e);
    }
  }, 5 * 60 * 1000); // 5 минут

  const stream = symbols.map(s => `${s}@trade`).join('/');
  wsClient = new WebSocket(`wss://stream.binance.com:9443/stream?streams=${stream}`);

  wsClient.on('open', () => {
    // console.log('Connected to Binance WS', new Date().toISOString());
    reconnectAttempts = 0;
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

      // Не учитываем сделки по монетам, которые не прошли фильтр по NATR
      const natr = symbolMeta[symbol]?.natr;
      if (!symbolMeta[symbol] || typeof natr !== 'number' || natr < CONFIG.MIN_NATR) {
        return;
      }
      if (!tradeVolumeStore[symbol]) {
        tradeVolumeStore[symbol] = { buys: [], sells: [] };
      }
      const sideList = isMaker ? 'sells' : 'buys';
      tradeVolumeStore[symbol][sideList].push({ timestamp: ts, volumeUsd });

      const lsRatio = calculateLSRatio(symbol);
      const lsRatioTrades = calculateLSRatioTrades(symbol);
      const pattern = {
        type: 'pattern',
        symbol: symbol.replace('USDT', ''),
        time: new Date(ts).toISOString().slice(11,19),
        timeStamp: ts,
        price,
        volumeUsd: volumeUsd.toFixed(2),
        volume: qty,
        lsRatio,
        lsRatioTrades
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
  const newSymbols = await getFilteredSymbols();
  if (JSON.stringify(newSymbols) === JSON.stringify(wsSymbols)) return;
  if (newSymbols.length === 0) return;

  const newStream = newSymbols.map(s => `${s}@trade`).join('/');
  const newWS = new WebSocket(`wss://stream.binance.com:9443/stream?streams=${newStream}`);

  newWS.on('open', () => {
    // console.log('Reconnected Binance WS with new symbols', new Date().toISOString());
    wsSymbols = newSymbols;
    broadcastSummaries();
    if (wsClient && wsClient.readyState === WebSocket.OPEN) wsClient.close();
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
      // Не учитываем сделки по монетам, которые не прошли фильтр по NATR
      const natr = symbolMeta[symbol]?.natr;
      if (!symbolMeta[symbol] || typeof natr !== 'number' || natr < CONFIG.MIN_NATR) {
        return;
      }
      if (!tradeVolumeStore[symbol]) {
        tradeVolumeStore[symbol] = { buys: [], sells: [] };
      }
      const sideList = isMaker ? 'sells' : 'buys';
      tradeVolumeStore[symbol][sideList].push({ timestamp: ts, volumeUsd });
      const lsRatio = calculateLSRatio(symbol);
      const lsRatioTrades = calculateLSRatioTrades(symbol);
      const pattern = {
        type: 'pattern',
        symbol: symbol.replace('USDT', ''),
        time: new Date(ts).toISOString().slice(11,19),
        timeStamp: ts,
        price,
        volumeUsd: volumeUsd.toFixed(2),
        volume: qty,
        lsRatio,
        lsRatioTrades
      };
      wss.clients.forEach(c => c.readyState === WebSocket.OPEN && c.send(JSON.stringify(pattern)));
    } catch (e) {
      console.error('WS data error', e);
    }
  });

  newWS.on('close', () => {
    if (reconnectAttempts < CONFIG.RECONNECT_ATTEMPTS) {
      reconnectAttempts++;
      setTimeout(recreateBinanceWS, 2000);
    }
  });
}

// Рассылка метрик для «Списка монет»
function broadcastSummaries() {
  const now = Date.now();
  const nowStr = new Date(now).toISOString();
  //
  const symbols = Object.keys(tradeVolumeStore);
  //
  for (const symbol of symbols) {
    cleanupOldData(symbol);
    const data = tradeVolumeStore[symbol];
    if (!data) continue;
    // Не отправляем summary, если symbolMeta отсутствует или natr < CONFIG.MIN_NATR
    const natr = symbolMeta[symbol]?.natr;
    if (!symbolMeta[symbol] || typeof natr !== 'number' || natr < CONFIG.MIN_NATR) {
      continue;
    }
    const buyVol   = data.buys.reduce((sum, t) => sum + t.volumeUsd, 0);
    const sellVol  = data.sells.reduce((sum, t) => sum + t.volumeUsd, 0);
    const buyCnt   = data.buys.length;
    const sellCnt  = data.sells.length;
    const totalVol = buyVol + sellVol;
    const avgSize  = totalVol > 0 ? (totalVol / (buyCnt + sellCnt)) : 0;
    const lsRatio  = sellCnt > 0 ? buyCnt / sellCnt : buyCnt;
    const delta    = buyVol - sellVol;

    const summary = {
      type: 'summary',
      symbol: symbol.replace('USDT', ''),
      lsRatio:  lsRatio.toFixed(2),
      totalVol: totalVol.toFixed(2),
      buyCnt,
      sellCnt,
      avgSize:  avgSize.toFixed(2),
      natr:     natr.toFixed(2),
      delta:    delta.toFixed(2)
    };
    //
    wss.clients.forEach(c => c.readyState === WebSocket.OPEN && c.send(JSON.stringify(summary)));
  }
}

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

function calculateLSRatioTrades(symbol) {
  const data = tradeVolumeStore[symbol] || { buys: [], sells: [] };
  const buyCnt = data.buys.length;
  const sellCnt = data.sells.length;
  const result = sellCnt > 0 ? buyCnt / sellCnt : buyCnt;
  return result;
}

async function getFilteredSymbols() {
  try {
    const { data: tickers } = await axios.get(
      'https://api.binance.com/api/v3/ticker/24hr',
      { timeout: 10000 }
    );
    const filtered = tickers.filter(i =>
      i.symbol.endsWith('USDT') &&
      !i.symbol.includes('1000') &&
      +i.quoteVolume >= CONFIG.MIN_VOL &&
      +i.quoteVolume <= CONFIG.MAX_VOL &&
      +i.priceChangePercent >= CONFIG.MIN_PRICE_CHANGE_24H
    );

    const result = [];
    for (let i = 0; i < filtered.length; i += 15) {
      const batch = filtered.slice(i, i + 15);
      const res = await Promise.all(batch.map(async tk => {
        try {
          //
          const { data: klines } = await axios.get(
            'https://api.binance.com/api/v3/klines',
            { params: { symbol: tk.symbol, interval: '1m', limit: 31 }, timeout: 10000 }
          );
          const price = +tk.lastPrice;
          const natr  = calculateNATR(price, klines);
          //
          symbolMeta[tk.symbol] = { natr };
          if (natr >= CONFIG.MIN_NATR) {
            //
            return tk.symbol.toLowerCase();
          } else {
            //
          }
        } catch (e) {
          //
        }
        return null;
      }));
      result.push(...res.filter(Boolean));
    }
    return result;
  } catch (e) {
    console.error('Filter error', e);
    return [];
  }
}

function calculateNATR(price, candles) {
  const period = 30;
  const trs = [];
  //
  
  for (let i = 1; i < candles.length; i++) {
    const prev  = +candles[i - 1][4];
    const high  = +candles[i][2];
    const low   = +candles[i][3];
    trs.push(Math.max(high - low, Math.abs(high - prev), Math.abs(low - prev)));
  }
  
  //
  if (trs.length < period) {
    //
    return 0;
  }
  
  let atr = trs.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = period; i < trs.length; i++) {
    atr = ((atr * (period - 1)) + trs[i]) / period;
  }
  
  const result = price > 0 ? (atr / price) * 100 : 0;
  //
  return result;
}

// —————— ИЗМЕНЁННАЯ СТРОКА ——————
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server: http://0.0.0.0:${PORT}`);
  recreateBinanceWS();
  summaryIntervalID = setInterval(() => {
    //
    broadcastSummaries();
  }, CONFIG.SUMMARY_INTERVAL);
  //
  wsReconnectIntervalID = setInterval(recreateBinanceWS, 2 * 60 * 1000);
});
// —————————————————————————————

process.on('uncaughtException', err => {
  console.error('[uncaughtException]', err);
});
process.on('unhandledRejection', err => {
  console.error('[unhandledRejection]', err);
});
process.on('exit', code => {
  //
});
