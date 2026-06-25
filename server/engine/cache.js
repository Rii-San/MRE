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

function invalidateCache(domain = 'movie') {
    if (domain === 'movie' || domain === 'all') {
        cache.movie.vocab = null;
        cache.movie.profileVec = null;
        cache.movie.denseProfileVec = null;
        cache.movie.watchedIds = null;
        cache.movie.insightsResult = null;
    }
    if (domain === 'anime' || domain === 'all') {
        cache.anime.vocab = null;
        cache.anime.profileVec = null;
        cache.anime.denseProfileVec = null;
        cache.anime.watchedIds = null;
        cache.anime.insightsResult = null;
    }
}

function invalidateWatchlist(domain = 'movie') {
    if (domain === 'movie' || domain === 'all') {
        cache.movie.watchlistIds = null;
    }
    if (domain === 'anime' || domain === 'all') {
        cache.anime.watchlistIds = null;
    }
}

function invalidateGenreIDF(domain = 'movie') {
    if (domain === 'movie' || domain === 'all') {
        cache.movie.genreIDF = null;
    }
    if (domain === 'anime' || domain === 'all') {
        cache.anime.genreIDF = null;
    }
}

function getCache(domain) {
    return cache[domain];
}

module.exports = { cache, invalidateCache, invalidateWatchlist, invalidateGenreIDF, getCache };
