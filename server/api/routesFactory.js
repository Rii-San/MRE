const express = require('express');

function createInsightsRouter(config) {
    const { getCache, domain, getItemsQuery, db, getFranchiseKey, mapItem } = config;
    const router = express.Router({ mergeParams: true });
    
    router.get('/', (req, res) => {
        try {
            const cache = getCache(domain);
            if (cache.insightsResult) return res.json(cache.insightsResult);
            
            const rows = getItemsQuery(db);
            if (rows.length === 0) return res.json({ error: `Log some ${domain} first to see insights!` });

            let totalDiscrepancy = 0;
            const cat1Stats = {}, cat2Stats = {}, cat3Stats = {}, cat4Stats = {};
            let totalYear = 0, validYearCount = 0;

            rows.forEach(r => {
                const item = mapItem(r);
                const franchiseKey = getFranchiseKey(r);
                const diff = item.user_rating - (item.db_rating || item.user_rating);
                totalDiscrepancy += diff;

                const processList = (listStr, statsObj) => {
                    if (listStr) {
                        try {
                            JSON.parse(listStr).forEach(val => {
                                if (!statsObj[val]) statsObj[val] = { count: 0, sumRating: 0, seenFranchises: new Set() };
                                if (!statsObj[val].seenFranchises.has(franchiseKey)) {
                                    statsObj[val].seenFranchises.add(franchiseKey);
                                    statsObj[val].count++;
                                    statsObj[val].sumRating += item.user_rating;
                                }
                            });
                        } catch(e) {}
                    }
                };

                const processScalar = (val, statsObj) => {
                    if (val) {
                        if (!statsObj[val]) statsObj[val] = { count: 0, sumRating: 0, seenFranchises: new Set() };
                        if (!statsObj[val].seenFranchises.has(franchiseKey)) {
                            statsObj[val].seenFranchises.add(franchiseKey);
                            statsObj[val].count++;
                            statsObj[val].sumRating += item.user_rating;
                        }
                    }
                };

                processList(item.genres, cat1Stats);
                processScalar(item.director, cat2Stats);
                processList(item.castOrStudios, cat3Stats);
                if (item.tags) processList(item.tags, cat4Stats);

                if (item.release_year) { totalYear += item.release_year; validYearCount++; }
            });

            const avgDiscrepancy = (totalDiscrepancy / rows.length).toFixed(1);
            const avgYear = validYearCount > 0 ? Math.round(totalYear / validYearCount) : 'N/A';
            
            const sortStats = (statsObj, minCount = 1) => Object.keys(statsObj).filter(k => statsObj[k].count >= minCount).map(k => ({ name: k, count: statsObj[k].count, avgRating: (statsObj[k].sumRating / statsObj[k].count).toFixed(1) })).sort((a, b) => b.count - a.count || b.avgRating - a.avgRating).slice(0, 5);
            const sortStatsByScore = (statsObj, minCount = 1) => Object.keys(statsObj).filter(k => statsObj[k].count >= minCount).map(k => ({ name: k, count: statsObj[k].count, score: statsObj[k].sumRating / 10, avgRating: (statsObj[k].sumRating / statsObj[k].count).toFixed(1) })).sort((a, b) => b.score - a.score || b.count - a.count).slice(0, 5);

            const topGenres = sortStats(cat1Stats, 1);
            const topDirectors = sortStatsByScore(cat2Stats, 2);
            const topCastOrStudios = sortStatsByScore(cat3Stats, 2);

            let crowdRelation = "You agree with the crowd.";
            const platformName = domain === 'movie' ? 'TMDB' : 'AniList';
            if (avgDiscrepancy > 0.5) crowdRelation = `You are generous! You rate ${domain}s ${avgDiscrepancy} points higher than ${platformName} average.`;
            else if (avgDiscrepancy < -0.5) crowdRelation = `You are a tough critic! You rate ${domain}s ${Math.abs(avgDiscrepancy)} points lower than ${platformName} average.`;

            let eraFact = `You watch ${domain}s from all eras.`;
            if (avgYear !== 'N/A') {
                if (domain === 'movie') {
                    if (avgYear < 1990) eraFact = `You love the classics. Your average movie year is ${avgYear}.`;
                    else if (avgYear > 2010) eraFact = `You prefer modern cinema. Your average movie year is ${avgYear}.`;
                    else eraFact = `You enjoy the golden age of blockbusters. Your average movie year is ${avgYear}.`;
                } else {
                    if (avgYear < 2000) eraFact = `You love the classics. Your average anime year is ${avgYear}.`;
                    else if (avgYear > 2015) eraFact = `You prefer modern seasonal anime. Your average year is ${avgYear}.`;
                    else eraFact = `You enjoy the golden age of shounen. Your average anime year is ${avgYear}.`;
                }
            }

            const result = { total_logged: rows.length, top_genres: topGenres, top_directors: topDirectors, top_actors: topCastOrStudios, crowd_relation: crowdRelation, era_fact: eraFact };
            cache.insightsResult = result;
            res.json(result);
        } catch (error) {
            console.error(`${domain} Insights error:`, error);
            res.status(500).json({ error: `Failed to generate ${domain} insights` });
        }
    });
    
    return router;
}

