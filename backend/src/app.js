const express = require('express');
const authRoutes = require('./routes/auth');

const app = express();
// Railway puts one proxy in front of the app; this makes req.ip the real client IP for rate limiting
app.set('trust proxy', 1);
// Don't advertise the framework in response headers
app.disable('x-powered-by');
app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.use('/api/auth', authRoutes);

app.use('/api', (req, res) => {
  res.status(404).json({ message: 'Not found.' });
});

// Express 5 forwards errors thrown in async route handlers here
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ message: 'Invalid request body.' });
  }
  console.error(err);
  res.status(500).json({ message: 'Something went wrong. Please try again.' });
});

module.exports = app;
