const express = require('express');
const router = express.Router();
const db = require('../../db/db');
const { fetchAndCacheMovie } = require('../../tmdb');
const { invalidateCache } = require('../../engine/cache');

// POST /api/watched


// POST /api/watched
// Body: { tmdb_id, user_rating, watch_date, rewatch, notes }
router.post('/', async (req, res) => {
    const { tmdb_id, user_rating, watch_date, rewatch, notes } = req.body;

    if (!tmdb_id || user_rating === undefined) {
        return res.status(400).json({ error: 'tmdb_id and user_rating are required' });
    }

    try {
        // 1. Ensure movie exists in local cache
        const checkMovie = db.prepare('SELECT tmdb_rating FROM movies WHERE tmdb_id = ?').get(tmdb_id);
        
        let tmdb_rating = 0;
        if (!checkMovie) {
            // Fetch and insert
            const movieInfo = await fetchAndCacheMovie(tmdb_id);
            tmdb_rating = movieInfo.tmdb_rating;
        } else {
            tmdb_rating = checkMovie.tmdb_rating;
        }

        // 2. Compute rating diff
        const rating_diff = user_rating - tmdb_rating;

        // 3. Insert watched log
        const insertWatched = db.prepare(`
            INSERT INTO watched (tmdb_id, user_rating, rating_diff, watch_date, rewatch, notes)
            VALUES (?, ?, ?, ?, ?, ?)
        `);

        const result = insertWatched.run(
            tmdb_id, 
            user_rating, 
            rating_diff, 
            watch_date || new Date().toISOString().split('T')[0], 
            rewatch ? 1 : 0, 
            notes || null
        );

        invalidateCache('movie');
        res.json({ success: true, id: result.lastInsertRowid });
    } catch (error) {
        console.error('Error adding to watched archive:', error);
        res.status(500).json({ error: 'Failed to add watched entry', details: error.message });
    }
});

// GET /api/watched - to view archive
router.get('/', (req, res) => {
    try {
        const rows = db.prepare(`
            SELECT w.id, w.tmdb_id, w.user_rating, w.rating_diff, w.watch_date, w.rewatch, w.notes,
                   m.title, m.release_year, m.tmdb_rating, m.poster_path
            FROM watched w
            JOIN movies m ON w.tmdb_id = m.tmdb_id
            ORDER BY w.watch_date DESC
        `).all();
        res.json(rows);
    } catch (error) {
        console.error('Error fetching watched list:', error);
        res.status(500).json({ error: 'Failed to fetch watched list' });
    }
});

// PUT /api/watched/:tmdb_id
// Body: { user_rating, watch_date, rewatch, notes }
router.put('/:tmdb_id', (req, res) => {
    try {
        const { tmdb_id } = req.params;
        const { user_rating, watch_date, rewatch, notes } = req.body;

        if (user_rating === undefined || !watch_date) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const stmt = db.prepare(`
            UPDATE watched 
            SET user_rating = ?, watch_date = ?, rewatch = ?, notes = ?
            WHERE tmdb_id = ?
        `);

        const info = stmt.run(user_rating, watch_date, rewatch ? 1 : 0, notes, tmdb_id);
        
        if (info.changes === 0) {
            return res.status(404).json({ error: 'Movie not found in archive' });
        }

        invalidateCache('movie');
        res.json({ success: true });
    } catch (error) {
        console.error('Error updating watched movie:', error);
        res.status(500).json({ error: 'Failed to update movie' });
    }
});

// POST /api/watched/bulk
// Body: { entries: [{tmdb_id, user_rating}, ...] }
router.post('/bulk', async (req, res) => {
    const { entries } = req.body;
    if (!Array.isArray(entries) || entries.length === 0) {
        return res.status(400).json({ error: 'Array of entries required' });
    }

    let imported = 0;
    const today = new Date().toISOString().split('T')[0];

    try {
        for (const entry of entries) {
            if (!entry.tmdb_id || entry.user_rating === undefined || entry.user_rating === '') continue;

            // Ensure movie exists in cache
            let tmdb_rating = 0;
            const checkMovie = db.prepare('SELECT tmdb_rating FROM movies WHERE tmdb_id = ?').get(entry.tmdb_id);
            if (!checkMovie) {
                try {
                    const movieInfo = await fetchAndCacheMovie(entry.tmdb_id);
                    tmdb_rating = movieInfo.tmdb_rating;
                } catch (e) { continue; } // skip if tmdb fails
            } else {
                tmdb_rating = checkMovie.tmdb_rating;
            }

            const rating_diff = parseFloat(entry.user_rating) - tmdb_rating;

            // Upsert watched log
            const existing = db.prepare('SELECT id FROM watched WHERE tmdb_id = ?').get(entry.tmdb_id);
            if (existing) {
                db.prepare('UPDATE watched SET user_rating = ?, rating_diff = ? WHERE tmdb_id = ?')
                  .run(entry.user_rating, rating_diff, entry.tmdb_id);
            } else {
                db.prepare(`
                    INSERT INTO watched (tmdb_id, user_rating, rating_diff, watch_date, rewatch, notes)
                    VALUES (?, ?, ?, ?, ?, ?)
                `).run(entry.tmdb_id, entry.user_rating, rating_diff, today, 0, null);
            }
            imported++;
        }

        if (imported > 0) invalidateCache('movie');
        res.json({ success: true, imported });
    } catch (error) {
        console.error('Bulk save error:', error);
        res.status(500).json({ error: 'Failed to save bulk ratings' });
    }
});

module.exports = router;
