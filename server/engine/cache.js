// Simple in-memory cache for the recommendation engine
const cache = {
    movie: {
        vocab: null,
        profileVec: null,
        denseProfileVec: null,
        watchedIds: null,      // Set of watched tmdb_ids — used by discover for exclusion
        watchlistIds: null,    // Set of watchlist tmdb_ids — used by discover for exclusion
        insightsResult: null,  // Precomputed insights response
        genreIDF: null         // Genre IDF map — used by fetchAndCacheMovie + sync
    },
    anime: {
        vocab: null,
        profileVec: null,
        denseProfileVec: null,
        watchedIds: null,      // Set of watched anilist_ids
        watchlistIds: null,    // Set of watchlist anilist_ids
        insightsResult: null,  // Precomputed anime insights response
        genreIDF: null         // Genre IDF map — used by fetchAndCacheAnime + sync
    }
};

function invalidateKeys(domain, keys) {
    ['movie', 'anime'].filter(d => domain === d || domain === 'all').forEach(d => {
        keys.forEach(k => cache[d][k] = null);
    });
}

function invalidateCache(domain = 'movie') {
    invalidateKeys(domain, ['vocab', 'profileVec', 'denseProfileVec', 'watchedIds', 'insightsResult']);
}

function invalidateWatchlist(domain = 'movie') {
    invalidateKeys(domain, ['watchlistIds']);
}

function invalidateGenreIDF(domain = 'movie') {
    invalidateKeys(domain, ['genreIDF']);
}

function getCache(domain) {
    return cache[domain];
}

module.exports = { cache, invalidateCache, invalidateWatchlist, invalidateGenreIDF, getCache };
