module.exports = {
  // Основные параметры фильтрации
  MIN_VOL: 100_000,
  MAX_VOL: 1_000_000_000,
  MIN_NATR: 0.45,
  MIN_VOLUME_USD: 500,
  TIME_WINDOW: 60000,        // 60 секунд окно для расчёта
  RECONNECT_ATTEMPTS: 2,     // Уменьшили для быстрого тестирования

  // Фильтр по 24h изменению цены
  MIN_PRICE_CHANGE_24H: -5,   // %

  // Интервал для рассылки summary
  SUMMARY_INTERVAL: 1000,     // 1 секунда

  // API retry settings
  API_RETRY_ATTEMPTS: 2,      // Уменьшили для быстрого тестирования
  API_RETRY_DELAY: 2000,      // 2 секунды начальная задержка
  API_TIMEOUT: 5000,          // 5 секунд таймаут
  
  // Rate limiting
  API_RATE_LIMIT_DELAY: 1000, // 1 секунда между запросами к API
};
