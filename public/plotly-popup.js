// plotly-popup.js
// Всплывающее окно с графиком на Plotly.js (свечи, зум, панорамирование, тулбар)

let plotlyPopup = null;


function showPlotlyChartPopup(symbol, candles) {
  if (!plotlyPopup) {
    plotlyPopup = document.createElement('div');
    plotlyPopup.id = 'plotly-popup';
    plotlyPopup.style.position = 'fixed';
    plotlyPopup.style.top = '50px';
    plotlyPopup.style.left = '50%';
    plotlyPopup.style.transform = 'translateX(-50%)';
    plotlyPopup.style.width = '900px';
    plotlyPopup.style.maxWidth = '98vw';
    plotlyPopup.style.height = 'calc(100vh - 80px)';
    plotlyPopup.style.maxHeight = 'calc(100vh - 40px)';
    plotlyPopup.style.minHeight = '350px';
    plotlyPopup.style.background = '#121212';
    plotlyPopup.style.border = '2.5px solid #26ffb4';
    plotlyPopup.style.borderRadius = '12px';
    plotlyPopup.style.zIndex = 10000;
    plotlyPopup.style.boxShadow = '0 8px 32px #121212, 0 1.5px 0 #121212 inset';
    plotlyPopup.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 20px 8px 20px;background:#121212;border-radius:12px 12px 0 0;border-bottom:1.5px solid #26ffb4;box-shadow:0 1.5px 0 #121212;">
        <span style="font-weight:bold;font-size:1.13em;color:#26ffb4;letter-spacing:0.5px;text-shadow:0 0 6px #26ffb4,0 0 2px #26ffb4;">${symbol} — график</span>
        <button id="plotly-popup-close" style="background:#121212;color:#26ffb4;border:none;border-radius:6px;padding:4px 14px;font-size:1.3em;cursor:pointer;transition:background 0.15s;">×</button>
      </div>
      <div id="plotly-chart-container" style="flex:1 1 auto;"></div>
    `;
    document.body.appendChild(plotlyPopup);
    document.getElementById('plotly-popup-close').onclick = () => {
      plotlyPopup.remove();
      plotlyPopup = null;
      // Снимаем выделение только при закрытии попапа
      window.activePlotlySymbol = null;
      if (window.updateCoinRowStyles) window.updateCoinRowStyles(null);
    };
  } else {
    plotlyPopup.querySelector('span').textContent = symbol + ' — график';
    plotlyPopup.style.display = 'flex';
  }

  // Очищаем контейнер
  const chartContainer = plotlyPopup.querySelector('#plotly-chart-container');
  chartContainer.innerHTML = '';

  // Формируем данные для Plotly
  const o = [], h = [], l = [], c = [], t = [];
  for (const candle of candles) {
    o.push(candle.open);
    h.push(candle.high);
    l.push(candle.low);
    c.push(candle.close);
    t.push(new Date(candle.time * 1000));
  }
  const data = [{
    x: t,
    open: o,
    high: h,
    low: l,
    close: c,
    type: 'candlestick',
    increasing: { line: { color: '#26a69a' } },
    decreasing: { line: { color: '#ef5350' } },
    name: symbol,
    showlegend: false
  }];
  // Показываем только последние 120 свечей, но вся история доступна для прокрутки и зума
  // Показываем всю историю, но изначально зум на последние 120 свечей
  const visibleCount = 120;
  const totalCount = candles.length;
  const layout = {
    dragmode: 'pan',
    plot_bgcolor: '#121212',
    paper_bgcolor: '#121212',
    font: { color: '#d1d4dc', family: 'inherit, Segoe UI, Arial, sans-serif' },
    xaxis: {
      rangeslider: { visible: false },
      gridcolor: '#121212',
      zeroline: false,
      tickformat: '%H:%M\n%d.%m',
      color: '#d1d4dc',
      linecolor: '#121212',
      tickfont: { color: '#d1d4dc' },
      showgrid: true,
      showline: true,
      mirror: true,
      range: totalCount > visibleCount ? [t[totalCount - visibleCount], t[totalCount - 1]] : undefined,
      showspikes: true,
      spikemode: 'across',
      spikesnap: 'cursor',
      spikedash: 'solid',
      spikecolor: '#888',
      spikethickness: 1,
      showline: true,
      showticklabels: true,
      showgrid: true,
      automargin: true,
      fixedrange: false // разрешить масштабирование по X
    },
    yaxis: {
      gridcolor: '#121212',
      zeroline: false,
      side: 'right',
      color: '#d1d4dc',
      linecolor: '#121212',
      tickfont: { color: '#d1d4dc' },
      showgrid: true,
      showline: true,
      mirror: true,
      showspikes: true,
      spikemode: 'across',
      spikesnap: 'cursor',
      spikedash: 'solid',
      spikecolor: '#888',
      spikethickness: 1,
      showticklabels: true,
      showgrid: true,
      automargin: true,
      fixedrange: false // разрешить масштабирование по Y
    },
    margin: { t: 30, l: 40, r: 40, b: 40 },
    showlegend: false,
    hovermode: 'x', // crosshair и подсветка осей, тултип по оси
    xaxis_showspikes: true,
    yaxis_showspikes: true,
    xaxis_spikemode: 'across',
    yaxis_spikemode: 'across',
    xaxis_spikecolor: '#888',
    yaxis_spikecolor: '#888',
    xaxis_spikethickness: 1,
    yaxis_spikethickness: 1
  };
  Plotly.newPlot(chartContainer, data, layout, {
    responsive: true,
    displayModeBar: true,
    displaylogo: false,
    modeBarButtonsToRemove: ['sendDataToCloud','autoScale2d','resetScale2d','select2d','lasso2d','hoverClosestCandlestick','hoverCompareCartesian'],
    scrollZoom: true,
    doubleClick: 'reset+autosize' // двойной клик сбрасывает зум
  });
}

window.showPlotlyChartPopup = showPlotlyChartPopup;
