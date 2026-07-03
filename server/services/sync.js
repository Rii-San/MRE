const db = require('../db/db');
const logger = require('../utils/logger');
const { getEmbedding } = require('../llm');
const { fetchWithRetry, fetchWikipediaPlot } = require('../tmdb');
const { selectPrimaryGenres, computeGenreIDF } = require('../engine/genre_utils');
const { getCache, invalidateGenreIDF } = require('../engine/cache');


const { createSyncLoop } = require('./syncFactory');

const syncLoop = createSyncLoop({
    name: 'Sync',
    getItemsQuery: () => db.prepare(`SELECT * FROM movies WHERE (plot_embedding IS NULL OR overview IS NULL OR overview = '' OR director IS NULL OR top_cast IS NULL OR production_companies IS NULL OR original_language IS NULL OR adult IS NULL OR primary_genres IS NULL) OR (last_updated IS NULL) OR (last_updated < datetime('now', '-30 days'))`).all(),
    getId: m => m.tmdb_id,
    getTitle: m => m.title,
    getPlot: m => null, // Never return TMDB overview for embedding
    fetchDetails: async (m) => {
        let needsApiFetch = !m.overview || !m.director || !m.top_cast || !m.production_companies || !m.original_language || m.adult === null || !m.primary_genres || !m.last_updated;
        if (!needsApiFetch && m.last_updated) {
            // Check if older than 30 days using basic date logic
            const lastUpdated = new Date(m.last_updated + 'Z'); // treat as UTC
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
            if (lastUpdated < thirtyDaysAgo) needsApiFetch = true;
        }
        
        let wikiPlot = null;
        if (!m.plot_embedding) {
             wikiPlot = await fetchWikipediaPlot(m.title, m.release_year);
        }

        if (!needsApiFetch) return wikiPlot;

        try {
            const TMDB_API_KEY = process.env.TMDB_API_KEY;
            const res = await fetchWithRetry(`https://api.themoviedb.org/3/movie/${m.tmdb_id}?api_key=${TMDB_API_KEY}&append_to_response=credits,keywords`);
            const data = await res.json();
            
            const overview = data.overview || '';
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
                SET overview = ?, director = ?, top_cast = ?, production_companies = ?, original_language = ?, adult = ?, keywords = ?, genres = ?, collection_id = ?, collection_name = ?, primary_genres = ?, last_updated = datetime('now')
                WHERE tmdb_id = ?
            `).run(overview, director, top_cast, production_companies, original_language, adult, keywords, genres, collection_id, collection_name, primary_genres, m.tmdb_id);
            invalidateGenreIDF('movie');
            
            return wikiPlot;
        } catch (e) {
            logger.warn(`Failed to fetch TMDB API for ${m.title}`, 'Sync');
            return null;
        }
    },
    updateEmbedding: (id, embedStr) => {
        db.prepare('UPDATE movies SET plot_embedding = ? WHERE tmdb_id = ?').run(embedStr, id);
    },
    checkMissing: (id) => {
        const updatedM = db.prepare('SELECT * FROM movies WHERE tmdb_id = ?').get(id);
        return !updatedM || (!updatedM.overview || updatedM.overview === '' || !updatedM.director || !updatedM.top_cast || !updatedM.production_companies || !updatedM.original_language || updatedM.adult === null || !updatedM.plot_embedding || !updatedM.primary_genres);
    },
    deleteItem: (id) => {
        try { db.prepare('DELETE FROM watched WHERE tmdb_id = ?').run(id); } catch(e) {}
        db.prepare('DELETE FROM movies WHERE tmdb_id = ?').run(id);
    }
});

module.exports = { 
    startSyncLoop: syncLoop.startSyncLoop, 
    getSyncStatus: syncLoop.getSyncStatus 
};
