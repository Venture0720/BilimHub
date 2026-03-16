// Run pending DB migrations on cold start (idempotent)
try {
  const knex = require('knex')(require('../knexfile')[process.env.NODE_ENV || 'production']);
  knex.migrate.latest({ directory: require('path').join(__dirname, '../migrations') })
    .then(() => knex.destroy())
    .catch(e => console.error('Migration error:', e.message));
} catch (e) { console.error('Migration init error:', e.message); }

let app;
try {
  app = require('../server');
} catch (err) {
  // If server.js fails to load, return a diagnostic handler
  const express = require('express');
  app = express();
  app.use((req, res) => {
    res.status(500).json({ 
      error: 'Server failed to initialize',
      message: err.message,
      stack: process.env.NODE_ENV !== 'production' ? err.stack : undefined
    });
  });
}
module.exports = app;
