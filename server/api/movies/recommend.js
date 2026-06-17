const express = require('express');
const router = express.Router();
const db = require('../../db/db');
const { fetchAndCacheMovie } = require('../../tmdb');
const { buildVocab, getFeatureNames, normalizeL2, vectorizeMovie } = require('../../engine/vectorize');
const { getTasteProfile, getDenseTasteProfile, cosineSimilarity, explainMatchDetailed, findMismatches } = require('../../engine/score');

// POST /api/recommend/predict
// Body: { tmdb_id }
router.post('/predict', async (req, res) => {
    try {
        const { tmdb_id } = req.body;
        if (!tmdb_id) return res.status(400).json({ error: 'tmdb_id is required' });

        // Ensure movie in DB
        let movie = db.prepare('SELECT * FROM movies WHERE tmdb_id = ?').get(tmdb_id);
        if (!movie) {
            await fetchAndCacheMovie(tmdb_id);
            movie = db.prepare('SELECT * FROM movies WHERE tmdb_id = ?').get(tmdb_id);
        }

        // Build engine
        const vocab = buildVocab(db);
        const profileVec = getTasteProfile(db, vocab);
        const denseProfileVec = getDenseTasteProfile(db);
        
        if (!profileVec) {
            return res.json({ 
                score: 0, 
                explanation: "Log some movies with a rating to generate a taste profile!",
                movie
            });
        }

        const featureNames = getFeatureNames(vocab);
        
        // Score candidate (Sparse TF-IDF)
        let movieVec = vectorizeMovie(movie, vocab);
        movieVec = normalizeL2(movieVec);

        const sparseSimilarity = cosineSimilarity(movieVec, profileVec);
        
        // Score candidate (Dense Semantic Plot)
        let denseSimilarity = 0;
        let finalSimilarity = sparseSimilarity;
        
        if (denseProfileVec && movie.plot_embedding) {
            try {
                let movieDenseVec = JSON.parse(movie.plot_embedding);
                movieDenseVec = normalizeL2(movieDenseVec);
                denseSimilarity = cosineSimilarity(movieDenseVec, denseProfileVec);
                
                // Adaptive Blending based on Metadata Richness
                const keywordCount = movie.keywords ? JSON.parse(movie.keywords).length : 0;
                const genreCount = movie.genres ? JSON.parse(movie.genres).length : 0;
                const richness = Math.min(10, keywordCount + genreCount) / 10.0; // 0.0 to 1.0

                // If highly rich (1.0), lean sparse (e.g. 65% sparse). If poor (0.0), lean dense (e.g. 20% sparse).
                const sparseWeight = 0.20 + (0.45 * richness);
                const denseWeight = 1.0 - sparseWeight;
                
                finalSimilarity = (sparseSimilarity * sparseWeight) + (denseSimilarity * denseWeight);
            } catch (e) {
                console.error("Failed to calculate dense similarity", e);
            }
        }

        // Use a sigmoid function to scale the raw similarity score into a human-readable percentage
        // A raw score of ~0.35 becomes 50%, stretching the differences where they matter most
        const shifted = (finalSimilarity - 0.35) * 10;
        const sigmoid = 1 / (1 + Math.exp(-shifted));
        const percentage = Math.min(Math.round(sigmoid * 100), 100);

        const topContributions = explainMatchDetailed(movieVec, profileVec, featureNames);
        const reasons = topContributions.slice(0, 3).map(c => c.friendlyName);
        const mismatches = findMismatches(movieVec, profileVec, featureNames);

        let explanation = "Matches your taste profile.";
        if (reasons.length > 0) {
            explanation = `High match due to: ${reasons.join(', ')}.`;
        }

        let warning = null;
        if (mismatches.length > 0) {
            warning = `Heads up: contains ${mismatches.slice(0,2).map(m => m.friendlyName).join(' and ')} — not usually your thing.`;
        }

        res.json({
            score: percentage,
            explanation,
            warning,
            raw_cosine_similarity: sparseSimilarity,
            dense_similarity: denseSimilarity,
            final_similarity: finalSimilarity,
            top_features: topContributions,
            mismatches,
            movie
        });

    } catch (error) {
        console.error('Error predicting score:', error);
        res.status(500).json({ error: 'Failed to generate prediction' });
    }
});

module.exports = router;
