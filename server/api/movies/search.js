const express = require('express');
const router = express.Router();

async function fetchWithRetry(url, retries = 5) {
    for (let i = 0; i < retries; i++) {
        try {
            const res = await fetch(url);
            if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);
            return res;
        } catch (err) {
            if (i === retries - 1) throw err;
            await new Promise(r => setTimeout(r, 1000 * (i + 1)));
        }
    }
}

// GET /api/movies/search?query=alien
router.get('/search', async (req, res) => {
    try {
        const { query } = req.query;
        if (!query) {
            return res.status(400).json({ error: 'Search query is required' });
        }

        const TMDB_API_KEY = process.env.TMDB_API_KEY;
        const url = `https://api.themoviedb.org/3/search/movie?query=${encodeURIComponent(query)}&api_key=${TMDB_API_KEY}`;
        
        const response = await fetchWithRetry(url);
        
        const data = await response.json();
        res.json(data);
    } catch (error) {
        console.error('Error searching movies:', error);
        res.status(500).json({ error: 'Failed to search movies' });
    }
});

// POST /api/movies/bulk-match
router.post('/bulk-match', async (req, res) => {
    try {
        const { titles } = req.body;
        if (!Array.isArray(titles) || titles.length === 0) {
            return res.status(400).json({ error: 'Array of titles required' });
        }

        const TMDB_API_KEY = process.env.TMDB_API_KEY;
        const results = [];

        // We process concurrently but in batches to avoid rate limits
        const batchSize = 5;
        for (let i = 0; i < titles.length; i += batchSize) {
            const batch = titles.slice(i, i + batchSize);
            const batchPromises = batch.map(async (query) => {
                const url = `https://api.themoviedb.org/3/search/movie?query=${encodeURIComponent(query)}&api_key=${TMDB_API_KEY}`;
                const response = await fetchWithRetry(url);
                const data = await response.json();
                
                let bestMatch = null;
                if (data.results && data.results.length > 0) {
                    bestMatch = {
                        match_query: query,
                        id: data.results[0].id,
                        title: data.results[0].title,
                        release_year: data.results[0].release_date ? data.results[0].release_date.substring(0, 4) : 'N/A',
                        poster_path: data.results[0].poster_path
                    };
                } else {
                    bestMatch = { match_query: query, error: 'No match found' };
                }
                return bestMatch;
            });
            
            const batchResults = await Promise.all(batchPromises);
            results.push(...batchResults);
        }

        res.json({ matches: results });
    } catch (error) {
        console.error('Bulk match error:', error);
        res.status(500).json({ error: 'Failed to bulk match movies' });
    }
});

module.exports = router;
