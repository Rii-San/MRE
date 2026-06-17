const express = require('express');
const router = express.Router();
const db = require('../../db/anime_db');
const wdb = require('../../db/anime_watchlistDb');
const movieDb = require('../../db/db');
const { fetchWithAniListRetry } = require('../../anilist');
const { buildAnimeVocab, normalizeL2, vectorizeAnime, getAnimeFeatureNames } = require('../../engine/vectorize_anime');
const { getAnimeTasteProfile, getCrossPollinatedDenseProfile, cosineSimilarity, explainMatchDetailed } = require('../../engine/score');

// GET /api/anime_discover?genre=Action
router.get('/', async (req, res) => {
    try {
        let { genre, sort_by } = req.query;

        if (!genre) {
            return res.status(400).json({ error: 'Valid genre required' });
        }

        const animeGenreMap = {
            'Science Fiction': 'Sci-Fi',
            'Documentary': 'Slice of Life'
        };
        genre = animeGenreMap[genre] || genre;

        const isRandomSort = !sort_by || sort_by === 'random';

        let anilistSort = 'POPULARITY_DESC';
        if (!isRandomSort) {
            const sortMap = {
                'popularity.desc': 'POPULARITY_DESC',
                'primary_release_date.desc': 'START_DATE_DESC',
                'vote_average.desc': 'SCORE_DESC',
                'revenue.desc': 'TRENDING_DESC' // fallback for AniList
            };
            anilistSort = sortMap[sort_by] || 'POPULARITY_DESC';
        }

        const DISCOVER_QUERY = `
        query ($page: Int, $genre: String, $sort: [MediaSort]) {
            Page(page: $page, perPage: 20) {
                media(type: ANIME, genre: $genre, sort: $sort, averageScore_greater: 60) {
                    id
                    title { english romaji }
                    startDate { year }
                    episodes
                    format
                    genres
                    tags { name rank }
                    averageScore
                    popularity
                    description(asHtml: false)
                    coverImage { extraLarge }
                    isAdult
                    staff(perPage: 5) {
                        edges { role node { name { full } } }
                    }
                    studios(isMain: true) {
                        edges { node { name } }
                    }
                }
            }
        }`;

        const candidates = [];
        const sortParam = [anilistSort];

        for (let i = 0; i < 2; i++) {
            const page = isRandomSort ? (Math.floor(Math.random() * 10) + 1) : (i + 1);
            const data = await fetchWithAniListRetry(DISCOVER_QUERY, { page, genre, sort: sortParam });
            if (data?.data?.Page?.media) {
                candidates.push(...data.data.Page.media);
            }
        }

        const watchedIds = new Set(db.prepare('SELECT anilist_id FROM watched_anime').all().map(r => r.anilist_id));
        const watchlistIds = new Set(wdb.prepare('SELECT anilist_id FROM watchlist_anime').all().map(r => r.anilist_id));

        const filteredCandidates = candidates.filter(m => !watchedIds.has(m.id) && !watchlistIds.has(m.id));

        if (filteredCandidates.length === 0) {
            return res.status(404).json({ error: 'No candidates found' });
        }

        // Build Engine
        const vocab = buildAnimeVocab(db);
        const profileVec = getAnimeTasteProfile(vocab);
        
        // ** CROSS-POLLINATION: Combine 80% Anime Dense + 20% Movie Dense **
        const denseProfileVec = getCrossPollinatedDenseProfile(movieDb, 'anime');
        
        if (!profileVec) {
            return res.status(400).json({ error: 'Need rated anime logged to discover!' });
        }

        const featureNames = getAnimeFeatureNames(vocab);

        const random30 = [];
        let available = [...filteredCandidates];
        for(let i=0; i<30 && available.length > 0; i++) {
            const idx = Math.floor(Math.random() * available.length);
            random30.push(available[idx]);
            available.splice(idx, 1);
        }

        const { getEmbedding } = require('../../llm');

        const enrichedCandidates = await Promise.all(random30.map(async (media) => {
            let plot_embedding = null;
            const description = (media.description || '').replace(/<[^>]*>?/gm, '');
            if (description) {
                const embedArr = await getEmbedding(description);
                if (embedArr) plot_embedding = JSON.stringify(embedArr);
            }
            return { ...media, plot_embedding, parsedDescription: description };
        }));

        const scoredCandidates = enrichedCandidates.map(anime => {
            const tags = (anime.tags || []).filter(t => t.rank >= 60).map(t => t.name);
            
            let director = null;
            if (anime.staff && anime.staff.edges) {
                const d_edge = anime.staff.edges.find(e => e.role && e.role.toLowerCase().includes('director'));
                if (d_edge && d_edge.node && d_edge.node.name) director = d_edge.node.name.full;
            }

            let studios = [];
            if (anime.studios && anime.studios.edges) {
                studios = anime.studios.edges.map(e => e.node.name);
            }

            const formattedAnime = {
                release_year: anime.startDate?.year || 2010,
                episodes: anime.episodes || 12,
                genres: JSON.stringify(anime.genres || []),
                tags: JSON.stringify(tags),
                average_score: anime.averageScore || 50,
                director: director,
                studios: JSON.stringify(studios),
                adult: anime.isAdult ? 1 : 0
            };
            
            let movieVec = vectorizeAnime(formattedAnime, vocab);
            movieVec = normalizeL2(movieVec);

            let sparseSimilarity = cosineSimilarity(movieVec, profileVec);
            
            let movieDenseVec = null;
            let denseSimilarity = 0;
            if (anime.plot_embedding && denseProfileVec) {
                movieDenseVec = normalizeL2(JSON.parse(anime.plot_embedding));
                denseSimilarity = cosineSimilarity(movieDenseVec, denseProfileVec);
            } else {
                denseSimilarity = sparseSimilarity; // fallback
            }

            // Blend similarities
            const finalSimilarity = (sparseSimilarity * 0.4) + (denseSimilarity * 0.6);
            
            // Use a sigmoid function to scale the raw similarity score into a human-readable percentage
            const shifted = (finalSimilarity - 0.35) * 10;
            const sigmoid = 1 / (1 + Math.exp(-shifted));
            const percentage = Math.min(Math.round(sigmoid * 100), 100);
            
            // Adjust weight by AniList popularity (log scale) to avoid pushing literal trash
            let popPenalty = Math.log10(anime.popularity || 10) / 5; 
            popPenalty = Math.min(1.0, Math.max(0.7, popPenalty));
            const weight = finalSimilarity * popPenalty;

            // Generate explanations right away to mimic movies discover
            const features = explainMatchDetailed(movieVec, profileVec, featureNames).slice(0, 5);

            return {
                id: anime.id,
                title: anime.title.english || anime.title.romaji,
                release_year: formattedAnime.release_year,
                tmdb_rating: (anime.averageScore || 0) / 10,
                overview: anime.parsedDescription,
                poster_path: anime.coverImage?.extraLarge,
                match_score: percentage,
                raw_cosine_similarity: sparseSimilarity,
                dense_similarity: denseSimilarity,
                final_similarity: finalSimilarity,
                weight_used: weight,
                top_features: features,
                movieVec: movieVec,
                movieDenseVec: movieDenseVec
            };
        });

        // MMR
        const lambda = 0.7; 
        const selectedMovies = [];
        let remaining = [...scoredCandidates];

        while (selectedMovies.length < 10 && remaining.length > 0) {
            if (selectedMovies.length === 0) {
                remaining.sort((a, b) => b.weight_used - a.weight_used);
                selectedMovies.push(remaining.shift());
            } else {
                let bestIdx = -1;
                let bestMMR = -Infinity;
                
                for (let i = 0; i < remaining.length; i++) {
                    const cand = remaining[i];
                    let maxRedundancy = 0;
                    for (const sel of selectedMovies) {
                        let simSparse = cosineSimilarity(cand.movieVec, sel.movieVec);
                        let simDense = 0;
                        if (cand.movieDenseVec && sel.movieDenseVec) simDense = cosineSimilarity(cand.movieDenseVec, sel.movieDenseVec);
                        const simFinal = (simSparse * 0.5) + (simDense * 0.5);
                        if (simFinal > maxRedundancy) maxRedundancy = simFinal;
                    }
                    
                    const mmrScore = (lambda * cand.weight_used) - ((1.0 - lambda) * maxRedundancy);
                    if (mmrScore > bestMMR) {
                        bestMMR = mmrScore;
                        bestIdx = i;
                    }
                }
                
                selectedMovies.push(remaining[bestIdx]);
                remaining.splice(bestIdx, 1);
            }
        }

        // Add explanations
        selectedMovies.forEach(m => {
            const pos = m.top_features.slice(0, 3).map(e => e.friendlyName).join(', ');
            m.explanation = `Matches your taste for ${pos}.`;
        });

        res.json({ movies: selectedMovies });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to discover anime' });
    }
});

module.exports = router;
