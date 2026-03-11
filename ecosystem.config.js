/**
 * PM2 Ecosystem Configuration
 * GoBoom Growth Agents - Mac Mini 24/7 Deployment
 *
 * Usage:
 *   pm2 start ecosystem.config.js
 *   pm2 start ecosystem.config.js --only api
 *   pm2 logs
 *   pm2 monit
 *
 * Setup for startup on boot:
 *   pm2 startup
 *   pm2 save
 */

module.exports = {
  apps: [
    {
      name: 'api',
      script: 'npm',
      args: 'run start:api',
      cwd: './',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      env_development: {
        NODE_ENV: 'development',
        PORT: 3000,
      },
      error_file: './logs/api-error.log',
      out_file: './logs/api-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
    },
    {
      name: 'worker',
      script: 'npm',
      args: 'run start:worker',
      cwd: './',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
      },
      env_development: {
        NODE_ENV: 'development',
      },
      error_file: './logs/worker-error.log',
      out_file: './logs/worker-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      // Cron jobs run inside this worker
      cron_restart: '0 0 * * *', // Restart daily at midnight
    },
    {
      name: 'ui',
      script: 'npm',
      args: 'run preview',
      cwd: './ui',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      env: {
        NODE_ENV: 'production',
        PORT: 4002,
      },
      env_development: {
        NODE_ENV: 'development',
        PORT: 4002,
      },
      error_file: './logs/ui-error.log',
      out_file: './logs/ui-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
    },
    {
      name: 'mcp-server',
      script: 'npm',
      args: 'run mcp:start',
      cwd: './',
      instances: 1,
      autorestart: false, // MCP server is typically started on-demand
      watch: false,
      max_memory_restart: '300M',
      env: {
        NODE_ENV: 'production',
      },
      error_file: './logs/mcp-error.log',
      out_file: './logs/mcp-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
    },
  ],

  deploy: {
    production: {
      user: 'bnovak',
      host: 'localhost',
      ref: 'origin/main',
      repo: 'git@github.com:goboom/goboom-growth-agents.git',
      path: '/Volumes/T7_NOVAK/projects/goboom-growth-agents',
      'pre-deploy-local': '',
      'post-deploy': 'npm install && npm run build && pm2 reload ecosystem.config.js --env production',
      'pre-setup': '',
    },
  },
};
