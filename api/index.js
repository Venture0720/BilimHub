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
