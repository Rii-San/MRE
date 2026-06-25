const db = require('../db/db');
const { getEmbedding } = require('../llm');
const { fetchWithRetry } = require('../tmdb');
const { selectPrimaryGenres, computeGenreIDF } = require('../engine/genre_utils');
const { getCache, invalidateGenreIDF } = require('../engine/cache');

let status = {
    running: false,
    remaining: 0,
    currentMovie: null
};

let currentInterval = 2000;
let noHitCount = 0;

// Keep track of attempts so we can remove items that consistently fail
const syncAttempts = new Map();

async function processNext() {
    try {
        let query = `SELECT * FROM movies WHERE (plot_embedding IS NULL OR overview IS NULL OR overview = '' OR director IS NULL OR top_cast IS NULL OR production_companies IS NULL OR original_language IS NULL OR adult IS NULL OR primary_genres IS NULL)`;
        let params = [];
        
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
        if (!m.overview || !m.director || !m.top_cast || !m.production_companies || !m.original_language || m.adult === null || !m.primary_genres) {
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
                const genreNames = data.genres?.map(g => g.name) || [];
                const genres = JSON.stringify(genreNames);
                const collection_id = data.belongs_to_collection?.id || null;
                const collection_name = data.belongs_to_collection?.name || null;

                // Compute primary genres
                const movieCache = getCache('movie');
                let genreIDF = movieCache.genreIDF;
                if (!genreIDF) {
                    const allGenreRows = db.prepare('SELECT genres FROM movies WHERE genres IS NOT NULL').all();
                    const allGenreArrays = allGenreRows.map(r => { try { return JSON.parse(r.genres); } catch(e) { return []; } });
                    genreIDF = computeGenreIDF(allGenreArrays);
                    movieCache.genreIDF = genreIDF;
                }
                const primary_genres = JSON.stringify(selectPrimaryGenres(genreNames, genreIDF, 2));

                db.prepare(`
                    UPDATE movies 
                    SET overview = ?, director = ?, top_cast = ?, production_companies = ?, original_language = ?, adult = ?, keywords = ?, genres = ?, collection_id = ?, collection_name = ?, primary_genres = ?
                    WHERE tmdb_id = ?
                `).run(overview, director, top_cast, production_companies, original_language, adult, keywords, genres, collection_id, collection_name, primary_genres, m.tmdb_id);
                invalidateGenreIDF('movie');
                
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

        // Check if it's still missing data after our attempts
        const updatedM = db.prepare('SELECT * FROM movies WHERE tmdb_id = ?').get(m.tmdb_id);
        const stillMissing = !updatedM || (!updatedM.overview || updatedM.overview === '' || !updatedM.director || !updatedM.top_cast || !updatedM.production_companies || !updatedM.original_language || updatedM.adult === null || !updatedM.plot_embedding || !updatedM.primary_genres);

        if (stillMissing) {
            let attempts = syncAttempts.get(m.tmdb_id) || 0;
            attempts++;
            
            if (attempts >= 3) {
                console.log(`[Sync] Deleting ${m.title} after 3 failed attempts to fetch complete details.`);
                try {
                    db.prepare('DELETE FROM watched WHERE tmdb_id = ?').run(m.tmdb_id);
                } catch(e) {}
                db.prepare('DELETE FROM movies WHERE tmdb_id = ?').run(m.tmdb_id);
                syncAttempts.delete(m.tmdb_id);
            } else {
                syncAttempts.set(m.tmdb_id, attempts);
            }
        } else {
            // Success, remove from tracking
            syncAttempts.delete(m.tmdb_id);
        }

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
