const db = require('../db/anime_db');
const { getEmbedding } = require('../llm');
const { fetchWithAniListRetry, fetchAndCacheAnime } = require('../anilist');

let status = {
    running: false,
    remaining: 0,
    currentAnime: null
};

let currentInterval = 2000;
let noHitCount = 0;

const syncAttempts = new Map();

async function processNextAnime() {
    try {
        let query = `SELECT * FROM anime WHERE plot_embedding IS NULL OR description IS NULL OR description = '' OR primary_genres IS NULL OR franchise_group_id IS NULL`;
        let params = [];
        
        const animeToSync = db.prepare(query).all(...params);
        status.remaining = animeToSync.length;

        if (animeToSync.length === 0) {
            status.running = false;
            status.currentAnime = null;
            
            noHitCount++;
            if (noHitCount >= 3) {
                currentInterval = Math.min(currentInterval * 2, 32000);
                noHitCount = 0;
            }
            
            setTimeout(processNextAnime, currentInterval);
            return;
        }

        noHitCount = 0;
        currentInterval = Math.max(currentInterval / 2, 2000);

        status.running = true;
        const a = animeToSync[0];
        status.currentAnime = a.title_english || a.title_romaji || a.anilist_id;

        console.log(`[Anime Sync] Repairing data for: ${status.currentAnime}`);
        
        let description = a.description;
        let needsFetch = !a.description || !a.genres || !a.tags || !a.primary_genres || a.franchise_group_id === null;

        if (needsFetch) {
            try {
                // fetchAndCacheAnime automatically updates the database with all fields
                const fetched = await fetchAndCacheAnime(a.anilist_id);
                description = fetched.description;
            } catch (e) {
                console.log(`[Anime Sync] Failed to fetch AniList for ${status.currentAnime}`);
            }
        }

        if (description && !a.plot_embedding) {
            try {
                const embedArr = await getEmbedding(description);
                if (embedArr) {
                    const embedStr = JSON.stringify(embedArr);
                    db.prepare('UPDATE anime SET plot_embedding = ? WHERE anilist_id = ?').run(embedStr, a.anilist_id);
                } else {
                    console.log(`[Anime Sync] Embedding model returned empty for ${status.currentAnime}`);
                }
            } catch (e) {
                console.log(`[Anime Sync] Failed to get embedding for ${status.currentAnime}`);
            }
        }

        const updatedA = db.prepare('SELECT * FROM anime WHERE anilist_id = ?').get(a.anilist_id);
        const stillMissing = !updatedA || (!updatedA.description || updatedA.description === '' || !updatedA.plot_embedding || !updatedA.primary_genres || updatedA.franchise_group_id === null);

        if (stillMissing) {
            let attempts = syncAttempts.get(a.anilist_id) || 0;
            attempts++;
            
            if (attempts >= 3) {
                console.log(`[Anime Sync] Deleting ${status.currentAnime} after 3 failed attempts to fetch details.`);
                try {
                    db.prepare('DELETE FROM watched_anime WHERE anilist_id = ?').run(a.anilist_id);
                } catch(e) {}
                db.prepare('DELETE FROM anime WHERE anilist_id = ?').run(a.anilist_id);
                syncAttempts.delete(a.anilist_id);
            } else {
                syncAttempts.set(a.anilist_id, attempts);
            }
        } else {
            syncAttempts.delete(a.anilist_id);
        }

    } catch (err) {
        console.error("[Anime Sync] Loop error:", err);
    }

    // Process next after currentInterval delay
    setTimeout(processNextAnime, currentInterval);
}

function startAnimeSyncLoop() {
    console.log("[Anime Sync] Background repair loop started.");
    processNextAnime();
}

function getAnimeSyncStatus() {
    return status;
}

module.exports = { startAnimeSyncLoop, getAnimeSyncStatus };
