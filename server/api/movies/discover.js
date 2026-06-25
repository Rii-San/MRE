const express = require('express');
const router = express.Router();
const db = require('../../db/db');
const { fetchWithRetry } = require('../../tmdb');
const { buildVocab, normalizeL2, vectorizeMovie, getFeatureNames } = require('../../engine/vectorize');
const { getTasteProfile, cosineSimilarity, explainMatchDetailed } = require('../../engine/score');
const { getCache } = require('../../engine/cache');

// TMDB Genre Map
const GENRE_MAP = {
    "Action": 28, "Adventure": 12, "Animation": 16, "Comedy": 35, "Crime": 80, 
    "Documentary": 99, "Drama": 18, "Family": 10751, "Fantasy": 14, "History": 36, 
    "Horror": 27, "Music": 10402, "Mystery": 9648, "Romance": 10749, 
    "Science Fiction": 878, "TV Movie": 10770, "Thriller": 53, "War": 10752, "Western": 37
};

// GET /api/discover?genre=Horror&hidden_gem=true
router.get('/', async (req, res) => {
    try {
        const { genre, hidden_gem, ai_prompt, sort_by, country, depth } = req.query;
        let targetGenre = genre;
        let yearStart = null;
        let yearEnd = null;
        const depthPct = Math.max(0, Math.min(100, parseInt(depth) || 0));

        const isRandomSort = !sort_by || sort_by === 'random';

        if (!targetGenre || !GENRE_MAP[targetGenre]) {
            return res.status(400).json({ error: 'Valid genre required or could not be parsed from prompt' });
        }

        const TMDB_API_KEY = process.env.TMDB_API_KEY;
        const genreId = GENRE_MAP[targetGenre];
        
        // Fetch 2 pages to get a pool of 40 candidates
        let totalPages = 10; // Default fallback
        try {
            let initUrl = `https://api.themoviedb.org/3/discover/movie?api_key=${TMDB_API_KEY}&with_genres=${genreId}&vote_count.gte=50`;
            if (yearStart) initUrl += `&primary_release_date.gte=${yearStart}-01-01`;
            if (yearEnd) initUrl += `&primary_release_date.lte=${yearEnd}-12-31`;
            if (country) initUrl += `&with_origin_country=${country}`;
            
            const initRes = await fetchWithRetry(initUrl);
            const initData = await initRes.json();
            if (initData.total_pages) {
                // TMDB strictly limits pagination to a maximum of 500 pages
                totalPages = Math.min(initData.total_pages, 500);
            }
        } catch (e) {
            console.error("Failed to fetch total_pages for discover", e);
        }

        const wdb = require('../../db/watchlistDb');
        const movieCache = getCache('movie');
        let watchedIds = movieCache.watchedIds;
        if (!watchedIds) {
            watchedIds = new Set(db.prepare('SELECT tmdb_id FROM watched').all().map(r => r.tmdb_id));
            movieCache.watchedIds = watchedIds;
        }
        let watchlistIds = movieCache.watchlistIds;
        if (!watchlistIds) {
            watchlistIds = new Set(wdb.prepare('SELECT tmdb_id FROM watchlist').all().map(r => r.tmdb_id));
            movieCache.watchlistIds = watchlistIds;
        }

        const targetCandidateCount = 40;
        const maxApiFetches = 10;
        const candidates = [];
        let apiFetches = 0;
        
        let currentPage = 1;
        if (!isRandomSort && depthPct > 0) {
            currentPage = Math.floor((depthPct / 100) * totalPages) + 1;
            currentPage = Math.min(currentPage, totalPages);
        }
        const initialStartPage = currentPage;
        const seenPages = new Set();

        while (candidates.length < targetCandidateCount && apiFetches < maxApiFetches) {
            let page;
            if (isRandomSort) {
                page = Math.floor(Math.random() * totalPages) + 1;
                if (seenPages.has(page)) {
                    if (seenPages.size >= totalPages) break;
                    continue;
                }
            } else {
                page = currentPage;
            }
            seenPages.add(page);
            apiFetches++;

            let url = `https://api.themoviedb.org/3/discover/movie?api_key=${TMDB_API_KEY}&with_genres=${genreId}&page=${page}&vote_count.gte=50`;
            if (!isRandomSort) url += `&sort_by=${sort_by}`;
            if (yearStart) url += `&primary_release_date.gte=${yearStart}-01-01`;
            if (yearEnd) url += `&primary_release_date.lte=${yearEnd}-12-31`;
            if (country) url += `&with_origin_country=${country}`;
            
            const tmdbRes = await fetchWithRetry(url);
            const data = await tmdbRes.json();
            
            if (data.results && data.results.length > 0) {
                const unseen = data.results.filter(m => !watchedIds.has(m.id) && !watchlistIds.has(m.id));
                candidates.push(...unseen);
            }
            
            if (!isRandomSort) {
                currentPage++;
                if (currentPage > totalPages) break;
            } else {
                if (seenPages.size >= totalPages) break;
            }
        }

        if (candidates.length === 0) {
            return res.status(404).json({ error: 'No candidates found (or all candidates have already been watched/watchlisted)' });
        }

        // We already filtered unseen, so filteredCandidates is just candidates
        const filteredCandidates = candidates;

        // Build Engine
        const vocab = buildVocab(db);
        const profileVec = getTasteProfile(db, vocab);
        const { getDenseTasteProfile } = require('../../engine/score');
        const denseProfileVec = getDenseTasteProfile(db);
        
        if (!profileVec) {
            return res.status(400).json({ error: 'Need rated movies logged to discover!' });
        }

        const featureNames = getFeatureNames(vocab);

        // Pick 30 random candidates to fetch deep data for
        const random30 = [];
        let available = [...filteredCandidates];
        for(let i=0; i<30 && available.length > 0; i++) {
            const idx = Math.floor(Math.random() * available.length);
            random30.push(available[idx]);
            available.splice(idx, 1);
        }

        // Semaphore: cap concurrent TMDB connections at 15 (TMDB max is 20 per IP)
        const CONCURRENCY_LIMIT = 15;
        let activeCount = 0;
        const queue = [];
        const runWithSemaphore = (fn) => new Promise((resolve, reject) => {
            const attempt = () => {
                if (activeCount < CONCURRENCY_LIMIT) {
                    activeCount++;
                    fn().then(resolve, reject).finally(() => {
                        activeCount--;
                        if (queue.length > 0) queue.shift()();
                    });
                } else {
                    queue.push(attempt);
                }
            };
            attempt();
        });

        const { getEmbedding } = require('../../llm');

        // Fetch rich metadata concurrently for the 30 candidates, capped at 15 simultaneous connections
        const enrichedCandidates = await Promise.all(random30.map(movie =>
            runWithSemaphore(async () => {
                let keywords = [];
                let director = null;
                let top_cast = [];
                let production_companies = [];
                let genres = [targetGenre]; // Default fallback
                
                try {
                    const detailsRes = await fetchWithRetry(`https://api.themoviedb.org/3/movie/${movie.id}?api_key=${TMDB_API_KEY}&append_to_response=credits,keywords`);
                    const detailsData = await detailsRes.json();
                    
                    if (detailsData.keywords && detailsData.keywords.keywords) {
                        keywords = detailsData.keywords.keywords.map(k => k.name);
                    }
                    if (detailsData.credits) {
                        director = detailsData.credits.crew?.find(c => c.job === 'Director')?.name || null;
                        top_cast = detailsData.credits.cast?.slice(0, 5).map(c => c.name) || [];
                    }
                    if (detailsData.production_companies) {
                        production_companies = detailsData.production_companies.map(p => p.name);
                    }
                    if (detailsData.genres) {
                        genres = detailsData.genres.map(g => g.name);
                    }
                    movie.overview = detailsData.overview || movie.overview;
                    movie.original_language = detailsData.original_language || movie.original_language;
                } catch (e) {}

                let plot_embedding = null;
                if (movie.overview) {
                    const embedArr = await getEmbedding(movie.overview);
                    if (embedArr) plot_embedding = JSON.stringify(embedArr);
                }

                return { ...movie, keywords_arr: keywords, plot_embedding, director, top_cast, production_companies, genres };
            })
        ));

        // Score candidates
        const scoredCandidates = enrichedCandidates.map(movie => {
            const formattedMovie = {
                tmdb_rating: movie.vote_average,
                runtime: 100, 
                release_year: movie.release_date ? parseInt(movie.release_date.substring(0,4)) : 2000,
                primary_genres: JSON.stringify(movie.genres), // Using fetched genres
                keywords: JSON.stringify(movie.keywords_arr),
                country: null,
                director: movie.director,
                top_cast: JSON.stringify(movie.top_cast),
                production_companies: JSON.stringify(movie.production_companies),
                original_language: movie.original_language,
                adult: movie.adult ? 1 : 0
            };
            
            let movieVec = vectorizeMovie(formattedMovie, vocab);
            movieVec = normalizeL2(movieVec);
            const sparseSimilarity = cosineSimilarity(movieVec, profileVec);
            
            let denseSimilarity = 0;
            let finalSimilarity = sparseSimilarity;

            let movieDenseVec = null;
            if (denseProfileVec && movie.plot_embedding) {
                try {
                    movieDenseVec = JSON.parse(movie.plot_embedding);
                    movieDenseVec = normalizeL2(movieDenseVec);
                    denseSimilarity = cosineSimilarity(movieDenseVec, denseProfileVec);
                    
                    // Adaptive Blending based on Metadata Richness
                    const keywordCount = movie.keywords_arr ? movie.keywords_arr.length : 0;
                    const genreCount = 1; // Since we approximate with targetGenre
                    const richness = Math.min(10, keywordCount + genreCount) / 10.0;
                    
                    const sparseWeight = 0.20 + (0.45 * richness);
                    const denseWeight = 1.0 - sparseWeight;
                    
                    finalSimilarity = (sparseSimilarity * sparseWeight) + (denseSimilarity * denseWeight);
                } catch (e) {}
            }
            
            // Use a sigmoid function to scale the raw similarity score into a human-readable percentage
            const shifted = (finalSimilarity - 0.35) * 10;
            const sigmoid = 1 / (1 + Math.exp(-shifted));
            const percentage = Math.min(Math.round(sigmoid * 100), 100);

            let weight = finalSimilarity;
            if (hidden_gem === 'true') {
                const tmdbRating = movie.vote_average || 5;
                if (tmdbRating < 6.5) weight *= 1.5;
            }

            const features = explainMatchDetailed(movieVec, profileVec, featureNames);

            return {
                id: movie.id,
                title: movie.title,
                release_year: movie.release_date ? movie.release_date.substring(0,4) : 'N/A',
                tmdb_rating: movie.vote_average,
                overview: movie.overview,
                poster_path: movie.poster_path,
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

        // Run Maximal Marginal Relevance (MMR) to select the final 10
        // MMR balances relevance (match_score) with diversity (cosine distance from already selected movies)
        const lambda = 0.7; // 0.7 leans heavily on relevance, but enforces enough diversity to avoid duplicates
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
                    
                    // Find max redundancy (similarity) with already selected movies
                    let maxRedundancy = 0;
                    for (const sel of selectedMovies) {
                        let simSparse = cosineSimilarity(cand.movieVec, sel.movieVec);
                        let simDense = 0;
                        if (cand.movieDenseVec && sel.movieDenseVec) {
                            simDense = cosineSimilarity(cand.movieDenseVec, sel.movieDenseVec);
                        }
                        const simFinal = (simSparse * 0.5) + (simDense * 0.5); // Fixed 50/50 for redundancy check
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
        
        // Clean up vectors before sending to client
        selectedMovies.forEach(m => {
            delete m.movieVec;
            delete m.movieDenseVec;
        });

        res.json({ movies: selectedMovies, totalPages, startPage: initialStartPage });

    } catch (error) {
        console.error('Discover error:', error);
        res.status(500).json({ error: 'Failed to discover movies' });
    }
});

module.exports = router;
