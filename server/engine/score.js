const { normalizeL2, vectorizeMovie } = require('./vectorize');
const { vectorizeAnime } = require('./vectorize_anime');
const animeDb = require('../db/anime_db');
const { getCache } = require('./cache');

function getTasteProfile(db, vocab) {
    const cache = getCache('movie');
    if (cache.profileVec) return cache.profileVec;

    const allWatched = db.prepare(`
        SELECT m.*, w.user_rating 
        FROM watched w 
        JOIN movies m ON w.tmdb_id = m.tmdb_id
    `).all();

    if (allWatched.length === 0) return null;

    const franchiseCounts = {};
    allWatched.forEach(m => {
        if (m.collection_id) {
            franchiseCounts[m.collection_id] = (franchiseCounts[m.collection_id] || 0) + 1;
        }
    });

    let profileVec = null;

    allWatched.forEach(movie => {
        const watchDate = movie.watch_date ? new Date(movie.watch_date) : new Date();
        const daysSince = (Date.now() - watchDate.getTime()) / (1000 * 60 * 60 * 24);
        const temporalMultiplier = Math.exp(-0.002 * Math.max(0, daysSince));

        let franchiseWeight = 1.0;
        if (movie.collection_id && franchiseCounts[movie.collection_id] > 1) {
            franchiseWeight = 1.0 / Math.sqrt(franchiseCounts[movie.collection_id]);
        }

        const weight = ((movie.user_rating - 5.5) / 4.5) * temporalMultiplier * franchiseWeight;
        const vec = normalizeL2(vectorizeMovie(movie, vocab));
        
        if (!profileVec) {
            profileVec = vec.map(v => v * weight);
        } else {
            for (let i = 0; i < vec.length; i++) profileVec[i] += (vec[i] * weight);
        }
    });

    for (let i = 0; i < profileVec.length; i++) profileVec[i] /= allWatched.length;

    cache.profileVec = normalizeL2(profileVec);
    return cache.profileVec;
}

function getAnimeTasteProfile(vocab) {
    const cache = getCache('anime');
    if (cache.profileVec) return cache.profileVec;

    const allWatched = animeDb.prepare(`
        SELECT a.*, w.user_rating 
        FROM watched_anime w 
        JOIN anime a ON w.anilist_id = a.anilist_id
    `).all();

    if (allWatched.length === 0) return null;

    const franchiseCounts = {};
    allWatched.forEach(a => {
        if (a.franchise_group_id) {
            franchiseCounts[a.franchise_group_id] = (franchiseCounts[a.franchise_group_id] || 0) + 1;
        }
    });

    let profileVec = null;

    allWatched.forEach(anime => {
        const watchDate = anime.watch_date ? new Date(anime.watch_date) : new Date();
        const daysSince = (Date.now() - watchDate.getTime()) / (1000 * 60 * 60 * 24);
        const temporalMultiplier = Math.exp(-0.002 * Math.max(0, daysSince));

        let franchiseWeight = 1.0;
        if (anime.franchise_group_id && franchiseCounts[anime.franchise_group_id] > 1) {
            franchiseWeight = 1.0 / Math.sqrt(franchiseCounts[anime.franchise_group_id]);
        }

        const weight = ((anime.user_rating - 5.5) / 4.5) * temporalMultiplier * franchiseWeight;
        const vec = normalizeL2(vectorizeAnime(anime, vocab));
        
        if (!profileVec) {
            profileVec = vec.map(v => v * weight);
        } else {
            for (let i = 0; i < vec.length; i++) profileVec[i] += (vec[i] * weight);
        }
    });

    for (let i = 0; i < profileVec.length; i++) profileVec[i] /= allWatched.length;

    cache.profileVec = normalizeL2(profileVec);
    return cache.profileVec;
}


