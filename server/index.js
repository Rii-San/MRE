require('dotenv').config();
const express = require('express');
const cors = require('cors');
const db = require('./db/db');

const app = express();
const PORT = process.env.PORT || 3000;

const path = require('path');

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../client')));

const watchedRouter = require('./api/movies/watched');
const moviesRouter = require('./api/movies/search');
const discoverRouter = require('./api/movies/discover');
const recommendRouter = require('./api/movies/recommend');
const insightsRouter = require('./api/movies/insights');
const importExportRouter = require('./api/importexport');
const watchlistRouter = require('./api/movies/watchlist');

const animeWatchedRouter = require('./api/anime/watched');
const animeWatchlistRouter = require('./api/anime/watchlist');
const animeInsightsRouter = require('./api/anime/insights');
const animeDiscoverRouter = require('./api/anime/discover');
const animeSearchRouter = require('./api/anime/search');
const animeRecommendRouter = require('./api/anime/recommend');

app.use('/api/watched', watchedRouter);
app.use('/api/movies', moviesRouter);
app.use('/api/discover', discoverRouter);
app.use('/api/recommend', recommendRouter);
app.use('/api/insights', insightsRouter);
app.use('/api/export', importExportRouter);
app.use('/api/import', importExportRouter); // Same router handles POST
app.use('/api/watchlist', watchlistRouter);

app.use('/api/anime_watched', animeWatchedRouter);
app.use('/api/anime_watchlist', animeWatchlistRouter);
app.use('/api/anime_insights', animeInsightsRouter);
app.use('/api/anime_discover', animeDiscoverRouter);
app.use('/api/anime_search', animeSearchRouter);
app.use('/api/anime_recommend', animeRecommendRouter);

const { startSyncLoop, getSyncStatus } = require('./services/sync');
const { startAnimeSyncLoop, getAnimeSyncStatus } = require('./services/anime_sync');

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
    console.log(`Server is running on http://localhost:${PORT}`);
    startSyncLoop(); // Kick off the background repair job
    startAnimeSyncLoop(); // Kick off anime background repair job
});
