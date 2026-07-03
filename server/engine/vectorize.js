const { createVectorizer } = require('./vectorizerFactory');

const movieVectorizer = createVectorizer({
    domain: 'movie',
    getRowsQuery: `
        SELECT COALESCE(m.primary_genres, m.genres) as active_genres, m.keywords, m.country, m.director, m.top_cast, m.production_companies, m.original_language 
        FROM watched w 
        JOIN movies m ON w.tmdb_id = m.tmdb_id
    `,
    features: [
        { name: 'genres', column: 'active_genres', type: 'json_array', weight: 1.0, label: 'Genre', valueAccessor: m => m.primary_genres ? m.primary_genres : m.genres },
        { name: 'keywords', column: 'keywords', type: 'json_array', topN: 100, weight: 1.2, label: 'Tag' },
        { name: 'countries', column: 'country', type: 'scalar', weight: 0.5, label: 'Country' },
        { name: 'directors', column: 'director', type: 'scalar', weight: 1.5, label: 'Director' },
        { name: 'cast', column: 'top_cast', type: 'json_array', topN: 150, weight: 1.0, label: 'Actor' },
        { name: 'companies', column: 'production_companies', type: 'json_array', topN: 50, weight: 0.8, label: 'Studio' },
        { name: 'languages', column: 'original_language', type: 'scalar', weight: 1.0, label: 'Language' }
    ],
    continuousFeatures: [
        { name: 'adult', label: 'Adult Content', accessor: m => m.adult ? 1.0 : 0.0 },
        { name: 'year', label: 'Release Era', accessor: m => (Math.max(1900, Math.min(m.release_year || 2000, 2025)) - 1900) / 125 },
        { name: 'runtime', label: 'Runtime', accessor: m => Math.max(0, Math.min(m.runtime || 90, 240)) / 240 },
        { name: 'rating', label: 'TMDB Rating', accessor: m => (m.tmdb_rating || 5) / 10 }
    ]
});

const animeVectorizer = createVectorizer({
    domain: 'anime',
    getRowsQuery: `
        SELECT COALESCE(a.primary_genres, a.genres) as active_genres, a.tags, a.director, a.studios 
        FROM watched_anime w 
        JOIN anime a ON w.anilist_id = a.anilist_id
    `,
    features: [
        { name: 'genres', column: 'active_genres', type: 'json_array', weight: 1.0, label: 'Genre', valueAccessor: a => a.primary_genres ? a.primary_genres : a.genres },
        { name: 'tags', column: 'tags', type: 'json_array', topN: 150, weight: 1.2, label: 'Tag' },
        { name: 'directors', column: 'director', type: 'scalar', weight: 1.5, label: 'Director' },
        { name: 'studios', column: 'studios', type: 'json_array', topN: 50, weight: 0.8, label: 'Studio' }
    ],
    continuousFeatures: [
        { name: 'adult', label: 'Adult Content', accessor: a => a.adult ? 1.0 : 0.0 },
        { name: 'year', label: 'Release Era', accessor: a => (Math.max(1960, Math.min(a.release_year || 2010, 2025)) - 1960) / 65 },
        { name: 'episodes', label: 'Episodes', accessor: a => Math.max(1, Math.min(a.episodes || 12, 100)) / 100 },
        { name: 'rating', label: 'Community Score', accessor: a => (a.average_score || 50) / 100 }
    ]
});

module.exports = { 
    buildVocab: movieVectorizer.buildVocab, 
    getFeatureNames: movieVectorizer.getFeatureNames, 
    normalizeL2: movieVectorizer.normalizeL2, 
    vectorizeMovie: movieVectorizer.vectorizeItem,
    
    buildAnimeVocab: animeVectorizer.buildVocab,
    getAnimeFeatureNames: animeVectorizer.getFeatureNames,
    vectorizeAnime: animeVectorizer.vectorizeItem,
    normalizeAnime: animeVectorizer.normalizeL2
};
