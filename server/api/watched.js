const express = require('express');
const router = express.Router({ mergeParams: true });
const movieDb = require('../db/db');
const animeDb = require('../db/anime_db');
const { fetchAndCacheMovie } = require('../tmdb');
const { fetchAndCacheAnime, syncRatingToAniList } = require('../anilist');
const { invalidateCache, incrementPendingItems } = require('../engine/cache');
const { generateTasteSummary } = require('../services/preprocessor');
const profileService = require('../services/profileService');

// Background task to trigger re-clustering when staleness threshold is reached
async function checkAndRecomputeClusters() {
    const count = incrementPendingItems();
    if (count >= 10) {
        console.log(`[Clustering] ${count} new edits detected. Recomputing clusters in background...`);
        try {
            const profile = profileService.getProfile();
            // generateTasteSummary internally calls setCachedTasteSummary but wait, no it doesn't.
            // Wait, we need to import setCachedTasteSummary and update the cache. Let's do that.
            const { setCachedTasteSummary } = require('../engine/cache');
            
            const result = await generateTasteSummary(
                profile.movieMinCluster ? parseInt(profile.movieMinCluster) : null,
                profile.animeMinCluster ? parseInt(profile.animeMinCluster) : null
            );
            
            if (result && result.summary && !result.summary.includes('Not enough data')) {
                setCachedTasteSummary(result.summary);
                console.log('[Clustering] Background recomputation successful.');
            }
        } catch (e) {
            console.error('[Clustering] Background recomputation failed:', e.message);
        }
    }
}

router.get('/', (req, res) => {
    try {
        if (req.params.domain === 'anime') {
            const rows = animeDb.prepare(`
                SELECT w.id, w.anilist_id, w.user_rating, w.watch_date, w.notes,
                       a.title_english, a.title_romaji, a.release_year, a.cover_image, a.average_score
                FROM watched_anime w
                JOIN anime a ON w.anilist_id = a.anilist_id
                ORDER BY w.watch_date DESC, w.id DESC
            `).all();
            res.json(rows);
        } else {
            const rows = movieDb.prepare(`
                SELECT w.id, w.tmdb_id, w.user_rating, w.rating_diff, w.watch_date, w.rewatch, w.notes,
                       m.title, m.release_year, m.tmdb_rating, m.poster_path
                FROM watched w
                JOIN movies m ON w.tmdb_id = m.tmdb_id
                ORDER BY w.watch_date DESC, w.id DESC
            `).all();
            res.json(rows);
        }
    } catch (error) {
        console.error('Error fetching watched list:', error);
        res.status(500).json({ error: 'Failed to fetch watched list' });
    }
});

router.post('/', async (req, res) => {
    try {
        if (req.params.domain === 'anime') {
            const { user_rating, watch_date, notes } = req.body;
            const anilist_id = req.body.anilist_id || req.body.tmdb_id;

            if (!anilist_id || user_rating === undefined) return res.status(400).json({ error: 'id and user_rating are required' });

            if (!animeDb.prepare('SELECT average_score FROM anime WHERE anilist_id = ?').get(anilist_id)) {
                await fetchAndCacheAnime(anilist_id);
            }

            const result = animeDb.prepare(`INSERT INTO watched_anime (anilist_id, user_rating, watch_date, notes) VALUES (?, ?, ?, ?)`).run(
                anilist_id, user_rating, watch_date || new Date().toISOString().split('T')[0], notes || null
            );

            const profile = profileService.getProfile();
            if (profile.anilist_access_token) {
                syncRatingToAniList(anilist_id, user_rating, profile.anilist_access_token);
            }

            invalidateCache('anime');
            checkAndRecomputeClusters().catch(console.error);
            res.json({ success: true, id: result.lastInsertRowid });
        } else {
            const { tmdb_id, user_rating, watch_date, rewatch, notes } = req.body;

            if (!tmdb_id || user_rating === undefined) return res.status(400).json({ error: 'tmdb_id and user_rating are required' });

            let checkMovie = movieDb.prepare('SELECT tmdb_rating FROM movies WHERE tmdb_id = ?').get(tmdb_id);
            if (!checkMovie) checkMovie = await fetchAndCacheMovie(tmdb_id);

            const rating_diff = user_rating - (checkMovie.tmdb_rating || 0);

            const result = movieDb.prepare(`INSERT INTO watched (tmdb_id, user_rating, rating_diff, watch_date, rewatch, notes) VALUES (?, ?, ?, ?, ?, ?)`).run(
                tmdb_id, user_rating, rating_diff, watch_date || new Date().toISOString().split('T')[0], rewatch ? 1 : 0, notes || null
            );

            invalidateCache('movie');
            checkAndRecomputeClusters().catch(console.error);
            res.json({ success: true, id: result.lastInsertRowid });
        }
    } catch (error) {
        console.error('Error adding watched entry:', error);
        res.status(500).json({ error: 'Failed to add watched entry', details: error.message });
    }
});

