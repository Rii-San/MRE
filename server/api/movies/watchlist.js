const express = require('express');
const router = express.Router();
const wdb = require('../../db/watchlistDb');
const { invalidateWatchlist } = require('../../engine/cache');

// GET /api/watchlist
router.get('/', (req, res) => {
    try {
        const rows = wdb.prepare('SELECT * FROM watchlist ORDER BY added_date DESC').all();
        res.json(rows);
    } catch (error) {
        console.error('Error fetching watchlist:', error);
        res.status(500).json({ error: 'Failed to fetch watchlist' });
    }
});

// POST /api/watchlist
// Body: { tmdb_id, title, release_year, poster_path }
router.post('/', (req, res) => {
    const { tmdb_id, title, release_year, poster_path } = req.body;

    if (!tmdb_id || !title) {
        return res.status(400).json({ error: 'tmdb_id and title are required' });
    }

    try {
        const existing = wdb.prepare('SELECT tmdb_id FROM watchlist WHERE tmdb_id = ?').get(tmdb_id);
        if (existing) {
            return res.status(400).json({ error: 'Movie already in watchlist' });
        }

        const today = new Date().toISOString().split('T')[0];
        wdb.prepare(`
            INSERT INTO watchlist (tmdb_id, title, release_year, poster_path, added_date)
            VALUES (?, ?, ?, ?, ?)
        `).run(tmdb_id, title, release_year || null, poster_path || null, today);

        invalidateWatchlist('movie');
        res.json({ success: true });
    } catch (error) {
        console.error('Error adding to watchlist:', error);
        res.status(500).json({ error: 'Failed to add to watchlist' });
    }
});

// DELETE /api/watchlist/:tmdb_id
router.delete('/:tmdb_id', (req, res) => {
    try {
        const { tmdb_id } = req.params;
        const info = wdb.prepare('DELETE FROM watchlist WHERE tmdb_id = ?').run(tmdb_id);
        
        if (info.changes === 0) {
            return res.status(404).json({ error: 'Movie not found in watchlist' });
        }
        invalidateWatchlist('movie');
        res.json({ success: true });
    } catch (error) {
        console.error('Error removing from watchlist:', error);
        res.status(500).json({ error: 'Failed to remove from watchlist' });
    }
});

// GET /api/watchlist/export
router.get('/export', (req, res) => {
    try {
        const rows = wdb.prepare('SELECT * FROM watchlist ORDER BY added_date DESC').all();

        const exportData = {
            version: 1,
            exported_at: new Date().toISOString(),
            type: 'watchlist',
            count: rows.length,
            entries: rows
        };

        res.setHeader('Content-Disposition', `attachment; filename="mre_watchlist_${new Date().toISOString().slice(0,10)}.json"`);
        res.setHeader('Content-Type', 'application/json');
        res.json(exportData);
    } catch (error) {
        console.error('Watchlist export error:', error);
        res.status(500).json({ error: 'Failed to export watchlist' });
    }
});

// POST /api/watchlist/import
// Body: { entries: [...] }
router.post('/import', (req, res) => {
    const { entries, type } = req.body;

    if (!Array.isArray(entries) || type !== 'watchlist') {
        return res.status(400).json({ error: 'Invalid import file. Expected a watchlist JSON.' });
    }

    let imported = 0;
    let skipped = 0;
    const errors = [];

    const today = new Date().toISOString().split('T')[0];

    for (const entry of entries) {
        try {
            if (!entry.tmdb_id || !entry.title) {
                skipped++;
                continue;
            }

            const existing = wdb.prepare('SELECT tmdb_id FROM watchlist WHERE tmdb_id = ?').get(entry.tmdb_id);
            if (existing) {
                skipped++;
                continue;
            }

            wdb.prepare(`
                INSERT INTO watchlist (tmdb_id, title, release_year, poster_path, added_date)
                VALUES (?, ?, ?, ?, ?)
            `).run(entry.tmdb_id, entry.title, entry.release_year, entry.poster_path, entry.added_date || today);

            imported++;
        } catch (err) {
            errors.push(`Entry ${entry.title || entry.tmdb_id}: ${err.message}`);
        }
    }

    invalidateWatchlist('movie');
    res.json({
        success: true,
        imported,
        skipped,
        errors: errors.slice(0, 5)
    });
});

module.exports = router;
