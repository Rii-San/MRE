const express = require('express');
const router = express.Router();
const wdb = require('../../db/anime_watchlistDb');

router.get('/', (req, res) => {
    try {
        const rows = wdb.prepare('SELECT * FROM watchlist_anime ORDER BY added_date DESC').all();
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch anime watchlist' });
    }
});

router.post('/', (req, res) => {
    const anilist_id = req.body.anilist_id || req.body.tmdb_id;
    const title_english = req.body.title_english || req.body.title;
    const title_romaji = req.body.title_romaji || req.body.title;
    const release_year = req.body.release_year;
    const cover_image = req.body.cover_image || req.body.poster_path;

    if (!anilist_id || !title_english) {
        return res.status(400).json({ error: 'anilist_id and title are required' });
    }

    try {
        const stmt = wdb.prepare(`
            INSERT OR REPLACE INTO watchlist_anime (anilist_id, title_english, title_romaji, release_year, cover_image, added_date)
            VALUES (?, ?, ?, ?, ?, ?)
        `);
        stmt.run(anilist_id, title_english, title_romaji, release_year, cover_image, new Date().toISOString());
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to add to anime watchlist' });
    }
});

router.delete('/:id', (req, res) => {
    try {
        wdb.prepare('DELETE FROM watchlist_anime WHERE anilist_id = ?').run(req.params.id);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to remove from anime watchlist' });
    }
});

module.exports = router;