function cosineSimilarity(vecA, vecB) {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < vecA.length; i++) {
        dotProduct += vecA[i] * vecB[i];
        normA += vecA[i] * vecA[i];
        normB += vecB[i] * vecB[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

function explainMatchDetailed(movieVec, profileVec, featureNames) {
    const contributions = [];
    for (let i = 0; i < movieVec.length; i++) {
        const contribution = movieVec[i] * profileVec[i];
        if (contribution > 0.01) {
            contributions.push({ rawName: featureNames[i], score: contribution });
        }
    }
    contributions.sort((a, b) => b.score - a.score);
    return contributions.slice(0, 5).map(c => {
        let friendlyName = c.rawName;
        if (c.rawName.startsWith('Genre: ')) friendlyName = c.rawName.replace('Genre: ', '') + ' genre';
        else if (c.rawName.startsWith('Tag: ')) friendlyName = '"' + c.rawName.replace('Tag: ', '') + '" theme';
        else if (c.rawName.startsWith('Country: ')) friendlyName = 'from ' + c.rawName.replace('Country: ', '');
        else if (c.rawName.startsWith('Director: ')) friendlyName = 'directed by ' + c.rawName.replace('Director: ', '');
        else if (c.rawName.startsWith('Studio: ')) friendlyName = 'animated by ' + c.rawName.replace('Studio: ', '');
        return { rawName: c.rawName, friendlyName, score: c.score };
    });
}

function findMismatches(movieVec, profileVec, featureNames) {
    const mismatches = [];
    for (let i = 0; i < movieVec.length; i++) {
        if (movieVec[i] > 0.05 && profileVec[i] <= -0.05) {
            let friendlyName = featureNames[i];
            if (friendlyName.startsWith('Genre: ')) friendlyName = friendlyName.replace('Genre: ', '') + ' genre';
            else if (friendlyName.startsWith('Tag: ')) friendlyName = '"' + friendlyName.replace('Tag: ', '') + '"';
            else if (friendlyName.startsWith('Country: ')) friendlyName = 'films from ' + friendlyName.replace('Country: ', '');
            else if (friendlyName.startsWith('Director: ')) friendlyName = 'by ' + friendlyName.replace('Director: ', '');
            else if (friendlyName.startsWith('Studio: ')) friendlyName = 'from ' + friendlyName.replace('Studio: ', '');
            
            const conflictScore = movieVec[i] * Math.abs(profileVec[i]);
            mismatches.push({ rawName: featureNames[i], friendlyName, movieScore: movieVec[i], profileScore: profileVec[i], conflictScore });
        }
    }
    mismatches.sort((a, b) => b.conflictScore - a.conflictScore);
    return mismatches.slice(0, 3);
}

// Internal Dense Profile Builders
function buildDenseProfile(dbConnection, query, franchiseKey) {
    const allWatched = dbConnection.prepare(query).all();
    if (allWatched.length === 0) return null;

    const franchiseCounts = {};
    if (franchiseKey) {
        allWatched.forEach(item => {
            if (item[franchiseKey]) {
                franchiseCounts[item[franchiseKey]] = (franchiseCounts[item[franchiseKey]] || 0) + 1;
            }
        });
    }

    let denseProfileVec = null;

    allWatched.forEach(item => {
        try {
            const watchDate = item.watch_date ? new Date(item.watch_date) : new Date();
            const daysSince = (Date.now() - watchDate.getTime()) / (1000 * 60 * 60 * 24);
            const temporalMultiplier = Math.exp(-0.002 * Math.max(0, daysSince));
            
            let franchiseWeight = 1.0;
            if (franchiseKey && item[franchiseKey] && franchiseCounts[item[franchiseKey]] > 1) {
                franchiseWeight = 1.0 / Math.sqrt(franchiseCounts[item[franchiseKey]]);
            }

            const weight = ((item.user_rating - 5.5) / 4.5) * temporalMultiplier * franchiseWeight;
            const vec = JSON.parse(item.plot_embedding);
            
            if (!denseProfileVec) {
                denseProfileVec = vec.map(v => v * weight);
            } else {
                if (vec.length === denseProfileVec.length) {
                    for (let i = 0; i < vec.length; i++) denseProfileVec[i] += (vec[i] * weight);
                }
            }
        } catch (e) {}
    });

    if (!denseProfileVec) return null;
    for (let i = 0; i < denseProfileVec.length; i++) denseProfileVec[i] /= allWatched.length;
    return normalizeL2(denseProfileVec);
}

// The Cross-Pollination Engine
function getCrossPollinatedDenseProfile(db, domain = 'movies') {
    const mCache = getCache('movie');
    const aCache = getCache('anime');

    // 1. Get Movie Dense Profile
    let movieDense = mCache.denseProfileVec;
    if (!movieDense) {
        movieDense = buildDenseProfile(db, `
            SELECT m.plot_embedding, m.collection_id, w.user_rating, w.watch_date 
            FROM watched w JOIN movies m ON w.tmdb_id = m.tmdb_id
            WHERE m.plot_embedding IS NOT NULL
        `, 'collection_id');
        mCache.denseProfileVec = movieDense;
    }

    // 2. Get Anime Dense Profile
    let animeDense = aCache.denseProfileVec;
    if (!animeDense) {
        animeDense = buildDenseProfile(animeDb, `
            SELECT a.plot_embedding, a.franchise_group_id, w.user_rating, w.watch_date 
            FROM watched_anime w JOIN anime a ON w.anilist_id = a.anilist_id
            WHERE a.plot_embedding IS NOT NULL
        `, 'franchise_group_id');
        aCache.denseProfileVec = animeDense;
    }

    // 3. Blend them!
    if (!movieDense && !animeDense) return null;
    if (!animeDense) return movieDense;
    if (!movieDense) return animeDense;

    // Both exist, so we blend depending on the target domain
    const blended = new Array(movieDense.length).fill(0);
    const weightPrimary = 0.8;
    const weightSecondary = 0.2;

    for (let i = 0; i < blended.length; i++) {
        if (domain === 'movies') {
            blended[i] = (movieDense[i] * weightPrimary) + (animeDense[i] * weightSecondary);
        } else if (domain === 'anime') {
            blended[i] = (animeDense[i] * weightPrimary) + (movieDense[i] * weightSecondary);
        }
    }

    return normalizeL2(blended);
}

// Backward compatibility wrapper
function getDenseTasteProfile(db) {
    return getCrossPollinatedDenseProfile(db, 'movies');
}

function calculateMatchPercentage(finalSimilarity) {
    const shifted = (finalSimilarity - 0.45) * 12;
    const sigmoid = 1 / (1 + Math.exp(-shifted));
    return Math.min(Math.round(sigmoid * 100), 100);
}

module.exports = { 
    getTasteProfile, 
    getAnimeTasteProfile, 
    getDenseTasteProfile, 
    getCrossPollinatedDenseProfile, 
    cosineSimilarity, 
    explainMatchDetailed, 
    findMismatches,
    calculateMatchPercentage
};
