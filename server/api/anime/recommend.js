const express = require('express');
const router = express.Router();
const db = require('../../db/anime_db');
const moviesDb = require('../../db/db');
const { fetchAndCacheAnime } = require('../../anilist');
const { buildAnimeVocab, getAnimeFeatureNames, vectorizeAnime, normalizeL2 } = require('../../engine/vectorize_anime');
const { getAnimeTasteProfile, getCrossPollinatedDenseProfile, cosineSimilarity, explainMatchDetailed, findMismatches } = require('../../engine/score');

// POST /api/anime_recommend/predict
// Body: { tmdb_id }  (Wait, frontend will send tmdb_id parameter because of shared UI)
router.post('/predict', async (req, res) => {
    try {
        const anilist_id = req.body.tmdb_id || req.body.anilist_id;
        if (!anilist_id) return res.status(400).json({ error: 'id is required' });

        // Ensure anime in DB
        let anime = db.prepare('SELECT * FROM anime WHERE anilist_id = ?').get(anilist_id);
        if (!anime) {
            await fetchAndCacheAnime(anilist_id);
            anime = db.prepare('SELECT * FROM anime WHERE anilist_id = ?').get(anilist_id);
        }

        // Build engine
        const vocab = buildAnimeVocab(db);
        const profileVec = getAnimeTasteProfile(vocab);
        const denseProfileVec = getCrossPollinatedDenseProfile(moviesDb, 'anime');
        
        if (!profileVec) {
            return res.json({ 
                score: 0, 
                explanation: "Log some anime with a rating to generate a taste profile!",
                movie: anime // Return as 'movie' to satisfy shared frontend
            });
        }

        const featureNames = getAnimeFeatureNames(vocab);
        
        // Score candidate (Sparse TF-IDF)
        let animeVec = vectorizeAnime(anime, vocab);
        animeVec = normalizeL2(animeVec);

        const sparseSimilarity = cosineSimilarity(animeVec, profileVec);
        
        // Score candidate (Dense Semantic Plot)
        let denseSimilarity = 0;
        let finalSimilarity = sparseSimilarity;
        
        if (denseProfileVec && anime.plot_embedding) {
            try {
                let animeDenseVec = JSON.parse(anime.plot_embedding);
                animeDenseVec = normalizeL2(animeDenseVec);
                denseSimilarity = cosineSimilarity(animeDenseVec, denseProfileVec);
                
                // Adaptive Blending based on Metadata Richness
                const tagCount = anime.tags ? JSON.parse(anime.tags).length : 0;
                const genreCount = anime.genres ? JSON.parse(anime.genres).length : 0;
                const richness = Math.min(10, tagCount + genreCount) / 10.0; // 0.0 to 1.0

                // If highly rich (1.0), lean sparse (e.g. 65% sparse). If poor (0.0), lean dense (e.g. 20% sparse).
                const sparseWeight = 0.20 + (0.45 * richness);
                const denseWeight = 1.0 - sparseWeight;
                
                finalSimilarity = (sparseSimilarity * sparseWeight) + (denseSimilarity * denseWeight);
            } catch (e) {
                console.error("Failed to calculate dense similarity", e);
            }
        }

        // Use a sigmoid function to scale the raw similarity score into a human-readable percentage
        const shifted = (finalSimilarity - 0.35) * 10;
        const sigmoid = 1 / (1 + Math.exp(-shifted));
        const percentage = Math.min(Math.round(sigmoid * 100), 100);

        const topContributions = explainMatchDetailed(animeVec, profileVec, featureNames);
        const reasons = topContributions.slice(0, 3).map(c => c.friendlyName);
        const mismatches = findMismatches(animeVec, profileVec, featureNames);

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
            movie: anime // Ensure shared frontend receives "movie" key
        });

    } catch (error) {
        console.error('Error predicting score:', error);
        res.status(500).json({ error: 'Failed to generate prediction' });
    }
});

module.exports = router;
