require('dotenv').config();
const db = require('./db/db'); // fixed path just in case
const logger = require('./utils/logger');
const { getEmbedding } = require('./llm');
const { fetchWithRetry } = require('./tmdb');

async function migrate() {
    logger.info("Starting embedding backfill...", 'Migrate');
    const movies = db.prepare('SELECT tmdb_id, title, overview FROM movies WHERE plot_embedding IS NULL').all();
    
    if (movies.length === 0) {
        logger.info("All movies already have embeddings!", 'Migrate');
        process.exit(0);
    }

    logger.info(`Found ${movies.length} movies needing embeddings.`, 'Migrate');
    
    let count = 0;
    for (const m of movies) {
        logger.info(`Processing: ${m.title}`, 'Migrate');
        let overview = m.overview;
        
        // If overview is missing (because we didn't save it before), fetch it
        if (!overview) {
            try {
                const TMDB_API_KEY = process.env.TMDB_API_KEY;
                const res = await fetchWithRetry(`https://api.themoviedb.org/3/movie/${m.tmdb_id}?api_key=${TMDB_API_KEY}`);
                const data = await res.json();
                overview = data.overview || '';
                
                // Update overview in DB
                db.prepare('UPDATE movies SET overview = ? WHERE tmdb_id = ?').run(overview, m.tmdb_id);
            } catch (e) {
                logger.warn(`Failed to fetch overview for ${m.title}`, 'Migrate');
                continue;
            }
        }

        if (overview) {
            try {
                const embedArr = await getEmbedding(overview);
                if (embedArr) {
                    const embedStr = JSON.stringify(embedArr);
                    db.prepare('UPDATE movies SET plot_embedding = ? WHERE tmdb_id = ?').run(embedStr, m.tmdb_id);
                    count++;
                } else {
                    logger.warn(`Model returned empty embedding for ${m.title}`, 'Migrate');
                }
            } catch (e) {
                logger.error(`Failed to get embedding for ${m.title}: ${e.message}`, 'Migrate');
            }
        } else {
            logger.warn(`No overview available for ${m.title}`, 'Migrate');
        }
        
        // Slight delay to not hammer the local LLM too hard
        await new Promise(r => setTimeout(r, 200));
    }
    
    logger.info(`\nMigration complete. Successfully added embeddings for ${count}/${movies.length} movies.`, 'Migrate');
    process.exit(0);
}

migrate();
