// Simple in-memory cache for the recommendation engine
const cache = {
    movie: {
        vocab: null,
        profileVec: null,
        denseProfileVec: null
    },
    anime: {
        vocab: null,
        profileVec: null,
        denseProfileVec: null
    }
};

function invalidateCache(domain = 'movie') {
    if (domain === 'movie' || domain === 'all') {
        cache.movie.vocab = null;
        cache.movie.profileVec = null;
        cache.movie.denseProfileVec = null;
    }
    if (domain === 'anime' || domain === 'all') {
        cache.anime.vocab = null;
        cache.anime.profileVec = null;
        cache.anime.denseProfileVec = null;
    }
}

function getCache(domain) {
    return cache[domain];
}

module.exports = { cache, invalidateCache, getCache };
