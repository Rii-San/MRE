const db = require('../db/anime_db');
const logger = require('../utils/logger');
const { getEmbedding } = require('../llm');
const { fetchWithAniListRetry, fetchAndCacheAnime } = require('../anilist');

const { createSyncLoop } = require('./syncFactory');

const syncLoop = createSyncLoop({
    name: 'Anime Sync',
    getItemsQuery: () => db.prepare(`SELECT * FROM anime WHERE plot_embedding IS NULL OR description IS NULL OR description = '' OR primary_genres IS NULL OR franchise_group_id IS NULL`).all(),
    getId: a => a.anilist_id,
    getTitle: a => a.title_english || a.title_romaji || a.anilist_id,
    getPlot: a => a.description,
    fetchDetails: async (a) => {
        let needsFetch = !a.description || !a.genres || !a.tags || !a.primary_genres || a.franchise_group_id === null;
        if (!needsFetch) return a.description;

        try {
            const fetched = await fetchAndCacheAnime(a.anilist_id);
            return fetched.description;
        } catch (e) {
            logger.warn(`Failed to fetch AniList for ${a.title_english || a.anilist_id}`, 'Anime Sync');
            return null;
        }
    },
    updateEmbedding: (id, embedStr) => {
        db.prepare('UPDATE anime SET plot_embedding = ? WHERE anilist_id = ?').run(embedStr, id);
    },
    checkMissing: (id) => {
        const updatedA = db.prepare('SELECT * FROM anime WHERE anilist_id = ?').get(id);
        return !updatedA || (!updatedA.description || updatedA.description === '' || !updatedA.plot_embedding || !updatedA.primary_genres || updatedA.franchise_group_id === null);
    },
    deleteItem: (id) => {
        try { db.prepare('DELETE FROM watched_anime WHERE anilist_id = ?').run(id); } catch(e) {}
        db.prepare('DELETE FROM anime WHERE anilist_id = ?').run(id);
    }
});

module.exports = { 
    startAnimeSyncLoop: syncLoop.startSyncLoop, 
    getAnimeSyncStatus: syncLoop.getSyncStatus 
};
