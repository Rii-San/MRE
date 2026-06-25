const { getCache } = require('./cache');

function buildVocab(db) {
    const cache = getCache('movie');
    if (cache.vocab) return cache.vocab;
    const rows = db.prepare(`
        SELECT COALESCE(m.primary_genres, m.genres) as active_genres, m.keywords, m.country, m.director, m.top_cast, m.production_companies, m.original_language 
        FROM watched w 
        JOIN movies m ON w.tmdb_id = m.tmdb_id
    `).all();

    const N = rows.length || 1;
    const genreCounts = {};
    const keywordCounts = {};
    const countryCounts = {};
    const directorCounts = {};
    const castCounts = {};
    const companyCounts = {};
    const languageCounts = {};

    rows.forEach(row => {
        if (row.active_genres) {
            JSON.parse(row.active_genres).forEach(g => { genreCounts[g] = (genreCounts[g] || 0) + 1; });
        }
        if (row.keywords) {
            JSON.parse(row.keywords).forEach(k => { keywordCounts[k] = (keywordCounts[k] || 0) + 1; });
        }
        if (row.country) {
            countryCounts[row.country] = (countryCounts[row.country] || 0) + 1;
        }
        if (row.director) {
            directorCounts[row.director] = (directorCounts[row.director] || 0) + 1;
        }
        if (row.top_cast) {
            JSON.parse(row.top_cast).forEach(c => { castCounts[c] = (castCounts[c] || 0) + 1; });
        }
        if (row.production_companies) {
            JSON.parse(row.production_companies).forEach(c => { companyCounts[c] = (companyCounts[c] || 0) + 1; });
        }
        if (row.original_language) {
            languageCounts[row.original_language] = (languageCounts[row.original_language] || 0) + 1;
        }
    });

    const topKeywords = Object.entries(keywordCounts).sort((a, b) => b[1] - a[1]).slice(0, 100).map(e => e[0]);
    const topCast = Object.entries(castCounts).sort((a, b) => b[1] - a[1]).slice(0, 150).map(e => e[0]);
    const topCompanies = Object.entries(companyCounts).sort((a, b) => b[1] - a[1]).slice(0, 50).map(e => e[0]);

    // Calculate BM25-style IDF weights
    const idf = { genres: {}, keywords: {}, countries: {}, directors: {}, cast: {}, companies: {}, languages: {} };
    
    // BM25 IDF: ln((N - df + 0.5) / (df + 0.5) + 1.0)
    const calcIDF = (df) => Math.log(((N - df + 0.5) / (df + 0.5)) + 1.0);

    Object.keys(genreCounts).forEach(g => idf.genres[g] = calcIDF(genreCounts[g]));
    topKeywords.forEach(k => idf.keywords[k] = calcIDF(keywordCounts[k]));
    Object.keys(countryCounts).forEach(c => idf.countries[c] = calcIDF(countryCounts[c]));
    Object.keys(directorCounts).forEach(d => idf.directors[d] = calcIDF(directorCounts[d]));
    topCast.forEach(c => idf.cast[c] = calcIDF(castCounts[c]));
    topCompanies.forEach(c => idf.companies[c] = calcIDF(companyCounts[c]));
    Object.keys(languageCounts).forEach(l => idf.languages[l] = calcIDF(languageCounts[l]));

    cache.vocab = {
        genres: Object.keys(genreCounts).sort(),
        keywords: topKeywords.sort(),
        countries: Object.keys(countryCounts).sort(),
        directors: Object.keys(directorCounts).sort(),
        cast: topCast.sort(),
        companies: topCompanies.sort(),
        languages: Object.keys(languageCounts).sort(),
        idf
    };
    return cache.vocab;
}

function getFeatureNames(vocab) {
    const names = [];
    vocab.genres.forEach(g => names.push(`Genre: ${g}`));
    vocab.keywords.forEach(k => names.push(`Tag: ${k}`));
    vocab.countries.forEach(c => names.push(`Country: ${c}`));
    vocab.directors.forEach(d => names.push(`Director: ${d}`));
    vocab.cast.forEach(c => names.push(`Actor: ${c}`));
    vocab.companies.forEach(c => names.push(`Studio: ${c}`));
    vocab.languages.forEach(l => names.push(`Language: ${l}`));
    names.push("Adult Content");
    names.push("Release Era");
    names.push("Runtime");
    names.push("TMDB Rating");
    return names;
}

function normalizeL2(vec) {
    const mag = Math.sqrt(vec.reduce((sum, val) => sum + val * val, 0));
    if (mag === 0) return vec;
    return vec.map(v => v / mag);
}

function vectorizeMovie(movie, vocab) {
    const vec = [];
    
    const movieGenres = movie.primary_genres ? JSON.parse(movie.primary_genres) : (movie.genres ? JSON.parse(movie.genres) : []);
    vocab.genres.forEach(g => {
        vec.push(movieGenres.includes(g) ? (vocab.idf.genres[g] * 1.0) : 0);
    });

    const movieKeywords = movie.keywords ? JSON.parse(movie.keywords) : [];
    vocab.keywords.forEach(k => {
        vec.push(movieKeywords.includes(k) ? (vocab.idf.keywords[k] * 1.2) : 0);
    });

    vocab.countries.forEach(c => {
        vec.push(movie.country === c ? (vocab.idf.countries[c] * 0.5) : 0);
    });

    // Directors (Auteur Theory Multiplier: 1.5x)
    vocab.directors.forEach(d => {
        vec.push(movie.director === d ? (vocab.idf.directors[d] * 1.5) : 0);
    });

    // Cast (Top Billed Multiplier: 1.0x)
    const movieCast = movie.top_cast ? JSON.parse(movie.top_cast) : [];
    vocab.cast.forEach(c => {
        vec.push(movieCast.includes(c) ? (vocab.idf.cast[c] * 1.0) : 0);
    });

    // Production Companies (Studio Weight: 0.8x)
    const movieCompanies = movie.production_companies ? JSON.parse(movie.production_companies) : [];
    vocab.companies.forEach(c => {
        vec.push(movieCompanies.includes(c) ? (vocab.idf.companies[c] * 0.8) : 0);
    });

    // Language
    vocab.languages.forEach(l => {
        vec.push(movie.original_language === l ? (vocab.idf.languages[l] * 1.0) : 0);
    });

    // Adult Flag (Boolean encoded as 1.0 or 0.0)
    vec.push(movie.adult ? 1.0 : 0.0);

    let year = movie.release_year || 2000;
    year = Math.max(1900, Math.min(year, 2025));
    vec.push((year - 1900) / 125);

    let runtime = movie.runtime || 90;
    runtime = Math.max(0, Math.min(runtime, 240));
    vec.push(runtime / 240);

    let rating = movie.tmdb_rating || 5;
    vec.push(rating / 10);

    return vec; // Not normalized yet
}

module.exports = { buildVocab, getFeatureNames, normalizeL2, vectorizeMovie };
