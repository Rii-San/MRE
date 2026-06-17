const express = require('express');
const router = express.Router();
const db = require('../../db/anime_db');
const { fetchAndCacheAnime } = require('../../anilist');
const { invalidateCache } = require('../../engine/cache');

// POST /api/anime_watched
router.post('/', async (req, res) => {
    try {
        const { user_rating, watch_date, notes, title, poster_path } = req.body;
        // Frontend sends tmdb_id generically
        const anilist_id = req.body.anilist_id || req.body.tmdb_id;

        if (!anilist_id || user_rating === undefined) {
            return res.status(400).json({ error: 'anilist_id and user_rating are required' });
        }

        const checkAnime = db.prepare('SELECT average_score FROM anime WHERE anilist_id = ?').get(anilist_id);
        
        if (!checkAnime) {
            await fetchAndCacheAnime(anilist_id);
        }

        const insertWatched = db.prepare(`
            INSERT INTO watched_anime (anilist_id, user_rating, watch_date, notes)
            VALUES (?, ?, ?, ?)
        `);

        const result = insertWatched.run(
            anilist_id, 
            user_rating, 
            watch_date || new Date().toISOString().split('T')[0], 
            notes || null
        );

        invalidateCache('anime');
        res.json({ success: true, id: result.lastInsertRowid });
    } catch (error) {
        console.error('Error adding to anime archive:', error);
        res.status(500).json({ error: 'Failed to add watched anime', details: error.message });
    }
});

// GET /api/anime_watched
router.get('/', (req, res) => {
    try {
        const rows = db.prepare(`
            SELECT w.id, w.anilist_id, w.user_rating, w.watch_date, w.notes,
                   a.title_english, a.title_romaji, a.release_year, a.cover_image, a.average_score
            FROM watched_anime w
            JOIN anime a ON w.anilist_id = a.anilist_id
            ORDER BY w.watch_date DESC, w.id DESC
        `).all();
        res.json(rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to fetch anime archive' });
    }
});

// PUT /api/anime_watched/:id
router.put('/:id', (req, res) => {
    try {
        const { user_rating, watch_date, notes } = req.body;
        const anilist_id = req.params.id;

        const stmt = db.prepare(`
            UPDATE watched_anime 
            SET user_rating = ?, watch_date = ?, notes = ?
            WHERE anilist_id = ?
        `);
        const info = stmt.run(user_rating, watch_date, notes, anilist_id);

        if (info.changes === 0) {
            return res.status(404).json({ error: 'Log not found' });
        }

        invalidateCache('anime');
        res.json({ success: true });
    } catch (error) {
        console.error('Error updating anime log:', error);
        res.status(500).json({ error: 'Failed to update anime log' });
    }
});

// DELETE /api/anime_watched/:id
router.delete('/:id', (req, res) => {
    try {
        const stmt = db.prepare('DELETE FROM watched_anime WHERE anilist_id = ?');
        const info = stmt.run(req.params.id);
        if (info.changes === 0) {
            return res.status(404).json({ error: 'Log not found' });
        }
        invalidateCache('anime');
        res.json({ success: true });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to delete anime log' });
    }
});

module.exports = router;
