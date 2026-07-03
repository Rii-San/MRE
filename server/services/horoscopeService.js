const fs = require('fs');
const path = require('path');
const { generateDailySpiritualBias } = require('./gemini');
const profileService = require('./profileService');
const logger = require('../utils/logger');

const dailyReadingPath = path.join(__dirname, '../../data/daily_reading.json');

function getDailyReading() {
    if (fs.existsSync(dailyReadingPath)) {
        try {
            const data = fs.readFileSync(dailyReadingPath, 'utf8');
            const cached = JSON.parse(data);
            
            const todayDate = new Date().toISOString().split('T')[0];
            if (cached.date === todayDate) {
                return cached;
            }
        } catch (e) {
            logger.error("Error reading daily_reading.json: " + e.message, 'HoroscopeService');
            return null;
        }
    }
    return null;
}

async function checkAndFetchDailyReading() {
    const profile = profileService.getProfile();
    // Only fetch if they have set their zodiac signs
    if (!profile || (!profile.vedicZodiac && !profile.chineseZodiac)) {
        return;
    }

    const cached = getDailyReading();
    if (cached) return cached;

    const todayDate = new Date().toISOString().split('T')[0];

    // Generate new reading
    try {
        logger.info(`Fetching daily spiritual bias for ${todayDate}...`, 'HoroscopeService');
        const biasData = await generateDailySpiritualBias(profile.vedicZodiac, profile.chineseZodiac);
        
        const saveData = {
            date: todayDate,
            reading: biasData.reading,
            bias: {
                boost_genres: biasData.boost_genres || [],
                suppress_genres: biasData.suppress_genres || [],
                mood_keywords: biasData.mood_keywords || []
            }
        };

        const dataDir = path.dirname(dailyReadingPath);
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }
        
        fs.writeFileSync(dailyReadingPath, JSON.stringify(saveData, null, 2));
        logger.info(`Daily spiritual bias saved.`, 'HoroscopeService');
        return saveData;
    } catch (e) {
        logger.error("Error generating daily reading: " + e.message, 'HoroscopeService');
        return null;
    }
}

module.exports = {
    checkAndFetchDailyReading,
    getDailyReading
};
