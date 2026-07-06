require('dotenv').config();
const express = require('express');
const cors = require('cors');
const db = require('./db/db');
const logger = require('./utils/logger');
const requestLogger = require('./middleware/requestLogger');

const app = express();
const PORT = process.env.PORT || 3000;

const path = require('path');

app.use(cors());
app.use(requestLogger);
app.use(express.json());
app.use(express.static(path.join(__dirname, '../client')));

const discoverRouter = require('./api/discover');
const searchRouter = require('./api/search');
const recommendRouter = require('./api/recommend');
const insightsRouter = require('./api/insights');
const watchedRouter = require('./api/watched');
const watchlistRouter = require('./api/watchlist');

const importExportRouter = require('./api/importexport');
const profileRouter = require('./api/profile');
const deepInsightsRouter = require('./api/deep_insights');
const authRouter = require('./api/auth');
const chatRouter = require('./api/chat');

// Shared Parameterized Routes
app.use('/api/:domain/discover', discoverRouter);
app.use('/api/:domain/search', searchRouter);
app.use('/api/:domain/recommend', recommendRouter);
app.use('/api/:domain/insights', insightsRouter);
app.use('/api/:domain/watched', watchedRouter);
app.use('/api/:domain/watchlist', watchlistRouter);

// Global / Shared Routes
app.use('/api/export', importExportRouter);
app.use('/api/import', importExportRouter); // Same router handles POST
app.use('/api/profile', profileRouter);
app.use('/api/deep_insights', deepInsightsRouter);
app.use('/api/auth', authRouter);
app.use('/api/chat', chatRouter);

const { startSyncLoop, getSyncStatus } = require('./services/sync');
const { startAnimeSyncLoop, getAnimeSyncStatus } = require('./services/anime_sync');
const { checkAndFetchDailyReading } = require('./services/horoscopeService');

// Sync status route
app.get('/api/sync/status', (req, res) => {
    res.json({
        movie: getSyncStatus(),
        anime: getAnimeSyncStatus()
    });
});

// Healthcheck route
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: 'MRE Server is running' });
});

// Start server
app.listen(PORT, () => {
    logger.info(`Server is running on http://localhost:${PORT}`, 'Server');
    startSyncLoop(); // Kick off the background repair job
    startAnimeSyncLoop(); // Kick off anime background repair job
    checkAndFetchDailyReading(); // Kick off daily horoscope reading
});
