const { getCache } = require('./cache');

function buildAnimeVocab(db) {
    const cache = getCache('anime');
    if (cache.vocab) return cache.vocab;
    const rows = db.prepare(`
        SELECT a.genres, a.tags, a.director, a.studios 
        FROM watched_anime w 
        JOIN anime a ON w.anilist_id = a.anilist_id
    `).all();

    const N = rows.length || 1;
    const genreCounts = {};
    const tagCounts = {};
    const directorCounts = {};
    const studioCounts = {};

    rows.forEach(row => {
        if (row.genres) {
            JSON.parse(row.genres).forEach(g => { genreCounts[g] = (genreCounts[g] || 0) + 1; });
        }
        if (row.tags) {
            JSON.parse(row.tags).forEach(t => { tagCounts[t] = (tagCounts[t] || 0) + 1; });
        }
        if (row.director) {
            directorCounts[row.director] = (directorCounts[row.director] || 0) + 1;
        }
        if (row.studios) {
            JSON.parse(row.studios).forEach(s => { studioCounts[s] = (studioCounts[s] || 0) + 1; });
        }
    });

    const topTags = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).slice(0, 150).map(e => e[0]);
    const topStudios = Object.entries(studioCounts).sort((a, b) => b[1] - a[1]).slice(0, 50).map(e => e[0]);

    // Calculate BM25-style IDF weights
    const idf = { genres: {}, tags: {}, directors: {}, studios: {} };
    const calcIDF = (df) => Math.log(((N - df + 0.5) / (df + 0.5)) + 1.0);

    Object.keys(genreCounts).forEach(g => idf.genres[g] = calcIDF(genreCounts[g]));
    topTags.forEach(t => idf.tags[t] = calcIDF(tagCounts[t]));
    Object.keys(directorCounts).forEach(d => idf.directors[d] = calcIDF(directorCounts[d]));
    topStudios.forEach(s => idf.studios[s] = calcIDF(studioCounts[s]));

    cache.vocab = {
        genres: Object.keys(genreCounts).sort(),
        tags: topTags.sort(),
        directors: Object.keys(directorCounts).sort(),
        studios: topStudios.sort(),
        idf
    };
    return cache.vocab;
}

function getAnimeFeatureNames(vocab) {
    const names = [];
    vocab.genres.forEach(g => names.push(`Genre: ${g}`));
    vocab.tags.forEach(t => names.push(`Tag: ${t}`));
    vocab.directors.forEach(d => names.push(`Director: ${d}`));
    vocab.studios.forEach(s => names.push(`Studio: ${s}`));
    names.push("Adult Content");
    names.push("Release Era");
    names.push("Episodes");
    names.push("Community Score");
    return names;
}

function normalizeL2(vec) {
    const mag = Math.sqrt(vec.reduce((sum, val) => sum + val * val, 0));
    if (mag === 0) return vec;
    return vec.map(v => v / mag);
}

function vectorizeAnime(anime, vocab) {
    const vec = [];
    
    const animeGenres = anime.genres ? JSON.parse(anime.genres) : [];
    vocab.genres.forEach(g => {
        vec.push(animeGenres.includes(g) ? (vocab.idf.genres[g] * 1.0) : 0);
    });

    const animeTags = anime.tags ? JSON.parse(anime.tags) : [];
    vocab.tags.forEach(t => {
        vec.push(animeTags.includes(t) ? (vocab.idf.tags[t] * 1.2) : 0);
    });

    vocab.directors.forEach(d => {
        vec.push(anime.director === d ? (vocab.idf.directors[d] * 1.5) : 0);
    });

    const animeStudios = anime.studios ? JSON.parse(anime.studios) : [];
    vocab.studios.forEach(s => {
        vec.push(animeStudios.includes(s) ? (vocab.idf.studios[s] * 0.8) : 0);
    });

    vec.push(anime.adult ? 1.0 : 0.0);

    let year = anime.release_year || 2010;
    year = Math.max(1960, Math.min(year, 2025));
    vec.push((year - 1960) / 65);

    let episodes = anime.episodes || 12;
    episodes = Math.max(1, Math.min(episodes, 100)); // Cap at 100 to avoid extreme outliers
    vec.push(episodes / 100);

    let rating = anime.average_score || 50;
    vec.push(rating / 100);

    return vec; // Not normalized yet
}

module.exports = { buildAnimeVocab, getAnimeFeatureNames, normalizeL2, vectorizeAnime };
