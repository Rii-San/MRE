const express = require('express');
const router = express.Router({ mergeParams: true });
const { fetchWithRetry } = require('../tmdb');
const { fetchWithAniListRetry } = require('../anilist');

router.get('/', async (req, res) => {
    try {
        const query = req.query.query;
        if (!query) return res.status(400).json({ error: 'Search query is required' });

        if (req.params.domain === 'anime') {
            const graphqlQuery = `
                query ($search: String) {
                    Page(page: 1, perPage: 10) {
                        media(search: $search, type: ANIME, sort: SEARCH_MATCH) {
                            id title { romaji english } startDate { year } coverImage { large } averageScore
                        }
                    }
                }
            `;
            const data = await fetchWithAniListRetry(graphqlQuery, { search: query });
            if (!data || data.errors) return res.status(500).json({ error: 'AniList GraphQL error' });
            
            const results = data.data.Page.media.map(m => ({
                id: m.id,
                title: m.title.english || m.title.romaji,
                release_date: m.startDate.year ? `${m.startDate.year}-01-01` : null,
                poster_path: m.coverImage.large,
                vote_average: m.averageScore ? (m.averageScore / 10) : 0
            }));
            res.json({ results });
        } else {
            const TMDB_API_KEY = process.env.TMDB_API_KEY;
            const url = `https://api.themoviedb.org/3/search/movie?query=${encodeURIComponent(query)}&api_key=${TMDB_API_KEY}`;
            const response = await fetchWithRetry(url);
            const data = await response.json();
            res.json(data);
        }
    } catch (error) {
        console.error('Error searching media:', error);
        res.status(500).json({ error: 'Failed to search media' });
    }
});

// POST /api/movies/bulk-match (Only for movies right now)
router.post('/bulk-match', async (req, res) => {
    try {
        if (req.params.domain === 'anime') return res.status(400).json({ error: 'Bulk match not implemented for anime' });
        
        const { titles } = req.body;
        if (!Array.isArray(titles) || titles.length === 0) return res.status(400).json({ error: 'Array of titles required' });

        const TMDB_API_KEY = process.env.TMDB_API_KEY;
        const results = [];
        const batchSize = 5;
        
        for (let i = 0; i < titles.length; i += batchSize) {
            const batch = titles.slice(i, i + batchSize);
            const batchPromises = batch.map(async (query) => {
                const url = `https://api.themoviedb.org/3/search/movie?query=${encodeURIComponent(query)}&api_key=${TMDB_API_KEY}`;
                const response = await fetchWithRetry(url);
                const data = await response.json();
                
                if (data.results && data.results.length > 0) {
                    return {
                        match_query: query, id: data.results[0].id, title: data.results[0].title,
                        release_year: data.results[0].release_date ? data.results[0].release_date.substring(0, 4) : 'N/A',
                        poster_path: data.results[0].poster_path
                    };
                }
                return { match_query: query, error: 'No match found' };
            });
            results.push(...(await Promise.all(batchPromises)));
        }
        res.json({ matches: results });
    } catch (error) {
        console.error('Bulk match error:', error);
        res.status(500).json({ error: 'Failed to bulk match movies' });
    }
});

module.exports = router;