router.put('/:id', (req, res) => {
    try {
        const { user_rating, watch_date, rewatch, notes } = req.body;
        if (user_rating === undefined || !watch_date) return res.status(400).json({ error: 'Missing required fields' });

        if (req.params.domain === 'anime') {
            const info = animeDb.prepare(`UPDATE watched_anime SET user_rating = ?, watch_date = ?, notes = ? WHERE anilist_id = ?`).run(user_rating, watch_date, notes, req.params.id);
            if (info.changes === 0) return res.status(404).json({ error: 'Log not found' });
            invalidateCache('anime');
            checkAndRecomputeClusters().catch(console.error);
            res.json({ success: true });
        } else {
            const info = movieDb.prepare(`UPDATE watched SET user_rating = ?, watch_date = ?, rewatch = ?, notes = ? WHERE tmdb_id = ?`).run(user_rating, watch_date, rewatch ? 1 : 0, notes, req.params.id);
            if (info.changes === 0) return res.status(404).json({ error: 'Movie not found in archive' });
            invalidateCache('movie');
            checkAndRecomputeClusters().catch(console.error);
            res.json({ success: true });
        }
    } catch (error) {
        console.error('Error updating watched entry:', error);
        res.status(500).json({ error: 'Failed to update entry' });
    }
});

router.delete('/:id', (req, res) => {
    try {
        if (req.params.domain === 'anime') {
            const info = animeDb.prepare('DELETE FROM watched_anime WHERE anilist_id = ?').run(req.params.id);
            if (info.changes === 0) return res.status(404).json({ error: 'Log not found' });
            invalidateCache('anime');
            checkAndRecomputeClusters().catch(console.error);
            res.json({ success: true });
        } else {
            const info = movieDb.prepare('DELETE FROM watched WHERE tmdb_id = ?').run(req.params.id);
            if (info.changes === 0) return res.status(404).json({ error: 'Movie not found in archive' });
            invalidateCache('movie');
            checkAndRecomputeClusters().catch(console.error);
            res.json({ success: true });
        }
    } catch (error) {
        console.error('Error deleting watched entry:', error);
        res.status(500).json({ error: 'Failed to delete from archive' });
    }
});

router.post('/bulk', async (req, res) => {
    const { entries } = req.body;
    if (!Array.isArray(entries) || entries.length === 0) return res.status(400).json({ error: 'Array of entries required' });

    let imported = 0;
    const today = new Date().toISOString().split('T')[0];

    try {
        if (req.params.domain === 'anime') {
            const animeDataMap = new Map();
            for (const entry of entries) {
                const anilist_id = entry.tmdb_id; // Frontend passes tmdb_id
                if (!anilist_id || entry.user_rating === undefined || entry.user_rating === '') continue;
                if (!animeDb.prepare('SELECT average_score FROM anime WHERE anilist_id = ?').get(anilist_id)) {
                    try {
                        await fetchAndCacheAnime(anilist_id);
                    } catch (e) { }
                }
            }

            imported = animeDb.transaction(() => {
                let count = 0;
                for (const entry of entries) {
                    const anilist_id = entry.tmdb_id;
                    if (!anilist_id || entry.user_rating === undefined || entry.user_rating === '') continue;
                    
                    if (animeDb.prepare('SELECT id FROM watched_anime WHERE anilist_id = ?').get(anilist_id)) {
                        animeDb.prepare('UPDATE watched_anime SET user_rating = ? WHERE anilist_id = ?').run(entry.user_rating, anilist_id);
                    } else {
                        animeDb.prepare(`INSERT INTO watched_anime (anilist_id, user_rating, watch_date, notes) VALUES (?, ?, ?, ?)`).run(anilist_id, entry.user_rating, today, null);
                    }
                    count++;
                }
                return count;
            })();

            if (imported > 0) {
                invalidateCache('anime');
                for (let i = 0; i < imported; i++) {
                    checkAndRecomputeClusters().catch(console.error);
                }
            }
            res.json({ success: true, imported });
        } else {
            const movieDataMap = new Map();
            for (const entry of entries) {
                if (!entry.tmdb_id || entry.user_rating === undefined || entry.user_rating === '') continue;
                const checkMovie = movieDb.prepare('SELECT tmdb_rating FROM movies WHERE tmdb_id = ?').get(entry.tmdb_id);
                if (!checkMovie) {
                    try {
                        const movieInfo = await fetchAndCacheMovie(entry.tmdb_id);
                        movieDataMap.set(entry.tmdb_id, movieInfo.tmdb_rating);
                    } catch (e) { movieDataMap.set(entry.tmdb_id, null); }
                } else {
                    movieDataMap.set(entry.tmdb_id, checkMovie.tmdb_rating);
                }
            }

            imported = movieDb.transaction(() => {
                let count = 0;
                for (const entry of entries) {
                    if (!entry.tmdb_id || entry.user_rating === undefined || entry.user_rating === '') continue;
                    const tmdb_rating = movieDataMap.get(entry.tmdb_id);
                    if (tmdb_rating === null || tmdb_rating === undefined) continue;

                    const rating_diff = parseFloat(entry.user_rating) - tmdb_rating;
                    if (movieDb.prepare('SELECT id FROM watched WHERE tmdb_id = ?').get(entry.tmdb_id)) {
                        movieDb.prepare('UPDATE watched SET user_rating = ?, rating_diff = ? WHERE tmdb_id = ?').run(entry.user_rating, rating_diff, entry.tmdb_id);
                    } else {
                        movieDb.prepare(`INSERT INTO watched (tmdb_id, user_rating, rating_diff, watch_date, rewatch, notes) VALUES (?, ?, ?, ?, ?, ?)`).run(entry.tmdb_id, entry.user_rating, rating_diff, today, 0, null);
                    }
                    count++;
                }
                return count;
            })();

            if (imported > 0) {
                invalidateCache('movie');
                for (let i = 0; i < imported; i++) {
                    checkAndRecomputeClusters().catch(console.error);
                }
            }
            res.json({ success: true, imported });
        }
    } catch (error) {
        console.error('Bulk save error:', error);
        res.status(500).json({ error: 'Failed to save bulk ratings' });
    }
});

module.exports = router;
