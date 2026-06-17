require('dotenv').config();
const fs = require('fs');
const path = require('path');

// Target inputs
const targetDb = process.argv[2]; // 'movie' or 'anime'
const csvPath = process.argv[3];

if (!targetDb || !csvPath) {
    console.error("Usage: node import_csv.js <movie|anime> <path_to_csv>");
    process.exit(1);
}

if (!fs.existsSync(csvPath)) {
    console.error(`File not found: ${csvPath}`);
    process.exit(1);
}

// Helpers
async function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// TMDB logic
async function fetchWithTMDBRetry(url, retries = 5) {
    for (let i = 0; i < retries; i++) {
        try {
            const res = await fetch(url);
            if (res.status === 429) {
                await delay(2000 * (i + 1));
                continue;
            }
            if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);
            return res;
        } catch (err) {
            if (i === retries - 1) throw err;
            await delay(1000 * (i + 1));
        }
    }
}

async function processMovie(title, rating, db, fetchAndCacheMovie) {
    const TMDB_API_KEY = process.env.TMDB_API_KEY;
    if (!TMDB_API_KEY) throw new Error("TMDB_API_KEY not set in .env");

    const url = `https://api.themoviedb.org/3/search/movie?query=${encodeURIComponent(title)}&api_key=${TMDB_API_KEY}`;
    const response = await fetchWithTMDBRetry(url);
    const data = await response.json();

    if (data.results && data.results.length > 0) {
        const tmdb_id = data.results[0].id;
        const matchedTitle = data.results[0].title;
        console.log(`   -> Found: ${matchedTitle} (ID: ${tmdb_id})`);

        // Cache rich data
        const movieInfo = await fetchAndCacheMovie(tmdb_id);
        const tmdb_rating = movieInfo.tmdb_rating || 0;
        const rating_diff = rating - tmdb_rating;
        const today = new Date().toISOString().split('T')[0];

        // Insert into watched
        const existing = db.prepare('SELECT id FROM watched WHERE tmdb_id = ?').get(tmdb_id);
        if (existing) {
            db.prepare('UPDATE watched SET user_rating = ?, rating_diff = ? WHERE tmdb_id = ?')
                .run(rating, rating_diff, tmdb_id);
        } else {
            db.prepare(`
                INSERT INTO watched (tmdb_id, user_rating, rating_diff, watch_date, rewatch, notes)
                VALUES (?, ?, ?, ?, ?, ?)
            `).run(tmdb_id, rating, rating_diff, today, 0, 'Imported via CSV script');
        }
        return true;
    } else {
        throw new Error("No match found on TMDB");
    }
}

// AniList logic
const ANILIST_SEARCH_QUERY = `
query ($search: String) {
  Page(page: 1, perPage: 1) {
    media(search: $search, type: ANIME, sort: SEARCH_MATCH) {
      id
      title { english romaji }
    }
  }
}
`;

async function processAnime(title, rating, db, fetchWithAniListRetry, fetchAndCacheAnime) {
    const res = await fetchWithAniListRetry(ANILIST_SEARCH_QUERY, { search: title });
    const media = res?.data?.Page?.media;

    if (media && media.length > 0) {
        const anilist_id = media[0].id;
        const matchedTitle = media[0].title.english || media[0].title.romaji;
        console.log(`   -> Found: ${matchedTitle} (ID: ${anilist_id})`);

        // Cache rich data
        await fetchAndCacheAnime(anilist_id);

        const today = new Date().toISOString().split('T')[0];

        // Insert into watched_anime
        // schema: anilist_id, user_rating, watch_date, notes
        const existing = db.prepare('SELECT id FROM watched_anime WHERE anilist_id = ?').get(anilist_id);
        if (existing) {
            db.prepare('UPDATE watched_anime SET user_rating = ? WHERE anilist_id = ?')
                .run(rating, anilist_id);
        } else {
            db.prepare(`
                INSERT INTO watched_anime (anilist_id, user_rating, watch_date, notes)
                VALUES (?, ?, ?, ?)
            `).run(anilist_id, rating, today, 'Imported via CSV script');
        }
        return true;
    } else {
        throw new Error("No match found on AniList");
    }
}

// Main Runner
async function run() {
    console.log(`Starting import for ${targetDb.toUpperCase()} from ${csvPath}...`);
    
    let db, fetchAndCacheMovie, fetchWithAniListRetry, fetchAndCacheAnime;
    
    if (targetDb === 'movie') {
        db = require('../server/db/db');
        const tmdb = require('../server/tmdb');
        fetchAndCacheMovie = tmdb.fetchAndCacheMovie;
    } else if (targetDb === 'anime') {
        db = require('../server/db/anime_db');
        const anilist = require('../server/anilist');
        fetchWithAniListRetry = anilist.fetchWithAniListRetry;
        fetchAndCacheAnime = anilist.fetchAndCacheAnime;
    } else {
        console.error("Invalid database type. Use 'movie' or 'anime'.");
        process.exit(1);
    }

    const lines = fs.readFileSync(csvPath, 'utf-8').split('\n').filter(l => l.trim() !== '');
    
    let successCount = 0;
    let failedLines = [];

    // Skip header line assuming "Name,Rating" structure
    const startIdx = lines[0].toLowerCase().includes('name') || lines[0].toLowerCase().includes('title') ? 1 : 0;

    for (let i = startIdx; i < lines.length; i++) {
        const line = lines[i].trim();
        const lastCommaIdx = line.lastIndexOf(',');
        if (lastCommaIdx === -1) continue;

        let title = line.substring(0, lastCommaIdx).trim();
        if (title.startsWith('"') && title.endsWith('"')) {
            title = title.substring(1, title.length - 1);
        }
        const rating = parseFloat(line.substring(lastCommaIdx + 1).trim()) || 0;

        console.log(`[${i - startIdx + 1}/${lines.length - startIdx}] Searching for: "${title}" (Rating: ${rating})`);

        try {
            if (targetDb === 'movie') {
                await processMovie(title, rating, db, fetchAndCacheMovie);
            } else {
                await processAnime(title, rating, db, fetchWithAniListRetry, fetchAndCacheAnime);
            }
            successCount++;
        } catch (e) {
            console.error(`   -> Error: ${e.message}`);
            failedLines.push({ title, reason: e.message });
        }
    }

    console.log(`\n=================================================`);
    console.log(`IMPORT COMPLETE`);
    console.log(`=================================================`);
    console.log(`✅ Successfully logged: ${successCount}`);
    console.log(`❌ Failed imports: ${failedLines.length}`);
    
    if (failedLines.length > 0) {
        console.log(`\nFailed Entries:`);
        failedLines.forEach((fail, idx) => {
            console.log(`  ${idx + 1}. "${fail.title}" - ${fail.reason}`);
        });
    }
}

run();
