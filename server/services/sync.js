const db = require('../db/db');
const { getEmbedding } = require('../llm');
const { fetchWithRetry } = require('../tmdb');

let status = {
    running: false,
    remaining: 0,
    currentMovie: null
};

let currentInterval = 2000;
let noHitCount = 0;

// Keep track of IDs that we've already processed in this session so we don't infinitely loop on them if TMDB lacks the data
const processedIds = new Set();

async function processNext() {
    try {
        let query = `SELECT * FROM movies WHERE (plot_embedding IS NULL OR overview IS NULL OR overview = '' OR director IS NULL OR top_cast IS NULL OR production_companies IS NULL OR original_language IS NULL OR adult IS NULL)`;
        let params = [];
        
        if (processedIds.size > 0) {
            let placeholders = Array.from(processedIds).map(() => '?').join(',');
            query += ` AND tmdb_id NOT IN (${placeholders})`;
            params = Array.from(processedIds);
        }
        
        const moviesToSync = db.prepare(query).all(...params);
        status.remaining = moviesToSync.length;

        if (moviesToSync.length === 0) {
            status.running = false;
            status.currentMovie = null;
            
            noHitCount++;
            if (noHitCount >= 3) {
                currentInterval = Math.min(currentInterval * 2, 32000);
                noHitCount = 0;
            }
            
            setTimeout(processNext, currentInterval);
            return;
        }

        noHitCount = 0;
        currentInterval = Math.max(currentInterval / 2, 2000);

        status.running = true;
        const m = moviesToSync[0];
        status.currentMovie = m.title;

        console.log(`[Sync] Repairing data for: ${m.title}`);
        
        let needsApiFetch = false;
        if (!m.overview || !m.director || !m.top_cast || !m.production_companies || !m.original_language || m.adult === null) {
            needsApiFetch = true;
        }

        let overview = m.overview;

        if (needsApiFetch) {
            try {
                const TMDB_API_KEY = process.env.TMDB_API_KEY;
                const res = await fetchWithRetry(`https://api.themoviedb.org/3/movie/${m.tmdb_id}?api_key=${TMDB_API_KEY}&append_to_response=credits,keywords`);
                const data = await res.json();
                
                overview = data.overview || '';
                const director = data.credits?.crew?.find(c => c.job === 'Director')?.name || null;
                const top_cast = JSON.stringify(data.credits?.cast?.slice(0, 5).map(c => c.name) || []);
                const production_companies = JSON.stringify(data.production_companies?.map(p => p.name) || []);
                const original_language = data.original_language || null;
                const adult = data.adult ? 1 : 0;
                const keywords = JSON.stringify(data.keywords?.keywords?.map(k => k.name) || []);
                const genres = JSON.stringify(data.genres?.map(g => g.name) || []);

                db.prepare(`
                    UPDATE movies 
                    SET overview = ?, director = ?, top_cast = ?, production_companies = ?, original_language = ?, adult = ?, keywords = ?, genres = ?
                    WHERE tmdb_id = ?
                `).run(overview, director, top_cast, production_companies, original_language, adult, keywords, genres, m.tmdb_id);
                
            } catch (e) {
                console.log(`[Sync] Failed to fetch TMDB API for ${m.title}`);
            }
        }

        if (overview && !m.plot_embedding) {
            try {
                const embedArr = await getEmbedding(overview);
                if (embedArr) {
                    const embedStr = JSON.stringify(embedArr);
                    db.prepare('UPDATE movies SET plot_embedding = ? WHERE tmdb_id = ?').run(embedStr, m.tmdb_id);
                } else {
                    console.log(`[Sync] Embedding model returned empty for ${m.title}`);
                }
            } catch (e) {
                console.log(`[Sync] Failed to get embedding for ${m.title}`);
            }
        }

        // Always add to processedIds so we don't retry it infinitely if it legitimately lacks TMDB data
        processedIds.add(m.tmdb_id);

    } catch (err) {
        console.error("[Sync] Loop error:", err);
    }

    // Process next after currentInterval delay
    setTimeout(processNext, currentInterval);
}

function startSyncLoop() {
    console.log("[Sync] Background repair loop started.");
    processNext();
}

function getSyncStatus() {
    return status;
}

module.exports = { startSyncLoop, getSyncStatus };
