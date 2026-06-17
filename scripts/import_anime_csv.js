const fs = require('fs');
const path = require('path');
const db = require('../server/anime_db');
const { fetchWithAniListRetry, fetchAndCacheAnime } = require('../server/anilist');

const SEARCH_QUERY = `
query ($search: String) {
  Page(page: 1, perPage: 1) {
    media(search: $search, type: ANIME, sort: SEARCH_MATCH) {
      id
      title { english romaji }
    }
  }
}
`;

async function runImport() {
    const importDir = path.join(__dirname, '..', 'anime_import_one_time');
    if (!fs.existsSync(importDir)) {
        console.error(`Directory not found: ${importDir}`);
        return;
    }

    const filePath = path.join(importDir, 'anime_list.csv');
    if (!fs.existsSync(filePath)) {
        console.error(`anime_list.csv not found in ${importDir}`);
        return;
    }

    console.log(`Starting import from: ${filePath}`);

    const lines = fs.readFileSync(filePath, 'utf-8').split('\n').filter(l => l.trim() !== '');

    let successCount = 0;
    let failCount = 0;

    // Skip header line (Anime Name,Rating)
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        
        // Handle CSV format: Title,Rating
        const lastCommaIdx = line.lastIndexOf(',');
        if (lastCommaIdx === -1) continue; // Skip malformed lines

        let title = line.substring(0, lastCommaIdx).trim();
        // Remove quotes if they exist around the title
        if (title.startsWith('"') && title.endsWith('"')) {
            title = title.substring(1, title.length - 1);
        }
        
        const ratingStr = line.substring(lastCommaIdx + 1).trim();
        const rating = parseFloat(ratingStr) || 7.5;

        console.log(`[${i}/${lines.length - 1}] Searching AniList for: "${title}" (Rating: ${rating})`);

        try {
            const res = await fetchWithAniListRetry(SEARCH_QUERY, { search: title });
            const media = res?.data?.Page?.media;

            if (media && media.length > 0) {
                const anilist_id = media[0].id;
                const matchedTitle = media[0].title.english || media[0].title.romaji;
                
                console.log(`   -> Found: ${matchedTitle} (ID: ${anilist_id})`);

                // CRITICAL FIX: Fetch and cache into the 'anime' table first so the FOREIGN KEY constraint passes
                try {
                    await fetchAndCacheAnime(anilist_id);
                } catch(e) {
                    console.error(`   -> Failed to fetch rich details for ${matchedTitle}, skipping insert to avoid constraint error.`);
                    failCount++;
                    continue; 
                }

                // Insert into watched_anime
                const insertStmt = db.prepare(`
                    INSERT OR REPLACE INTO watched_anime (anilist_id, user_rating, watch_date, notes)
                    VALUES (?, ?, ?, ?)
                `);
                insertStmt.run(anilist_id, rating, new Date().toISOString().split('T')[0], 'Imported via CSV script');
                
                successCount++;
            } else {
                console.log(`   -> No match found for: ${title}`);
                failCount++;
            }
        } catch (e) {
            console.error(`   -> Error processing ${title}: ${e.message}`);
            failCount++;
        }
    }

    console.log(`\nImport complete!`);
    console.log(`✅ Successfully logged: ${successCount}`);
    console.log(`❌ Failed to match: ${failCount}`);
    console.log(`The background Anime Sync loop will now generate AI embeddings for these shows.`);
}

runImport();
