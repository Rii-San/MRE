const express = require('express');
const router = express.Router({ mergeParams: true });
const { createInsightsRouter } = require('./routesFactory');
const movieDb = require('../db/db');
const animeDb = require('../db/anime_db');
const { getCache } = require('../engine/cache');

const movieInsightsRouter = createInsightsRouter({
    getCache,
    domain: 'movie',
    db: movieDb,
    getItemsQuery: (db) => db.prepare('SELECT w.user_rating, m.tmdb_id, m.tmdb_rating, COALESCE(m.primary_genres, m.genres) as active_genres, m.release_year, m.director, m.top_cast, m.collection_id FROM watched w JOIN movies m ON w.tmdb_id = m.tmdb_id').all(),
    getFranchiseKey: (r) => r.collection_id ? `collection_${r.collection_id}` : `movie_${r.tmdb_id}`,
    mapItem: (r) => ({ user_rating: r.user_rating, db_rating: r.tmdb_rating, genres: r.active_genres, director: r.director, castOrStudios: r.top_cast, release_year: r.release_year })
});

const animeInsightsRouter = createInsightsRouter({
    getCache,
    domain: 'anime',
    db: animeDb,
    getItemsQuery: (db) => db.prepare('SELECT w.user_rating, a.anilist_id, a.average_score, COALESCE(a.primary_genres, a.genres) as active_genres, a.tags, a.release_year, a.director, a.studios, a.franchise_group_id FROM watched_anime w JOIN anime a ON w.anilist_id = a.anilist_id').all(),
    getFranchiseKey: (r) => r.franchise_group_id ? `franchise_${r.franchise_group_id}` : `anime_${r.anilist_id}`,
    mapItem: (r) => ({ user_rating: r.user_rating, db_rating: (r.average_score || 0) / 10, genres: r.active_genres, tags: r.tags, director: r.director, castOrStudios: r.studios, release_year: r.release_year })
});

router.use('/', (req, res, next) => {
    if (req.params.domain === 'anime') {
        return animeInsightsRouter(req, res, next);
    }
    return movieInsightsRouter(req, res, next);
});

module.exports = router;
