const express = require('express');
const router = express.Router();
const profileService = require('../services/profileService');
const logger = require('../utils/logger');
const { syncWatchHistoryFromAniList } = require('../anilist');

// AniList OAuth Route
router.get('/anilist', (req, res) => {
    const clientId = process.env.ANILIST_CLIENT_ID;
    if (!clientId) {
        return res.status(400).send("ANILIST_CLIENT_ID is not configured in .env");
    }
    const redirectUri = `http://localhost:${process.env.PORT || 3000}/api/auth/anilist/callback`;
    const authUrl = `https://anilist.co/api/v2/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code`;
    res.redirect(authUrl);
});

// AniList OAuth Callback
router.get('/anilist/callback', async (req, res) => {
    const code = req.query.code;
    if (!code) {
        return res.status(400).send("No code provided by AniList");
    }

    const clientId = process.env.ANILIST_CLIENT_ID;
    const clientSecret = process.env.ANILIST_CLIENT_SECRET;
    const redirectUri = `http://localhost:${process.env.PORT || 3000}/api/auth/anilist/callback`;

    try {
        const tokenRes = await fetch('https://anilist.co/api/v2/oauth/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
            },
            body: JSON.stringify({
                grant_type: 'authorization_code',
                client_id: clientId,
                client_secret: clientSecret,
                redirect_uri: redirectUri,
                code: code
            })
        });

        const data = await tokenRes.json();
        
        if (data.access_token) {
            // Store token in profile
            profileService.updateProfile({ anilist_access_token: data.access_token });
            logger.info("Successfully authenticated with AniList", "Auth");
            
            // Fire off the background sync to pull their watch history
            syncWatchHistoryFromAniList(data.access_token).catch(e => {
                logger.error("Failed to sync AniList background history: " + e.message, "Auth");
            });
            
            // Redirect back to the frontend with a success flag
            res.redirect('/?auth=success');
        } else {
            logger.error("Failed to get AniList access token: " + JSON.stringify(data), "Auth");
            res.status(500).send("Failed to retrieve access token from AniList.");
        }
    } catch (error) {
        logger.error("Error during AniList OAuth callback: " + error.message, "Auth");
        res.status(500).send("An error occurred during authentication.");
    }
});

// Status endpoint to check if user is logged in
router.get('/anilist/status', (req, res) => {
    const profile = profileService.getProfile();
    res.json({ authenticated: !!profile.anilist_access_token });
});

// Force AniList Sync
router.post('/anilist/sync', (req, res) => {
    const profile = profileService.getProfile();
    if (!profile.anilist_access_token) {
        return res.status(401).json({ error: "Not authenticated with AniList" });
    }
    
    syncWatchHistoryFromAniList(profile.anilist_access_token).catch(e => {
        logger.error("Failed manual AniList sync: " + e.message, "Auth");
    });
    
    res.json({ success: true, message: "Sync started in background" });
});

module.exports = router;
