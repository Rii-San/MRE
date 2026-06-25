const express = require('express');
const router = express.Router();
const db = require('../../db/db');
const { getCache } = require('../../engine/cache');

// GET /api/insights
router.get('/', (req, res) => {
    try {
        const movieCache = getCache('movie');
        if (movieCache.insightsResult) return res.json(movieCache.insightsResult);
        const rows = db.prepare(`
            SELECT w.user_rating, m.tmdb_id, m.tmdb_rating, COALESCE(m.primary_genres, m.genres) as active_genres, m.release_year, m.director, m.top_cast, m.collection_id 
            FROM watched w 
            JOIN movies m ON w.tmdb_id = m.tmdb_id
        `).all();

        if (rows.length === 0) {
            return res.json({ error: 'Log some movies first to see insights!' });
        }

        let totalDiscrepancy = 0;
        const genreStats = {};
        const directorStats = {};
        const actorStats = {};
        
        let totalYear = 0;
        let validYearCount = 0;

        rows.forEach(r => {
            // Identifier to prevent franchise domination
            const franchiseKey = r.collection_id ? `collection_${r.collection_id}` : `movie_${r.tmdb_id}`;

            // Rating discrepancy (User - TMDB)
            const diff = r.user_rating - (r.tmdb_rating || r.user_rating);
            totalDiscrepancy += diff;

            // Genres
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

            // Directors
            if (r.director) {
                if (!directorStats[r.director]) directorStats[r.director] = { count: 0, sumRating: 0, seenFranchises: new Set() };
                if (!directorStats[r.director].seenFranchises.has(franchiseKey)) {
                    directorStats[r.director].seenFranchises.add(franchiseKey);
                    directorStats[r.director].count++;
                    directorStats[r.director].sumRating += r.user_rating;
                }
            }

            // Actors
            if (r.top_cast) {
                const aList = JSON.parse(r.top_cast);
                aList.forEach(a => {
                    if (!actorStats[a]) actorStats[a] = { count: 0, sumRating: 0, seenFranchises: new Set() };
                    if (!actorStats[a].seenFranchises.has(franchiseKey)) {
                        actorStats[a].seenFranchises.add(franchiseKey);
                        actorStats[a].count++;
                        actorStats[a].sumRating += r.user_rating;
                    }
                });
            }

            // Eras
            if (r.release_year) {
                totalYear += r.release_year;
                validYearCount++;
            }
        });

        const avgDiscrepancy = (totalDiscrepancy / rows.length).toFixed(1);
        const avgYear = validYearCount > 0 ? Math.round(totalYear / validYearCount) : 'N/A';
        
        // Sort helper
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

        const sortStatsByScore = (statsObj, minCount = 1) => {
            return Object.keys(statsObj)
                .filter(k => statsObj[k].count >= minCount)
                .map(k => ({
                    name: k,
                    count: statsObj[k].count,
                    score: statsObj[k].sumRating / 10,
                    avgRating: (statsObj[k].sumRating / statsObj[k].count).toFixed(1)
                }))
                .sort((a, b) => b.score - a.score || b.count - a.count)
                .slice(0, 5);
        };

        const topGenres = sortStats(genreStats, 1);
        const topDirectors = sortStatsByScore(directorStats, 2); // At least 2 movies to be a top director
        const topActors = sortStatsByScore(actorStats, 2); // At least 2 movies to be a top actor

        // Generate a fun fact based on avgDiscrepancy
        let crowdRelation = "You agree with the crowd.";
        if (avgDiscrepancy > 0.5) crowdRelation = `You are generous! You rate movies ${avgDiscrepancy} points higher than TMDB average.`;
        else if (avgDiscrepancy < -0.5) crowdRelation = `You are a tough critic! You rate movies ${Math.abs(avgDiscrepancy)} points lower than TMDB average.`;

        // Generate era fact
        let eraFact = "You watch movies from all eras.";
        if (avgYear !== 'N/A') {
            if (avgYear < 1990) eraFact = `You love the classics. Your average movie year is ${avgYear}.`;
            else if (avgYear > 2010) eraFact = `You prefer modern cinema. Your average movie year is ${avgYear}.`;
            else eraFact = `You enjoy the golden age of blockbusters. Your average movie year is ${avgYear}.`;
        }

        const result = {
            total_logged: rows.length,
            top_genres: topGenres,
            top_directors: topDirectors,
            top_actors: topActors,
            crowd_relation: crowdRelation,
            era_fact: eraFact
        };
        movieCache.insightsResult = result;
        res.json(result);

    } catch (error) {
        console.error('Insights error:', error);
        res.status(500).json({ error: 'Failed to generate insights' });
    }
});

module.exports = router;
