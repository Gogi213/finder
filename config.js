module.exports = {
  // Основные параметры фильтрации
  MIN_VOL: 50_000,
  MAX_VOL: 500_000_000,
  MIN_NATR: 0.4,
  MIN_VOLUME_USD: 500,
  TIME_WINDOW: 60000,        // 60 секунд окно для расчёта
  RECONNECT_ATTEMPTS: 5,

  // Фильтр по 24h изменению цены
  MIN_PRICE_CHANGE_24H: -5,   // %

  // Интервал для рассылки summary
  SUMMARY_INTERVAL: 5000     // 5 секунд
};