function createWatchlistRouter(config) {
    const { wdb, domain, invalidateWatchlist, getExistingQuery, insertQuery, deleteQuery, getAllQuery, typeName } = config;
    const router = express.Router({ mergeParams: true });

    router.get('/', (req, res) => {
        try {
            const rows = getAllQuery(wdb);
            res.json(rows);
        } catch (error) {
            console.error(`Error fetching ${domain} watchlist:`, error);
            res.status(500).json({ error: `Failed to fetch ${domain} watchlist` });
        }
    });

    router.post('/', (req, res) => {
        const id = req.body.anilist_id || req.body.tmdb_id;
        const title = req.body.title_english || req.body.title_romaji || req.body.title;
        const release_year = req.body.release_year;
        const cover_image = req.body.cover_image || req.body.poster_path;

        if (!id || !title) return res.status(400).json({ error: 'id and title are required' });

        try {
            const existing = getExistingQuery(wdb, id);
            if (existing) return res.status(400).json({ error: `Media already in ${domain} watchlist` });

            insertQuery(wdb, id, title, release_year, cover_image, req.body);
            invalidateWatchlist(domain);
            res.json({ success: true });
        } catch (error) {
            console.error(`Error adding to ${domain} watchlist:`, error);
            res.status(500).json({ error: `Failed to add to ${domain} watchlist` });
        }
    });

    router.delete('/:id', (req, res) => {
        try {
            const info = deleteQuery(wdb, req.params.id);
            if (info.changes === 0) return res.status(404).json({ error: 'Media not found in watchlist' });
            invalidateWatchlist(domain);
            res.json({ success: true });
        } catch (error) {
            console.error(`Error removing from ${domain} watchlist:`, error);
            res.status(500).json({ error: `Failed to remove from ${domain} watchlist` });
        }
    });

    router.get('/export', (req, res) => {
        try {
            const rows = getAllQuery(wdb);
            const exportData = { version: 1, exported_at: new Date().toISOString(), type: typeName, count: rows.length, entries: rows };
            res.setHeader('Content-Disposition', `attachment; filename="mre_${typeName}_${new Date().toISOString().slice(0,10)}.json"`);
            res.setHeader('Content-Type', 'application/json');
            res.json(exportData);
        } catch (error) {
            console.error(`${domain} Watchlist export error:`, error);
            res.status(500).json({ error: 'Failed to export watchlist' });
        }
    });

    router.post('/import', (req, res) => {
        const { entries, type } = req.body;
        if (!Array.isArray(entries) || type !== typeName) return res.status(400).json({ error: `Invalid import file. Expected a ${typeName} JSON.` });

        let imported = 0, skipped = 0;
        const errors = [];
        
        for (const entry of entries) {
            try {
                const id = entry.anilist_id || entry.tmdb_id;
                const title = entry.title_english || entry.title_romaji || entry.title;
                if (!id || !title) { skipped++; continue; }

                if (getExistingQuery(wdb, id)) { skipped++; continue; }

                insertQuery(wdb, id, title, entry.release_year, entry.cover_image || entry.poster_path, entry);
                imported++;
            } catch (err) {
                errors.push(`Entry ${title || id}: ${err.message}`);
            }
        }

        invalidateWatchlist(domain);
        res.json({ success: true, imported, skipped, errors: errors.slice(0, 5) });
    });

    return router;
}

module.exports = { createInsightsRouter, createWatchlistRouter };
