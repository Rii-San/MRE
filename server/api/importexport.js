const express = require('express');
const router = express.Router();
const db = require('../db/db');
const animeDb = require('../db/anime_db');
const wdb = require('../db/watchlistDb');
const awdb = require('../db/anime_watchlistDb');
const { fetchAndCacheMovie } = require('../tmdb');
const { invalidateCache } = require('../engine/cache');

// GET /api/export
// Returns the full archive as a downloadable JSON file
router.get('/', (req, res) => {
    try {
        const rows = db.prepare(`
            SELECT 
                m.tmdb_id, m.title, m.release_year, m.runtime, m.country,
                m.genres, m.keywords, m.tmdb_rating,
                m.director, m.top_cast, m.production_companies, m.original_language, m.adult,
                w.user_rating, w.rating_diff, w.watch_date, w.rewatch, w.notes
            FROM watched w
            JOIN movies m ON w.tmdb_id = m.tmdb_id
            ORDER BY w.watch_date DESC
        `).all();

        const exportData = {
            version: 1,
            exported_at: new Date().toISOString(),
            count: rows.length,
            entries: rows.map(r => ({
                ...r,
                genres: JSON.parse(r.genres || '[]'),
                keywords: JSON.parse(r.keywords || '[]'),
                top_cast: JSON.parse(r.top_cast || '[]'),
                production_companies: JSON.parse(r.production_companies || '[]'),
                rewatch: r.rewatch === 1
            }))
        };

        res.setHeader('Content-Disposition', `attachment; filename="mre_archive_${new Date().toISOString().slice(0,10)}.json"`);
        res.setHeader('Content-Type', 'application/json');
        res.json(exportData);
    } catch (error) {
        console.error('Export error:', error);
        res.status(500).json({ error: 'Failed to export archive' });
    }
});

// POST /api/import
// Body: { entries: [...] }  (same format as export)
router.post('/', async (req, res) => {
    const { entries } = req.body;

    if (!Array.isArray(entries) || entries.length === 0) {
        return res.status(400).json({ error: 'Invalid import file. Expected an array of entries.' });
    }

    let imported = 0;
    let skipped = 0;
    const errors = [];

    // Phase 1: Pre-fetch any uncached movies from TMDB (async, outside transaction)
    const validEntries = [];
    for (const entry of entries) {
        try {
            if (!entry.tmdb_id || entry.user_rating === undefined || !entry.watch_date) {
                skipped++;
                continue;
            }

            const existing = db.prepare('SELECT tmdb_id FROM movies WHERE tmdb_id = ?').get(entry.tmdb_id);
            if (!existing) {
                try {
                    await fetchAndCacheMovie(entry.tmdb_id);
                } catch {
                    // Fallback: insert from import data if TMDB fetch fails
                    db.prepare(`
                        INSERT OR IGNORE INTO movies (tmdb_id, title, release_year, runtime, country, genres, keywords, tmdb_rating, director, top_cast, production_companies, original_language, adult)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `).run(
                        entry.tmdb_id,
                        entry.title,
                        entry.release_year,
                        entry.runtime || null,
                        entry.country || null,
                        JSON.stringify(entry.genres || []),
                        JSON.stringify(entry.keywords || []),
                        entry.tmdb_rating || 0,
                        entry.director || null,
                        JSON.stringify(entry.top_cast || []),
                        JSON.stringify(entry.production_companies || []),
                        entry.original_language || null,
                        entry.adult !== undefined ? entry.adult : null
                    );
                }
            }
            validEntries.push(entry);
        } catch (err) {
            errors.push(`Entry ${entry.title || entry.tmdb_id}: ${err.message}`);
        }
    }

    // Phase 2: Batch all watched-entry DB writes in a single transaction
    const importTransaction = db.transaction(() => {
        let count = 0;
        for (const entry of validEntries) {
            const existingWatch = db.prepare(
                'SELECT id FROM watched WHERE tmdb_id = ? AND watch_date = ?'
            ).get(entry.tmdb_id, entry.watch_date);

            if (existingWatch) {
                skipped++;
                continue;
            }

            db.prepare(`
                INSERT INTO watched (tmdb_id, user_rating, rating_diff, watch_date, rewatch, notes)
                VALUES (?, ?, ?, ?, ?, ?)
            `).run(
                entry.tmdb_id,
                entry.user_rating,
                entry.rating_diff || (entry.user_rating - (entry.tmdb_rating || 0)),
                entry.watch_date,
                entry.rewatch ? 1 : 0,
                entry.notes || null
            );
            count++;
        }
        return count;
    });

    imported = importTransaction();
    
    if (imported > 0) invalidateCache('movie');

    res.json({
        success: true,
        imported,
        skipped,
        errors: errors.slice(0, 5) // cap error list
    });
});

module.exports = router;
