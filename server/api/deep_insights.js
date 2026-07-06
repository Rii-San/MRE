const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { generateTasteSummary } = require('../services/preprocessor');
const { sendChatMessageStreamWithFallback } = require('../services/gemini');
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
        const result = await generateTasteSummary(
            movieEps ? parseFloat(movieEps) : null, 
            animeEps ? parseFloat(animeEps) : null
        );
        
        const summary = result.summary;
        const tasteData = result.tasteData;
        
        if (!summary || summary.includes('Not enough data')) {
            return res.status(400).json({ error: 'Not enough watched items to generate insights. Log some movies or anime first!' });
        }
        
        // Generate the mathematical recommendation bias from tasteData
        const bias = {
            boost_genres: tasteData.lovedGenres || [],
            suppress_genres: tasteData.hatedGenres || [],
            mood_keywords: tasteData.lovedTags || []
        };

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
        profile.bias = bias;
        if (narrative_embedding) profile.narrative_embedding = narrative_embedding;
        
        // Save user epsilon preferences
        if (movieEps) profile.movieEps = movieEps;
        if (animeEps) profile.animeEps = animeEps;
        
        saveUserProfile(profile);
        
        // Return summary so the client can parse and render the widgets
        res.json({ summary, bias });
    } catch (e) {
        console.error("Generate error:", e);
        res.status(500).json({ error: 'Failed to generate insights: ' + e.message });
    }
});


module.exports = router;
