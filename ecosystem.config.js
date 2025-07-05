// ~/binance_finder/ecosystem.config.js

module.exports = {
  apps: [
    {
      name: 'binance_finder',         // имя процесса в PM2
      script: './server.js',          // путь к твоему серверному файлу
      cwd: '/home/ubuntu/binance_finder', // рабочая директория
      instances: 1,                   // 1 копия; для кластеризации можно указать 'max'
      autorestart: true,              // перезапуск при падении
      watch: false,                   // не рестартить при изменении файлов (можно включить для dev)
      max_memory_restart: '512M',     // перезапуск при превышении памяти
      env: {
        NODE_ENV: 'production',
        PORT: 4000
      }
    }
  ]
};
