require('dotenv').config();
const db = require('./server/db/db');
const { fetchWithRetry } = require('./server/tmdb');

async function run() {
    const movies = db.prepare("SELECT tmdb_id FROM movies WHERE poster_path IS NULL").all();
    console.log(`Found ${movies.length} movies without posters.`);
    const TMDB_API_KEY = process.env.TMDB_API_KEY;
    
    if (!TMDB_API_KEY) {
        console.log("No TMDB_API_KEY found. Make sure .env is set.");
        return;
    }

    let updated = 0;
    for (const m of movies) {
        try {
            const res = await fetchWithRetry(`https://api.themoviedb.org/3/movie/${m.tmdb_id}?api_key=${TMDB_API_KEY}`);
            const data = await res.json();
            if (data.poster_path) {
                db.prepare("UPDATE movies SET poster_path = ? WHERE tmdb_id = ?").run(data.poster_path, m.tmdb_id);
                updated++;
                console.log(`Updated poster for ${data.title}`);
            }
        } catch(e) {
            console.log(`Failed to update ${m.tmdb_id}: ${e.message}`);
        }
    }
    console.log(`Done. Updated ${updated} movie posters.`);
}
run();
