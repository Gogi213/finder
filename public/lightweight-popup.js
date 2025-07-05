// lightweight-popup.js
// Всплывающее окно с графиком на TradingView Lightweight Charts

let lwPopup = null;
let lwChart = null;
let lwSeries = null;

function showLightweightChartPopup(symbol, candles) {
  if (!lwPopup) {
    lwPopup = document.createElement('div');
    lwPopup.id = 'lw-popup';
    lwPopup.style.position = 'fixed';
    lwPopup.style.top = '50px';
    lwPopup.style.left = '50%';
    lwPopup.style.transform = 'translateX(-50%)';
    lwPopup.style.width = '800px';
    lwPopup.style.height = '500px';
    lwPopup.style.background = '#181a20';
    lwPopup.style.border = '2px solid #444';
    lwPopup.style.borderRadius = '10px';
    lwPopup.style.zIndex = 10000;
    lwPopup.style.boxShadow = '0 8px 32px #000a';
    lwPopup.style.display = 'flex';
    lwPopup.style.flexDirection = 'column';
    lwPopup.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 16px;background:#23272f;border-radius:10px 10px 0 0;">
        <span style="font-weight:bold;font-size:1.1em;color:#fff;">${symbol} — график</span>
        <button id="lw-popup-close" style="background:#333;color:#fff;border:none;border-radius:4px;padding:4px 10px;cursor:pointer;">×</button>
      </div>
      <div id="lw-chart-container" style="flex:1 1 auto;"></div>
    `;
    document.body.appendChild(lwPopup);
    document.getElementById('lw-popup-close').onclick = () => {
      lwPopup.remove();
      lwPopup = null;
      lwChart = null;
      lwSeries = null;
    };
  } else {
    lwPopup.querySelector('span').textContent = symbol + ' — график';
    lwPopup.style.display = 'flex';
  }

  // Очищаем контейнер
  const chartContainer = lwPopup.querySelector('#lw-chart-container');
  chartContainer.innerHTML = '';

  // Инициализация графика
  lwChart = LightweightCharts.createChart(chartContainer, {
    width: 800,
    height: 440,
    layout: {
      background: { color: '#181a20' },
      textColor: '#d1d4dc',
    },
    grid: {
      vertLines: { color: '#222' },
      horzLines: { color: '#222' },
    },
    rightPriceScale: { borderColor: '#444' },
    timeScale: { borderColor: '#444', timeVisible: true, secondsVisible: false },
    crosshair: { mode: 1 },
  });
  lwSeries = lwChart.addCandlestickSeries({
    upColor: '#26a69a', downColor: '#ef5350', borderVisible: false, wickUpColor: '#26a69a', wickDownColor: '#ef5350',
  });
  lwSeries.setData(candles);
}

// Экспортируем функцию для глобального доступа
window.showLightweightChartPopup = showLightweightChartPopup;

// Пример интеграции с app.js:
// showLightweightChartPopup('BTCUSDT', [{time: 1719859200, open: 100, high: 110, low: 90, close: 105}, ...])

// Для интеграции: вызовите showLightweightChartPopup(symbol, candles) при клике средней кнопкой мыши по монете.
