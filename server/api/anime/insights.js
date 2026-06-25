const express = require('express');
const router = express.Router();
const db = require('../../db/anime_db');
const { getCache } = require('../../engine/cache');

router.get('/', (req, res) => {
    try {
        const animeCache = getCache('anime');
        if (animeCache.insightsResult) return res.json(animeCache.insightsResult);
        const rows = db.prepare(`
            SELECT w.user_rating, a.anilist_id, a.average_score, COALESCE(a.primary_genres, a.genres) as active_genres, a.tags, a.release_year, a.director, a.studios, a.franchise_group_id 
            FROM watched_anime w 
            JOIN anime a ON w.anilist_id = a.anilist_id
        `).all();

        if (rows.length === 0) {
            return res.json({ error: 'Log some anime first to see insights!' });
        }

        let totalDiscrepancy = 0;
        const genreStats = {};
        const tagStats = {};
        const directorStats = {};
        const studioStats = {};
        
        let totalYear = 0;
        let validYearCount = 0;

        rows.forEach(r => {
            const franchiseKey = r.franchise_group_id ? `franchise_${r.franchise_group_id}` : `anime_${r.anilist_id}`;

            // Rating discrepancy (User rating vs AniList average (0-100 mapped to 0-10))
            const ani_rating_10 = (r.average_score || 0) / 10;
            const diff = r.user_rating - (ani_rating_10 || r.user_rating);
            totalDiscrepancy += diff;

            if (r.active_genres) {
                const gList = JSON.parse(r.active_genres);
                gList.forEach(g => {
                    if (!genreStats[g]) genreStats[g] = { count: 0, sumRating: 0, seenFranchises: new Set() };
                    if (!genreStats[g].seenFranchises.has(franchiseKey)) {
                        genreStats[g].seenFranchises.add(franchiseKey);
                        genreStats[g].count++;
                        genreStats[g].sumRating += r.user_rating;
                    }
                });
            }

            if (r.tags) {
                const tList = JSON.parse(r.tags);
                tList.forEach(t => {
                    if (!tagStats[t]) tagStats[t] = { count: 0, sumRating: 0, seenFranchises: new Set() };
                    if (!tagStats[t].seenFranchises.has(franchiseKey)) {
                        tagStats[t].seenFranchises.add(franchiseKey);
                        tagStats[t].count++;
                        tagStats[t].sumRating += r.user_rating;
                    }
                });
            }

            if (r.director) {
                if (!directorStats[r.director]) directorStats[r.director] = { count: 0, sumRating: 0, seenFranchises: new Set() };
                if (!directorStats[r.director].seenFranchises.has(franchiseKey)) {
                    directorStats[r.director].seenFranchises.add(franchiseKey);
                    directorStats[r.director].count++;
                    directorStats[r.director].sumRating += r.user_rating;
                }
            }

            if (r.studios) {
                const sList = JSON.parse(r.studios);
                sList.forEach(s => {
                    if (!studioStats[s]) studioStats[s] = { count: 0, sumRating: 0, seenFranchises: new Set() };
                    if (!studioStats[s].seenFranchises.has(franchiseKey)) {
                        studioStats[s].seenFranchises.add(franchiseKey);
                        studioStats[s].count++;
                        studioStats[s].sumRating += r.user_rating;
                    }
                });
            }

            if (r.release_year) {
                totalYear += r.release_year;
                validYearCount++;
            }
        });

        const avgDiscrepancy = (totalDiscrepancy / rows.length).toFixed(1);
        const avgYear = validYearCount > 0 ? Math.round(totalYear / validYearCount) : 'N/A';
        
        const sortStats = (statsObj, minCount = 1) => {
            return Object.keys(statsObj)
                .filter(k => statsObj[k].count >= minCount)
                .map(k => ({
                    name: k,
                    count: statsObj[k].count,
                    avgRating: (statsObj[k].sumRating / statsObj[k].count).toFixed(1)
                }))
                .sort((a, b) => b.count - a.count || b.avgRating - a.avgRating)
                .slice(0, 5);
        };

        const topGenres = sortStats(genreStats, 1);
        const topTags = sortStats(tagStats, 2);
        const topDirectors = sortStats(directorStats, 2);
        const topStudios = sortStats(studioStats, 2);

        let crowdRelation = "You agree with the community.";
        if (avgDiscrepancy > 0.5) crowdRelation = `You are generous! You rate anime ${avgDiscrepancy} points higher than AniList average.`;
        else if (avgDiscrepancy < -0.5) crowdRelation = `You are a tough critic! You rate anime ${Math.abs(avgDiscrepancy)} points lower than AniList average.`;

        let eraFact = "You watch anime from all eras.";
        if (avgYear !== 'N/A') {
            if (avgYear < 2000) eraFact = `You love the classics. Your average anime year is ${avgYear}.`;
            else if (avgYear > 2015) eraFact = `You prefer modern seasonal anime. Your average year is ${avgYear}.`;
            else eraFact = `You enjoy the golden age of shounen. Your average anime year is ${avgYear}.`;
        }

        const result = {
            total_logged: rows.length,
            top_genres: topGenres,
            top_directors: topDirectors,
            top_actors: topStudios,
            crowd_relation: crowdRelation,
            era_fact: eraFact
        };
        animeCache.insightsResult = result;
        res.json(result);

    } catch (error) {
        console.error('Anime Insights error:', error);
        res.status(500).json({ error: 'Failed to generate anime insights' });
    }
});

module.exports = router;
