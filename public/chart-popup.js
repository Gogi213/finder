// chart-popup.js
// Простейшее всплывающее окно с графиком для монеты

window.chartPopup = null;

window.showChartPopup = function(symbol) {
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
      <canvas id="chart-canvas" width="400" height="200"></canvas>
      <div style="font-size:0.9em;opacity:0.7;">Данные: Binance (цена за 30 мин)</div>
    </div>
  `;
  document.body.appendChild(window.chartPopup);
  window.chartPopup.querySelector('.chart-popup-close').onclick = () => {
    window.chartPopup.remove();
    window.chartPopup = null;
  };
  window.fetchChartData(symbol);
}

window.fetchChartData = function(symbol) {
  // Получаем 30 последних минутных свечей
  fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}USDT&interval=1m&limit=30`)
    .then(r => r.json())
    .then(data => {
      const labels = data.map(c => {
        const d = new Date(c[0]);
        return d.getHours().toString().padStart(2,'0')+':'+d.getMinutes().toString().padStart(2,'0');
      });
      const prices = data.map(c => +c[4]);
      window.drawChart(labels, prices);
    });
}

window.drawChart = function(labels, prices) {
  const ctx = document.getElementById('chart-canvas').getContext('2d');
  if (window.chartInstance) window.chartInstance.destroy();
  window.chartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Цена USDT',
        data: prices,
        borderColor: '#4caf50',
        backgroundColor: 'rgba(76,175,80,0.1)',
        pointRadius: 0,
        borderWidth: 2,
        tension: 0.2
      }]
    },
    options: {
      plugins: { legend: { display: false } },
      scales: { x: { display: true }, y: { display: true } },
      responsive: false
    }
  });
}
