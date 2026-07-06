const express = require('express');
const router = express.Router();
const { getProfile, updateProfile } = require('../services/profileService');

router.get('/', (req, res) => {
    try {
        res.json(getProfile());
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.post('/', (req, res) => {
    try {
        const updated = updateProfile(req.body);
        res.json(updated);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

const { generate24Traits } = require('../services/profileGenerator');

router.post('/generate', async (req, res) => {
    try {
        const existingProfile = getProfile();
        // req.body can contain birth_date, quiz_answers, self_description, etc.
        const inputData = { ...existingProfile, ...req.body };
        
        const generated = await generate24Traits(inputData, existingProfile);
        
        // Ensure user basic info and self-description are strictly preserved
        if (existingProfile) {
            if (existingProfile.user) generated.user = { ...existingProfile.user };
            if (existingProfile.self_description) generated.self_description = existingProfile.self_description;
        }
        
        if (existingProfile && existingProfile.traits && generated && generated.traits) {
            const tiers = ['spiritual', 'popular_psychology', 'evidence_based'];
            for (const tier of tiers) {
                if (generated.traits[tier] && existingProfile.traits[tier]) {
                    generated.traits[tier] = generated.traits[tier].map(genTrait => {
                        const existingTrait = existingProfile.traits[tier].find(t => t.key === genTrait.key);
                        if (existingTrait && existingTrait.locked) {
                            return existingTrait;
                        } else {
                            genTrait.locked = false;
                            return genTrait;
                        }
                    });
                }
            }
        }
        
        // Update local profile with the new traits (merge logic)
        const updated = updateProfile(generated);
        res.json(updated);
    } catch (e) {
        console.error("Profile generation error:", e);
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;
