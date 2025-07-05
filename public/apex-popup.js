// apex-popup.js
console.log('apex-popup.js loaded');
window.currentChartSymbol = null; // Текущий символ с открытым графиком

window.showChartPopup = function(symbol) {
  console.log('showChartPopup called with symbol:', symbol);
  if (window.chartPopup) {
    window.chartPopup.remove();
    window.chartPopup = null;
  }
  window.currentChartSymbol = symbol; // Запоминаем активный символ
  updateCoinRowStyles(); // Обновляем стили строк
  if (window.chartPopup) {
    window.chartPopup.remove();
    window.chartPopup = null;
  }
  window.chartPopup = document.createElement('div');
  window.chartPopup.className = 'chart-popup';
  window.chartPopup.innerHTML = `
    <div class="chart-popup-content">
      <span class="chart-popup-close">×</span>
      <h3>График ${symbol}</h3>
      <div id="apex-chart" style="width:1040px;height:680px;"></div>
      <div style="font-size:0.9em;opacity:0.7;">Данные: Binance (свечи 1м, последние 180) | Навигация: ЛКМ+перетаскивание, колёсико мыши для зума</div>
    </div>
  `;
  document.body.appendChild(window.chartPopup);
  window.chartPopup.querySelector('.chart-popup-close').onclick = () => {
    window.chartPopup.remove();
    window.chartPopup = null;
    window.currentChartSymbol = null; // Сбрасываем активный символ
    updateCoinRowStyles(); // Обновляем стили строк
  };
  fetchApexChartData(symbol);
}

window.fetchApexChartData = function(symbol) {
  fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}USDT&interval=1m&limit=180`)
    .then(r => r.json())
    .then(data => {
      const candlestickData = data.map(c => {
        return {
          x: new Date(c[0]),
          y: [+c[1], +c[2], +c[3], +c[4]] // [open, high, low, close]
        };
      });
      drawApexChart(candlestickData);
    });
}

window.drawApexChart = function(candlestickData) {
  if (window.apexChartInstance) window.apexChartInstance.destroy();
  window.apexChartInstance = new ApexCharts(document.querySelector("#apex-chart"), {
    chart: { 
      type: 'candlestick', 
      height: 640, 
      width: 1000, 
      toolbar: { 
        show: true,
        tools: {
          download: true,
          selection: false,
          zoom: true,
          zoomin: true,
          zoomout: true,
          pan: true,
          reset: true
        }
      },
      background: '#1e1e1e',
      zoom: {
        enabled: true,
        type: 'x',
        autoScaleYaxis: true,
        zoomedArea: {
          fill: {
            color: '#90CAF9',
            opacity: 0.4
          },
          stroke: {
            color: '#0D47A1',
            opacity: 0.4,
            width: 1
          }
        }
      },
      pan: {
        enabled: true,
        type: 'x',
        cursor: 'grab',
        resetOnDoubleClick: true
      },
      selection: {
        enabled: false
      },
      animations: {
        enabled: true,
        easing: 'easeinout',
        speed: 400,
        animateGradually: {
          enabled: true,
          delay: 50
        }
      }
    },
    series: [{
      name: 'Цена',
      data: candlestickData
    }],
    xaxis: {
      type: 'datetime',
      labels: {
        style: { colors: '#e0e0e0' },
        datetimeFormatter: {
          hour: 'HH:mm'
        }
      }
    },
    yaxis: {
      opposite: true,
      labels: {
        style: { colors: '#e0e0e0' },
        formatter: function(val) {
          return val.toFixed(6);
        }
      }
    },
    plotOptions: {
      candlestick: {
        colors: {
          upward: '#4caf50',
          downward: '#f44336'
        }
      }
    },
    grid: { 
      borderColor: '#333',
      strokeDashArray: 2
    },
    tooltip: {
      theme: 'dark',
      custom: function({seriesIndex, dataPointIndex, w}) {
        const data = w.globals.initialSeries[seriesIndex].data[dataPointIndex];
        const date = new Date(data.x);
        const time = date.getHours().toString().padStart(2,'0') + ':' + date.getMinutes().toString().padStart(2,'0');
        return `<div style="padding: 10px;">
          <div><strong>${time}</strong></div>
          <div>Open: ${data.y[0].toFixed(6)}</div>
          <div>High: ${data.y[1].toFixed(6)}</div>
          <div>Low: ${data.y[2].toFixed(6)}</div>
          <div>Close: ${data.y[3].toFixed(6)}</div>
        </div>`;
      }
    },
    theme: { mode: 'dark' }
  });
  window.apexChartInstance.render();
}

// Функция для обновления стилей строк монет
window.updateCoinRowStyles = function() {
  const coinRows = document.querySelectorAll('#coinList tbody tr');
  coinRows.forEach(row => {
    const symbolCell = row.querySelector('.coin-symbol-cell');
    if (symbolCell) {
      const symbol = symbolCell.textContent.trim();
      if (window.currentChartSymbol && symbol === window.currentChartSymbol) {
        row.style.border = '2px solid #4caf50';
        row.style.borderRadius = '4px';
      } else {
        row.style.border = '';
        row.style.borderRadius = '';
      }
    }
  });
}
