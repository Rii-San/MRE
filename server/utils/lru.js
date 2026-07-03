const { LRUCache } = require('lru-cache');

// Cache for TMDB Deep Fetch Details (Movie ID -> metadata object)
const tmdbCache = new LRUCache({
    max: 500, // Maximum items
    ttl: 1000 * 60 * 60 * 24 // 24 hours (optional, for safety)
});

// Cache for Nomic Embeddings (Plot Description -> Vector Float Array)
const embeddingCache = new LRUCache({
    max: 1000,
    ttl: 1000 * 60 * 60 * 24 * 7 // 7 days (essentially permanent during a session)
});

module.exports = {
    tmdbCache,
    embeddingCache
};
