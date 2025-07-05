module.exports = {
  // Основные параметры фильтрации
  MIN_VOL: 100_000,
  MAX_VOL: 1_000_000_000,
  MIN_NATR: 0.45,
  MIN_VOLUME_USD: 500,
  TIME_WINDOW: 60000,        // 60 секунд окно для расчёта
  RECONNECT_ATTEMPTS: 5,

  // Фильтр по 24h изменению цены
  MIN_PRICE_CHANGE_24H: -10,   // %

  // Интервал для рассылки summary
  SUMMARY_INTERVAL: 1000     // 5 секунд
};
