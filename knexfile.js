'use strict';
require('./load-env');

module.exports = {
  development: {
    client: 'pg',
    connection: {
      host: process.env.DB_HOST || '127.0.0.1',
      port: parseInt(process.env.DB_PORT || '5432'),
      database: process.env.DB_NAME || 'bilimhub',
      user: process.env.DB_USER || 'bilimhub',
      password: process.env.DB_PASSWORD || '',
    },
    pool: { min: 2, max: 10 },
    migrations: { directory: './migrations' },
    seeds: { directory: './seeds' },
  },

  production: {
    client: 'pg',
    connection: (() => {
      // DB_SSL_REJECT_UNAUTHORIZED: set to 'false' ONLY if your cloud provider uses
      // self-signed certs (e.g., some PaaS platforms). Default is true (secure).
      const rejectUnauthorized = process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false';
      if (process.env.DATABASE_URL) {
        return { connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized } };
      }
      return {
        host: process.env.DB_HOST,
        port: parseInt(process.env.DB_PORT || '5432'),
        database: process.env.DB_NAME,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized } : false,
      };
    })(),
    pool: {
      min: 0,
      max: 10,
      acquireTimeoutMillis: 30000,
      idleTimeoutMillis: 10000,
      reapIntervalMillis: 1000,
    },
    migrations: { directory: './migrations' },
    seeds: { directory: './seeds' },
  },
};
