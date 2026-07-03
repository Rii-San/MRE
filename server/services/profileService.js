const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

const profilePath = path.join(__dirname, '../../data/user_profile.json');
let cachedProfile = null;

function getProfile() {
    if (cachedProfile) {
        return cachedProfile;
    }
    
    if (fs.existsSync(profilePath)) {
        try {
            const data = fs.readFileSync(profilePath, 'utf8');
            cachedProfile = JSON.parse(data);
        } catch (e) {
            logger.error("Error parsing user_profile.json: " + e.message, 'ProfileService');
            cachedProfile = {};
        }
    } else {
        cachedProfile = {};
    }
    return cachedProfile;
}

function _persistProfile() {
    const dataDir = path.dirname(profilePath);
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }
    
    fs.promises.writeFile(profilePath, JSON.stringify(cachedProfile, null, 2))
        .catch(e => logger.error("Error writing user_profile.json: " + e.message, 'ProfileService'));
}

function updateProfile(newProfileData) {
    if (!cachedProfile) {
        getProfile();
    }
    
    cachedProfile = { ...cachedProfile, ...newProfileData };
    _persistProfile();
        
    return cachedProfile;
}

function setProfile(fullProfile) {
    cachedProfile = fullProfile;
    _persistProfile();
        
    return cachedProfile;
}

module.exports = {
    getProfile,
    updateProfile,
    setProfile
};
