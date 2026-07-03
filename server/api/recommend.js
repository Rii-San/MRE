const express = require('express');
const router = express.Router({ mergeParams: true });
const movieDb = require('../db/db');
const animeDb = require('../db/anime_db');
const { fetchAndCacheMovie } = require('../tmdb');
const { fetchAndCacheAnime } = require('../anilist');
const { buildVocab, getFeatureNames, normalizeL2: normalizeMovie, vectorizeMovie, buildAnimeVocab, getAnimeFeatureNames, vectorizeAnime, normalizeAnime } = require('../engine/vectorize');
const { getTasteProfile, getDenseTasteProfile, getAnimeTasteProfile, getCrossPollinatedDenseProfile, cosineSimilarity, explainMatchDetailed, findMismatches, calculateMatchPercentage } = require('../engine/score');
const { applyBiases, computeAdaptiveSimilarity } = require('./scoringUtils');

async function handleRecommend(req, res) {
    const domain = req.params.domain;
    const id = req.body.tmdb_id || req.body.anilist_id;
    
    if (!id) return res.status(400).json({ error: 'id is required' });

    let item, db, fetchFn, vocabBuilder, profileFn, denseProfileFn, featureFn, vectorizeFn, normalizeFn;
    
    if (domain === 'anime') {
        db = animeDb;
        fetchFn = fetchAndCacheAnime;
        vocabBuilder = buildAnimeVocab;
        profileFn = () => getAnimeTasteProfile(vocabBuilder(db));
        denseProfileFn = () => getCrossPollinatedDenseProfile(movieDb, 'anime');
        featureFn = getAnimeFeatureNames;
        vectorizeFn = vectorizeAnime;
        normalizeFn = normalizeAnime;
        
        item = db.prepare('SELECT * FROM anime WHERE anilist_id = ?').get(id);
        if (!item) {
            await fetchFn(id);
            item = db.prepare('SELECT * FROM anime WHERE anilist_id = ?').get(id);
        }
    } else {
        db = movieDb;
        fetchFn = fetchAndCacheMovie;
        vocabBuilder = buildVocab;
        profileFn = () => getTasteProfile(db, vocabBuilder(db));
        denseProfileFn = () => getDenseTasteProfile(db);
        featureFn = getFeatureNames;
        vectorizeFn = vectorizeMovie;
        normalizeFn = normalizeMovie;
        
        item = db.prepare('SELECT * FROM movies WHERE tmdb_id = ?').get(id);
        if (!item) {
            await fetchFn(id);
            item = db.prepare('SELECT * FROM movies WHERE tmdb_id = ?').get(id);
        }
    }

    const vocab = vocabBuilder(db);
    const profileVec = profileFn();
    const denseProfileVec = denseProfileFn();
    
    if (!profileVec) return res.json({ score: 0, explanation: "Log some items with a rating to generate a taste profile!", movie: item });

    const featureNames = featureFn(vocab);
    let itemVec = normalizeFn(vectorizeFn(item, vocab));
    let tag_bias = cosineSimilarity(itemVec, profileVec);
    let story_bias = 0, narrative_bias = 0, finalSimilarity = tag_bias;
    const p = require('../services/profileService').getProfile();
    
    if (denseProfileVec && item.plot_embedding) {
        try {
            let itemDenseVec = normalizeFn(JSON.parse(item.plot_embedding));
            story_bias = cosineSimilarity(itemDenseVec, denseProfileVec);
            if (p && p.narrative_embedding) narrative_bias = cosineSimilarity(itemDenseVec, p.narrative_embedding);
            
            const keywordCount = domain === 'anime' ? (item.tags ? JSON.parse(item.tags).length : 0) : (item.keywords ? JSON.parse(item.keywords).length : 0);
            const genreCount = item.genres ? JSON.parse(item.genres).length : 0;
            const richness = Math.min(10, keywordCount + genreCount) / 10.0;
            finalSimilarity = computeAdaptiveSimilarity(tag_bias, story_bias, narrative_bias, richness);
        } catch (e) {}
    }
    
    const overview = domain === 'anime' ? item.description : item.overview;
    const biases = applyBiases(finalSimilarity, domain, { genres: item.genres, overview }, p);
    finalSimilarity = biases.finalSimilarity;
    const percentage = calculateMatchPercentage(finalSimilarity);
    const topContributions = explainMatchDetailed(itemVec, profileVec, featureNames);
    const reasons = topContributions.slice(0, 3).map(c => c.friendlyName);
    const mismatches = findMismatches(itemVec, profileVec, featureNames);

    let explanation = "Matches your taste profile.";
    if (reasons.length > 0) explanation = `High match due to: ${reasons.join(', ')}.`;
    let warning = null;
    if (mismatches.length > 0) warning = `Heads up: contains ${mismatches.slice(0,2).map(m => m.friendlyName).join(' and ')} — not usually your thing.`;

    res.json({
        score: percentage, explanation, warning, raw_cosine_similarity: tag_bias, dense_similarity: story_bias,
        narrative_bias, oracle_bias: biases.oracleBiasScore, spiritual_bias: biases.spiritualBiasScore,
        final_similarity: finalSimilarity, top_features: topContributions, mismatches, movie: item
    });
}

router.post('/predict', async (req, res) => {
    try {
        await handleRecommend(req, res);
    } catch (error) {
        console.error('Error predicting score:', error);
        res.status(500).json({ error: 'Failed to generate prediction' });
    }
});

module.exports = router;
