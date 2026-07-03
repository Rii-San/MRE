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

module.exports = router;
