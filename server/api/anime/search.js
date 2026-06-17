const express = require('express');
const router = express.Router();
const { fetchWithAniListRetry } = require('../../anilist');

router.get('/', async (req, res) => {
    try {
        const query = req.query.query;
        if (!query) {
            return res.status(400).json({ error: 'Query parameter is required' });
        }

        const graphqlQuery = `
            query ($search: String) {
                Page(page: 1, perPage: 10) {
                    media(search: $search, type: ANIME, sort: SEARCH_MATCH) {
                        id
                        title {
                            romaji
                            english
                        }
                        startDate {
                            year
                        }
                        coverImage {
                            large
                        }
                        averageScore
                    }
                }
            }
        `;

        const data = await fetchWithAniListRetry(graphqlQuery, { search: query });
        
        if (!data || data.errors) {
            return res.status(500).json({ error: 'AniList GraphQL error' });
        }

        const results = data.data.Page.media.map(m => ({
            id: m.id,
            title: m.title.english || m.title.romaji,
            release_date: m.startDate.year ? `${m.startDate.year}-01-01` : null,
            poster_path: m.coverImage.large,
            vote_average: m.averageScore ? (m.averageScore / 10) : 0
        }));

        res.json({ results });
    } catch (error) {
        console.error('Error searching anime:', error);
        res.status(500).json({ error: 'Failed to search anime' });
    }
});

module.exports = router;
