module.exports = {
  apps: [
    {
      name: "lego-collection",
      script: "server.js",
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "256M",
      env: {
        NODE_ENV: "production",
        PORT: 3456,
        DAILY_REFRESH_ENABLED: "false",
      },
    },
    {
      name: "lego-daily-refresh",
      script: "scripts/daily-refresh.js",
      cwd: __dirname,
      instances: 1,
      autorestart: false,
      cron_restart: "0 3 * * *",
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
