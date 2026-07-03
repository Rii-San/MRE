const express = require('express');
const router = express.Router({ mergeParams: true });
const { createWatchlistRouter } = require('./routesFactory');
const movieWdb = require('../db/watchlistDb');
const animeWdb = require('../db/anime_watchlistDb');
const { invalidateWatchlist } = require('../engine/cache');

const movieWatchlistRouter = createWatchlistRouter({
    wdb: movieWdb,
    domain: 'movie',
    invalidateWatchlist,
    typeName: 'watchlist',
    getAllQuery: (wdb) => wdb.prepare('SELECT * FROM watchlist ORDER BY added_date DESC').all(),
    getExistingQuery: (wdb, id) => wdb.prepare('SELECT tmdb_id FROM watchlist WHERE tmdb_id = ?').get(id),
    insertQuery: (wdb, id, title, release_year, poster_path, body) => {
        const today = new Date().toISOString().split('T')[0];
        wdb.prepare(`INSERT INTO watchlist (tmdb_id, title, release_year, poster_path, added_date) VALUES (?, ?, ?, ?, ?)`).run(id, title, release_year || null, poster_path || null, body.added_date || today);
    },
    deleteQuery: (wdb, id) => wdb.prepare('DELETE FROM watchlist WHERE tmdb_id = ?').run(id)
});

const animeWatchlistRouter = createWatchlistRouter({
    wdb: animeWdb,
    domain: 'anime',
    invalidateWatchlist,
    typeName: 'watchlist_anime',
    getAllQuery: (wdb) => wdb.prepare('SELECT * FROM watchlist_anime ORDER BY added_date DESC').all(),
    getExistingQuery: (wdb, id) => wdb.prepare('SELECT anilist_id FROM watchlist_anime WHERE anilist_id = ?').get(id),
    insertQuery: (wdb, id, title, release_year, cover_image, body) => {
        const title_romaji = body.title_romaji || body.title;
        wdb.prepare(`INSERT OR REPLACE INTO watchlist_anime (anilist_id, title_english, title_romaji, release_year, cover_image, added_date) VALUES (?, ?, ?, ?, ?, ?)`).run(id, title, title_romaji, release_year, cover_image, body.added_date || new Date().toISOString());
    },
    deleteQuery: (wdb, id) => wdb.prepare('DELETE FROM watchlist_anime WHERE anilist_id = ?').run(id)
});

router.use('/', (req, res, next) => {
    if (req.params.domain === 'anime') {
        return animeWatchlistRouter(req, res, next);
    }
    return movieWatchlistRouter(req, res, next);
});

module.exports = router;
