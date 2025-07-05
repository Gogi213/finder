// echart-popup.js
// Всплывающее окно с графиком на Apache ECharts (свечи, зум, панорамирование, crosshair)

let echartPopup = null;
let echartInstance = null;

function showEChartPopup(symbol, candles, priceDecimals = 8) {
  if (!echartPopup) {
    echartPopup = document.createElement('div');
    echartPopup.id = 'echart-popup';
    echartPopup.style.position = 'fixed';
    echartPopup.style.top = '50px';
    echartPopup.style.left = '50%';
    echartPopup.style.transform = 'translateX(-50%)';
    echartPopup.style.width = '900px';
    echartPopup.style.maxWidth = '98vw';
    echartPopup.style.height = 'calc(100vh - 80px)';
    echartPopup.style.maxHeight = 'calc(100vh - 40px)';
    echartPopup.style.minHeight = '350px';
    echartPopup.style.background = '#121212';
    echartPopup.style.border = '2.5px solid #26ffb4';
    echartPopup.style.borderRadius = '12px';
    echartPopup.style.zIndex = 10000;
    echartPopup.style.boxShadow = '0 8px 32px #121212, 0 1.5px 0 #121212 inset';
    echartPopup.style.display = 'flex';
    echartPopup.style.flexDirection = 'column';
    echartPopup.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 20px 8px 20px;background:#121212;border-radius:12px 12px 0 0;border-bottom:1.5px solid #26ffb4;box-shadow:0 1.5px 0 #121212;">
        <span style="font-weight:bold;font-size:1.13em;color:#26ffb4;letter-spacing:0.5px;text-shadow:0 0 6px #26ffb4,0 0 2px #26ffb4;">${symbol} — график</span>
        <button id="echart-popup-close" style="background:#121212;color:#26ffb4;border:none;border-radius:6px;padding:4px 14px;font-size:1.3em;cursor:pointer;transition:background 0.15s;">×</button>
      </div>
      <div id="echart-container" style="flex:1 1 auto;height:100%;width:100%;"></div>
    `;
    document.body.appendChild(echartPopup);
    document.getElementById('echart-popup-close').onclick = () => {
      if (echartInstance) {
        echartInstance.dispose();
        echartInstance = null;
      }
      echartPopup.remove();
      echartPopup = null;
      window.activeEChartSymbol = null;
      if (window.updateCoinRowStyles) window.updateCoinRowStyles(null);
    };
  } else {
    // Удаляем старый график
    if (echartInstance) {
      echartInstance.dispose();
      echartInstance = null;
    }
    // Очищаем только контейнер для графика, не пересоздаём структуру popup
    const chartContainer = echartPopup.querySelector('#echart-container');
    if (chartContainer) {
      chartContainer.innerHTML = '';
    }
    // Обновляем заголовок
    const span = echartPopup.querySelector('span');
    if (span) span.textContent = symbol + ' — график';
    // Гарантируем, что popup всегда flex column
    echartPopup.style.display = 'flex';
    echartPopup.style.flexDirection = 'column';
  }

  // Очищаем контейнер
  const chartContainer = echartPopup.querySelector('#echart-container');
  // chartContainer.innerHTML уже очищен выше

  // Формируем данные для ECharts
  const categoryData = [];
  const values = [];
  for (const candle of candles) {
    categoryData.push(new Date(candle.time * 1000).toLocaleString());
    values.push([
      candle.open,
      candle.close,
      candle.low,
      candle.high
    ]);
  }

  if (!window.echarts) {
    alert('ECharts не загружен!');
    return;
  }
  
  // Принудительно устанавливаем размеры контейнера
  chartContainer.style.width = '100%';
  chartContainer.style.height = '100%';
  
  echartInstance = window.echarts.init(chartContainer);
  
  // Принудительный resize после инициализации
  setTimeout(() => {
    if (echartInstance) {
      echartInstance.resize();
    }
  }, 100);
  
  // Показываем все свечи, но изначально с отступом 20 свечей справа
  const totalCandles = categoryData.length;
  
  // Принудительно добавляем пустые элементы в конец для создания отступа
  for (let i = 0; i < 60; i++) {
    categoryData.push(''); // пустые метки времени
    values.push([null, null, null, null]); // пустые свечи
  }
  
  const visibleCandles = Math.floor(totalCandles / 3); // показываем треть реальных свечей
  const startPercentage = ((totalCandles - visibleCandles) / (totalCandles + 60)) * 100; // сдвигаем левее
  const endPercentage = (totalCandles / (totalCandles + 60)) * 100; // конец на последней реальной свече
  
  // Отладка
  console.log(`Real candles: ${totalCandles}, Total with padding: ${totalCandles + 60}, Start: ${startPercentage.toFixed(1)}%, End: ${endPercentage.toFixed(1)}%`);
  const option = {
    backgroundColor: '#121212',
    animation: false,
    grid: { left: 40, right: 80, top: 30, bottom: 40 },
    xAxis: {
      type: 'category',
      data: categoryData,
      scale: true,
      boundaryGap: false,
      axisLine: { lineStyle: { color: '#26ffb4' } },
      axisLabel: { color: '#d1d4dc', fontFamily: 'inherit, Segoe UI, Arial, sans-serif', fontSize: 12 },
      splitLine: { show: false }
      // НЕТ min/max - доступны ВСЕ свечи для скролла
    },
    yAxis: {
      scale: true,
      position: 'right',
      axisLine: { lineStyle: { color: '#26ffb4' } },
      axisLabel: { color: '#d1d4dc', fontFamily: 'inherit, Segoe UI, Arial, sans-serif', fontSize: 12 },
      splitLine: { show: true, lineStyle: { color: '#232323' } }
    },
    tooltip: {
      show: false // полностью отключаем тултипы OHLC
    },
    series: [{
      type: 'candlestick',
      data: values,
      itemStyle: {
        color: '#26a69a',
        color0: '#ef5350',
        borderColor: '#26a69a',
        borderColor0: '#ef5350',
        borderWidth: 1.2
      }
    }],
    dataZoom: [
      {
        type: 'inside',
        xAxisIndex: 0,
        start: startPercentage,  // начальный показ с отступом
        end: endPercentage,      // конец БЕЗ пустых свечей
        zoomLock: false,
        moveOnMouseMove: true,
        moveOnMouseWheel: true,
        zoomOnMouseWheel: true,
        preventDefaultMouseMove: false
      }
    ]
  };
  
  echartInstance.setOption(option);
  
  // Кастомный crosshair с подсветкой значений на осях
  let crosshairLines = [];
  let xLabel = null;
  let yLabel = null;
  
  echartInstance.getZr().on('mousemove', function(e) {
    // Очищаем старые элементы
    crosshairLines.forEach(line => echartInstance.getZr().remove(line));
    if (xLabel) echartInstance.getZr().remove(xLabel);
    if (yLabel) echartInstance.getZr().remove(yLabel);
    crosshairLines = [];
    
    const rect = chartContainer.getBoundingClientRect();
    const x = e.offsetX || (e.clientX - rect.left);
    const y = e.offsetY || (e.clientY - rect.top);
    
    // Получаем значения из графика
    const pointInPixel = [x, y];
    const pointInGrid = echartInstance.convertFromPixel('grid', pointInPixel);
    
    if (pointInGrid && pointInGrid[0] >= 0 && pointInGrid[1] !== null) {
      // Вертикальная линия
      const vLine = new echarts.graphic.Line({
        shape: { x1: x, y1: 30, x2: x, y2: chartContainer.clientHeight - 40 },
        style: { stroke: '#888', lineWidth: 1, opacity: 0.8 }
      });
      
      // Горизонтальная линия  
      const hLine = new echarts.graphic.Line({
        shape: { x1: 40, y1: y, x2: chartContainer.clientWidth - 80, y2: y },
        style: { stroke: '#888', lineWidth: 1, opacity: 0.8 }
      });
      
      // Лейбл времени на оси X
      const timeIndex = Math.round(pointInGrid[0]);
      if (timeIndex >= 0 && timeIndex < categoryData.length && categoryData[timeIndex]) {
        // Получаем координату оси X (по оси)
        const xAxisY = chartContainer.clientHeight - 40; // нижняя граница grid
        let labelWidth = 0;
        // Меряем ширину текста (для центрирования и предотвращения выхода за границы)
        if (echartInstance && echartInstance.getZr()) {
          const ctx = echartInstance.getZr().painter.getLayer(0).ctx;
          ctx.save();
          ctx.font = 'bold 11px Segoe UI, Arial, sans-serif';
          labelWidth = ctx.measureText(categoryData[timeIndex]).width + 16; // padding
          ctx.restore();
        }
        let labelX = x;
        if (labelX - labelWidth / 2 < 40) labelX = 40 + labelWidth / 2;
        if (labelX + labelWidth / 2 > chartContainer.clientWidth - 80) labelX = chartContainer.clientWidth - 80 - labelWidth / 2;
        xLabel = new echarts.graphic.Text({
          style: {
            text: categoryData[timeIndex],
            x: labelX,
            y: xAxisY,
            textAlign: 'center',
            textVerticalAlign: 'middle',
            fill: '#121212',
            backgroundColor: '#26ffb4',
            padding: [4, 8],
            borderRadius: 3,
            fontSize: 11,
            fontWeight: 'bold',
            fontFamily: 'inherit, Segoe UI, Arial, sans-serif'
          }
        });
        echartInstance.getZr().add(xLabel);
      }
      
      const price = pointInGrid[1];
      if (price !== null) {
        yLabel = new echarts.graphic.Text({
          style: {
            text: price.toFixed(priceDecimals),
            x: chartContainer.clientWidth - 80,
            y: y,
            textAlign: 'center',
            textVerticalAlign: 'middle',
            fill: '#121212',
            backgroundColor: '#26ffb4',
            padding: [4, 8],
            borderRadius: 3,
            fontSize: 11,
            fontWeight: 'bold'
          }
        });
        echartInstance.getZr().add(yLabel);
      }
      
      echartInstance.getZr().add(vLine);
      echartInstance.getZr().add(hLine);
      crosshairLines.push(vLine, hLine);
    }
  });
  
  // Убираем crosshair при выходе мыши
  echartInstance.getZr().on('mouseout', function() {
    crosshairLines.forEach(line => echartInstance.getZr().remove(line));
    if (xLabel) echartInstance.getZr().remove(xLabel);
    if (yLabel) echartInstance.getZr().remove(yLabel);
    crosshairLines = [];
    xLabel = null;
    yLabel = null;
  });
  
  // Принудительно включаем интерактивность
  echartInstance.getZr().on('mousedown', function() {
    console.log('Mouse down detected on chart');
  });
  
  // Второй setOption для гарантии
  setTimeout(() => {
    if (echartInstance) {
      echartInstance.setOption(option);
      echartInstance.resize();
    }
  }, 50);
}

window.showEChartPopup = showEChartPopup;
