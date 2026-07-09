const fs = require('fs');
const path = require('path');

const CACHE_FILE = path.join(__dirname, '../data/cluster_cache.json');

// In-memory cluster state
let clusterState = {
    tasteSummary: null,
    pendingItems: 0
};

// Load from disk on startup
try {
    if (fs.existsSync(CACHE_FILE)) {
        const data = fs.readFileSync(CACHE_FILE, 'utf8');
        clusterState = JSON.parse(data);
    }
} catch (e) {
    console.error('Failed to load cluster cache from disk:', e.message);
}

// Save to disk
function saveClusterState() {
    try {
        const dir = path.dirname(CACHE_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(CACHE_FILE, JSON.stringify(clusterState, null, 2), 'utf8');
    } catch (e) {
        console.error('Failed to save cluster cache to disk:', e.message);
    }
}

function getCachedTasteSummary() {
    return clusterState.tasteSummary;
}

function setCachedTasteSummary(summary) {
    clusterState.tasteSummary = summary;
    clusterState.pendingItems = 0; // Reset pending on fresh summary
    saveClusterState();
}

function incrementPendingItems() {
    clusterState.pendingItems += 1;
    saveClusterState();
    return clusterState.pendingItems;
}

function getPendingItemsCount() {
    return clusterState.pendingItems;
}

// Simple in-memory cache for the recommendation engine
const cache = {
    movie: {
        vocab: null,
        profileVec: null,
        denseProfileVec: null,
        watchedIds: null,
        watchlistIds: null,
        insightsResult: null,
        genreIDF: null
    },
    anime: {
        vocab: null,
        profileVec: null,
        denseProfileVec: null,
        watchedIds: null,
        watchlistIds: null,
        insightsResult: null,
        genreIDF: null
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

module.exports = { 
    cache, 
    invalidateCache, 
    invalidateWatchlist, 
    invalidateGenreIDF, 
    getCache, 
    getCachedTasteSummary, 
    setCachedTasteSummary,
    incrementPendingItems,
    getPendingItemsCount
};
