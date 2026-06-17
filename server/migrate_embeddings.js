require('dotenv').config();
const db = require('./db');
const { getEmbedding } = require('./llm');
const { fetchWithRetry } = require('./tmdb');

async function migrate() {
    console.log("Starting embedding backfill...");
    const movies = db.prepare('SELECT tmdb_id, title, overview FROM movies WHERE plot_embedding IS NULL').all();
    
    if (movies.length === 0) {
        console.log("All movies already have embeddings!");
        process.exit(0);
    }

    console.log(`Found ${movies.length} movies needing embeddings.`);
    
    let count = 0;
    for (const m of movies) {
        console.log(`Processing: ${m.title}`);
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
                console.log(`  Failed to fetch overview for ${m.title}`);
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
                    console.log(`  LM Studio returned empty embedding for ${m.title}`);
                }
            } catch (e) {
                console.log(`  Failed to get embedding for ${m.title}:`, e.message);
            }
        } else {
            console.log(`  No overview available for ${m.title}`);
        }
        
        // Slight delay to not hammer the local LLM too hard
        await new Promise(r => setTimeout(r, 200));
    }
    
    console.log(`\nMigration complete. Successfully added embeddings for ${count}/${movies.length} movies.`);
    process.exit(0);
}

migrate();
