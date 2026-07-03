/**
 * Genre Utility: Selects the most descriptive/representative genres using IDF × Position scoring.
 * 
 * TMDB/AniList return genres as flat arrays. This utility picks the top N most informative
 * genres using a combination of:
 *   1. IDF rarity (rare genres are more descriptive than common ones like "Drama")
 *   2. Position decay (first genre in TMDB/AniList arrays tends to be most representative)
 */

/**
 * Selects the most representative genres from a full genre list.
 * @param {string[]} allGenres - Full array of genre names (e.g. ["Action", "Crime", "Drama", "Thriller"])
 * @param {Object} genreIDF - Map of genre name → IDF value (from buildVocab)
 * @param {number} maxGenres - Maximum genres to keep (default: 2)
 * @returns {string[]} The top N most descriptive genres
 */
function selectPrimaryGenres(allGenres, genreIDF = {}, maxGenres = 2) {
    if (!allGenres || allGenres.length === 0) return [];
    if (allGenres.length <= maxGenres) return allGenres;

    // Score = IDF × position_decay
    // Position 0: 1.0, Position 1: 0.85, Position 2: 0.7, etc.
    // Minimum decay floor of 0.3 so late-position genres aren't completely ignored
    const scored = allGenres.map((genre, index) => {
        const idf = genreIDF[genre] || 1.0; // Default IDF of 1.0 for unknown genres
        const positionDecay = Math.max(0.3, 1.0 - (index * 0.15));
        return {
            genre,
            score: idf * positionDecay
        };
    });

    // Sort by score descending, take top N
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, maxGenres).map(s => s.genre);
}

/**
 * Generic BM25-style IDF formula.
 * @param {number} N - Total number of documents
 * @param {number} df - Document frequency (number of documents containing the term)
 * @returns {number} IDF weight
 */
function calcBM25IDF(N, df) {
    return Math.log(((N - df + 0.5) / (df + 0.5)) + 1.0);
}

/**
 * Computes a simple IDF map from an array of genre arrays.
 * Used during sync when the full vocab isn't available.
 * @param {string[][]} allGenreArrays - Array of genre arrays from all movies
 * @returns {Object} Map of genre name → IDF value
 */
function computeGenreIDF(allGenreArrays) {
    const N = allGenreArrays.length || 1;
    const genreCounts = {};

    allGenreArrays.forEach(genres => {
        if (!genres) return;
        genres.forEach(g => {
            genreCounts[g] = (genreCounts[g] || 0) + 1;
        });
    });

    const idf = {};
    Object.keys(genreCounts).forEach(g => {
        idf[g] = calcBM25IDF(N, genreCounts[g]);
    });

    return idf;
}

module.exports = { selectPrimaryGenres, computeGenreIDF, calcBM25IDF };
