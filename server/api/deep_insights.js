const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { generateTasteSummary } = require('../services/preprocessor');
const { generateTasteProfile, sendChatMessageStreamWithFallback, generateRecommendationQuery } = require('../services/gemini');
const { getEmbedding } = require('../llm');

const profileService = require('../services/profileService');

function getUserProfile() {
    return profileService.getProfile();
}

function saveUserProfile(profile) {
    profileService.setProfile(profile);
}

router.post('/generate', express.json(), async (req, res) => {
    try {
        const { movieEps, animeEps } = req.body || {};
        const profile = getUserProfile();
        const summary = await generateTasteSummary(
            movieEps ? parseFloat(movieEps) : null, 
            animeEps ? parseFloat(animeEps) : null
        );
        
        if (!summary || summary.includes('Not enough data')) {
            return res.status(400).json({ error: 'Not enough watched items to generate insights. Log some movies or anime first!' });
        }
        
        // Generate and cache the recommendation bias
        let bias = null;
        try {
            bias = await generateRecommendationQuery(summary, profile, "Give me a general recommendation bias vector for this user.");
        } catch (biasErr) {
            console.warn('[Deep Insights] Bias generation failed (non-fatal):', biasErr.message);
        }

        // Generate narrative embedding for scoring
        let narrative_embedding = null;
        try {
            const embedArr = await getEmbedding(summary);
            if (embedArr) narrative_embedding = embedArr;
        } catch (e) {
            console.warn('[Deep Insights] Narrative embedding generation failed:', e.message);
        }
        
        // We no longer generate a Gemini reading. Just use the summary.
        profile.tasteSummary = summary;
        if (bias) profile.bias = bias;
        if (narrative_embedding) profile.narrative_embedding = narrative_embedding;
        saveUserProfile(profile);
        
        // Return summary so the client can parse and render the widgets
        res.json({ summary, bias });
    } catch (e) {
        console.error("Generate error:", e);
        res.status(500).json({ error: 'Failed to generate insights: ' + e.message });
    }
});

router.post('/chat', async (req, res) => {
    res.status(400).json({ error: 'Chat feature has been retired in favor of data-driven insights.' });
});

module.exports = router;
