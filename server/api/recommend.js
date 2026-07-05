const express = require('express');
const router = express.Router({ mergeParams: true });
const movieDb = require('../db/db');
const animeDb = require('../db/anime_db');
const { fetchAndCacheMovie } = require('../tmdb');
const { fetchAndCacheAnime } = require('../anilist');
const { buildVocab, getFeatureNames, normalizeL2: normalizeMovie, vectorizeMovie, buildAnimeVocab, getAnimeFeatureNames, vectorizeAnime, normalizeAnime } = require('../engine/vectorize');
const { getTasteProfile, getDenseTasteProfile, getAnimeTasteProfile, getCrossPollinatedDenseProfile, cosineSimilarity, explainMatchDetailed, findMismatches, calculateMatchPercentage } = require('../engine/score');
const { applyBiases, computeAdaptiveSimilarity } = require('./scoringUtils');

async function handleRecommend(req, res) {
    const domain = req.params.domain;
    const id = req.body.tmdb_id || req.body.anilist_id;
    
    if (!id) return res.status(400).json({ error: 'id is required' });

    let item, db, fetchFn, vocabBuilder, profileFn, denseProfileFn, featureFn, vectorizeFn, normalizeFn;
    
    if (domain === 'anime') {
        db = animeDb;
        fetchFn = fetchAndCacheAnime;
        vocabBuilder = buildAnimeVocab;
        profileFn = () => getAnimeTasteProfile(vocabBuilder(db));
        denseProfileFn = () => getCrossPollinatedDenseProfile(movieDb, 'anime');
        featureFn = getAnimeFeatureNames;
        vectorizeFn = vectorizeAnime;
        normalizeFn = normalizeAnime;
        
        item = db.prepare('SELECT * FROM anime WHERE anilist_id = ?').get(id);
        if (!item) {
            await fetchFn(id);
            item = db.prepare('SELECT * FROM anime WHERE anilist_id = ?').get(id);
        }
    } else {
        db = movieDb;
        fetchFn = fetchAndCacheMovie;
        vocabBuilder = buildVocab;
        profileFn = () => getTasteProfile(db, vocabBuilder(db));
        denseProfileFn = () => getDenseTasteProfile(db);
        featureFn = getFeatureNames;
        vectorizeFn = vectorizeMovie;
        normalizeFn = normalizeMovie;
        
        item = db.prepare('SELECT * FROM movies WHERE tmdb_id = ?').get(id);
        if (!item) {
            await fetchFn(id);
            item = db.prepare('SELECT * FROM movies WHERE tmdb_id = ?').get(id);
        }
    }

    const vocab = vocabBuilder(db);
    const profileVec = profileFn();
    const denseProfileVec = denseProfileFn();
    
    if (!profileVec) return res.json({ score: 0, explanation: "Log some items with a rating to generate a taste profile!", movie: item });

    const featureNames = featureFn(vocab);
    let itemVec = normalizeFn(vectorizeFn(item, vocab));
    let tag_bias = cosineSimilarity(itemVec, profileVec);
    let story_bias = 0, narrative_bias = 0, finalSimilarity = tag_bias;
    const p = require('../services/profileService').getProfile();
    
    if (denseProfileVec && item.plot_embedding) {
        try {
            let itemDenseVec = normalizeFn(JSON.parse(item.plot_embedding));
            story_bias = cosineSimilarity(itemDenseVec, denseProfileVec);
            if (p && p.narrative_embedding) narrative_bias = cosineSimilarity(itemDenseVec, p.narrative_embedding);
            
            const keywordCount = domain === 'anime' ? (item.tags ? JSON.parse(item.tags).length : 0) : (item.keywords ? JSON.parse(item.keywords).length : 0);
            const genreCount = item.genres ? JSON.parse(item.genres).length : 0;
            const richness = Math.min(10, keywordCount + genreCount) / 10.0;
            finalSimilarity = computeAdaptiveSimilarity(tag_bias, story_bias, narrative_bias, richness);
        } catch (e) {}
    }
    
    const overview = domain === 'anime' ? item.description : item.overview;
    const biases = applyBiases(finalSimilarity, domain, { genres: item.genres, overview }, p);
    finalSimilarity = biases.finalSimilarity;
    const percentage = calculateMatchPercentage(finalSimilarity);
    const topContributions = explainMatchDetailed(itemVec, profileVec, featureNames);
    const reasons = topContributions.slice(0, 3).map(c => c.friendlyName);
    const mismatches = findMismatches(itemVec, profileVec, featureNames);

    let explanation = "Matches your taste profile.";
    if (reasons.length > 0) explanation = `High match due to: ${reasons.join(', ')}.`;
    let warning = null;
    if (mismatches.length > 0) warning = `Heads up: contains ${mismatches.slice(0,2).map(m => m.friendlyName).join(' and ')} — not usually your thing.`;

    res.json({
        score: percentage, explanation, warning, raw_cosine_similarity: tag_bias, dense_similarity: story_bias,
        narrative_bias, oracle_bias: biases.oracleBiasScore, spiritual_bias: biases.spiritualBiasScore,
        final_similarity: finalSimilarity, top_features: topContributions, mismatches, movie: item
    });
}

router.post('/predict', async (req, res) => {
    try {
        await handleRecommend(req, res);
    } catch (error) {
        console.error('Error predicting score:', error);
        res.status(500).json({ error: 'Failed to generate prediction' });
    }
});

async function handleMovieRecommend(req, res) {
    const fs = require('fs');
    const path = require('path');
    const cachePath = path.join(__dirname, '../db/recommend_cache_movie.json');
    if (req.query.regenerate !== 'true' && fs.existsSync(cachePath)) {
        try {
            const cachedData = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
            if (cachedData.movies && cachedData.movies.length > 0) {
                return res.json(cachedData);
            }
        } catch(e) {}
        return res.json({ movies: [], totalPages: 0, startPage: 1 });
    }

    const TMDB_API_KEY = process.env.TMDB_API_KEY;

    const { getMedoidSeedIds } = require('../services/preprocessor');
    const topWatchedIds = getMedoidSeedIds(movieDb, false);
    if (topWatchedIds.length === 0) return res.status(400).json({ error: 'Need rated movies logged to discover via recommendations!' });

    const movieCache = require('../engine/cache').getCache('movie');
    let watchedIds = movieCache.watchedIds;
    if (!watchedIds) {
        watchedIds = new Set(movieDb.prepare('SELECT tmdb_id FROM watched').all().map(r => r.tmdb_id));
        movieCache.watchedIds = watchedIds;
    }
    const movieWdb = require('../db/watchlistDb');
    let watchlistIds = movieCache.watchlistIds;
    if (!watchlistIds) {
        watchlistIds = new Set(movieWdb.prepare('SELECT tmdb_id FROM watchlist').all().map(r => r.tmdb_id));
        movieCache.watchlistIds = watchlistIds;
    }

    const candidateMap = new Map();
    const { fetchWithRetry } = require('../tmdb');
    for (const seedId of topWatchedIds) {
        try {
            const url = `https://api.themoviedb.org/3/movie/${seedId}/recommendations?api_key=${TMDB_API_KEY}`;
            const tmdbRes = await fetchWithRetry(url);
            const data = await tmdbRes.json();
            if (data.results) {
                for (const rec of data.results) {
                    if (!watchedIds.has(rec.id) && !watchlistIds.has(rec.id)) {
                        candidateMap.set(rec.id, rec);
                    }
                }
            }
        } catch(e) {}
    }

    let candidates = Array.from(candidateMap.values());
    if (candidates.length === 0) return res.status(404).json({ error: 'No un-watched candidates found matching criteria' });

    let totalPages = 1;
    const initialStartPage = 1;

    const vocab = buildVocab(movieDb);
    const profileVec = getTasteProfile(movieDb, vocab);
    const denseProfileVec = getDenseTasteProfile(movieDb);
    
    if (!profileVec) return res.status(400).json({ error: 'Need rated movies logged to discover!' });
    const featureNames = getFeatureNames(vocab);

    const random30 = [];
    let available = [...candidates];
    for(let i=0; i<30 && available.length > 0; i++) {
        const idx = Math.floor(Math.random() * available.length);
        random30.push(available.splice(idx, 1)[0]);
    }

    const CONCURRENCY_LIMIT = 15;
    let activeCount = 0;
    const queue = [];
    const runWithSemaphore = (fn) => new Promise((resolve, reject) => {
        const attempt = () => {
            if (activeCount < CONCURRENCY_LIMIT) {
                activeCount++;
                fn().then(resolve, reject).finally(() => { activeCount--; if (queue.length > 0) queue.shift()(); });
            } else { queue.push(attempt); }
        };
        attempt();
    });

    const { getEmbedding } = require('../llm');
    const { tmdbCache } = require('../utils/lru');
    const enrichedCandidates = await Promise.all(random30.map(movie =>
        runWithSemaphore(async () => {
            let keywords = [], director = null, top_cast = [], production_companies = [], genres = [];
            let imdb_id = null;
            try {
                const cachedTmdb = tmdbCache.get(movie.id);
                if (cachedTmdb) {
                    ({ keywords, director, top_cast, production_companies, genres, imdb_id } = cachedTmdb);
                    movie.overview = cachedTmdb.overview || movie.overview;
                } else {
                    const detailsData = await (await fetchWithRetry(`https://api.themoviedb.org/3/movie/${movie.id}?api_key=${TMDB_API_KEY}&append_to_response=credits,keywords`)).json();
                    if (detailsData.keywords?.keywords) keywords = detailsData.keywords.keywords.map(k => k.name);
                    if (detailsData.credits) {
                        director = detailsData.credits.crew?.find(c => c.job === 'Director')?.name || null;
                        top_cast = detailsData.credits.cast?.slice(0, 5).map(c => c.name) || [];
                    }
                    if (detailsData.production_companies) production_companies = detailsData.production_companies.map(p => p.name);
                    if (detailsData.genres) genres = detailsData.genres.map(g => g.name);
                    movie.overview = detailsData.overview || movie.overview;
                    imdb_id = detailsData.imdb_id || null;
                    tmdbCache.set(movie.id, { keywords, director, top_cast, production_companies, genres, overview: movie.overview, imdb_id });
                }
            } catch (e) {}

            let plot_embedding = null;
            try {
                const { fetchOMDbPlot } = require('../tmdb');
                const omdbPlot = await fetchOMDbPlot(imdb_id, movie.title, movie.release_date ? parseInt(movie.release_date.substring(0, 4)) : null);
                if (omdbPlot) {
                    const embedArr = await getEmbedding(omdbPlot);
                    if (embedArr) plot_embedding = JSON.stringify(embedArr);
                }
            } catch(e) {}
            return { ...movie, keywords_arr: keywords, plot_embedding, director, top_cast, production_companies, genres };
        })
    ));

    const scoredCandidates = enrichedCandidates.map(movie => {
        const formattedMovie = {
            tmdb_rating: movie.vote_average,
            runtime: 100, 
            release_year: movie.release_date ? parseInt(movie.release_date.substring(0,4)) : 2000,
            primary_genres: JSON.stringify(movie.genres),
            keywords: JSON.stringify(movie.keywords_arr),
            country: null,
            director: movie.director,
            top_cast: JSON.stringify(movie.top_cast),
            production_companies: JSON.stringify(movie.production_companies),
            original_language: movie.original_language,
            adult: movie.adult ? 1 : 0
        };
        
        let movieVec = normalizeMovie(vectorizeMovie(formattedMovie, vocab));
        let tag_bias = cosineSimilarity(movieVec, profileVec);
        let story_bias = 0, narrative_bias = 0, finalSimilarity = tag_bias;
        const p = require('../services/profileService').getProfile();
        let movieDenseVec = null;
        
        if (denseProfileVec && movie.plot_embedding) {
            try {
                movieDenseVec = normalizeMovie(JSON.parse(movie.plot_embedding));
                story_bias = cosineSimilarity(movieDenseVec, denseProfileVec);
                if (p && p.narrative_embedding) narrative_bias = cosineSimilarity(movieDenseVec, p.narrative_embedding);
                const richness = Math.min(10, (movie.keywords_arr?.length || 0) + 1) / 10.0;
                finalSimilarity = computeAdaptiveSimilarity(tag_bias, story_bias, narrative_bias, richness);
            } catch (e) {}
        }
        
        const biases = applyBiases(finalSimilarity, 'movie', { genres: movie.genres, overview: movie.overview }, p);
        finalSimilarity = biases.finalSimilarity;
        const percentage = calculateMatchPercentage(finalSimilarity);
        let weight = finalSimilarity;

        return {
            id: movie.id, title: movie.title, release_year: movie.release_date ? movie.release_date.substring(0,4) : 'N/A',
            tmdb_rating: movie.vote_average, overview: movie.overview, poster_path: movie.poster_path,
            match_score: percentage, raw_cosine_similarity: tag_bias, dense_similarity: story_bias, narrative_bias,
            oracle_bias: biases.oracleBiasScore, spiritual_bias: biases.spiritualBiasScore,
            final_similarity: finalSimilarity, weight_used: weight,
            top_features: explainMatchDetailed(movieVec, profileVec, featureNames),
            movieVec, movieDenseVec
        };
    });

    const { runMMR } = require('./scoringUtils');
    const selectedMovies = runMMR(scoredCandidates, 30, 0.7);
    selectedMovies.forEach(m => { delete m.movieVec; delete m.movieDenseVec; });
    const responseData = { movies: selectedMovies, totalPages, startPage: initialStartPage };
    
    try {
        fs.writeFileSync(cachePath, JSON.stringify(responseData));
    } catch(e) { console.error('Failed to write recommendation cache', e); }

    res.json(responseData);
}

async function handleAnimeRecommend(req, res) {
    const fs = require('fs');
    const path = require('path');
    const cachePath = path.join(__dirname, '../db/recommend_cache_anime.json');
    if (req.query.regenerate !== 'true' && fs.existsSync(cachePath)) {
        try {
            const cachedData = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
            if (cachedData.movies && cachedData.movies.length > 0) {
                return res.json(cachedData);
            }
        } catch(e) {}
        return res.json({ movies: [], totalPages: 0, startPage: 1 });
    }

    const { getMedoidSeedIds } = require('../services/preprocessor');
    const topWatchedIds = getMedoidSeedIds(animeDb, true);
    if (topWatchedIds.length === 0) return res.status(400).json({ error: 'Need rated anime logged to discover via recommendations!' });

    const animeCache = require('../engine/cache').getCache('anime');
    let watchedIds = animeCache.watchedIds;
    if (!watchedIds) { watchedIds = new Set(animeDb.prepare('SELECT anilist_id FROM watched_anime').all().map(r => r.anilist_id)); animeCache.watchedIds = watchedIds; }
    const animeWdb = require('../db/anime_watchlistDb');
    let watchlistIds = animeCache.watchlistIds;
    if (!watchlistIds) { watchlistIds = new Set(animeWdb.prepare('SELECT anilist_id FROM watchlist_anime').all().map(r => r.anilist_id)); animeCache.watchlistIds = watchlistIds; }

    const candidateMap = new Map();
    const REC_QUERY = `query ($id: Int) { Media(id: $id, type: ANIME) { recommendations(page: 1, perPage: 15, sort: RATING_DESC) { nodes { mediaRecommendation { id title { english romaji } startDate { year } episodes format genres tags { name rank } averageScore popularity description(asHtml: false) coverImage { extraLarge } isAdult staff(perPage: 5) { edges { role node { name { full } } } } studios(isMain: true) { edges { node { name } } } } } } } }`;

    const { fetchWithAniListRetry } = require('../anilist');
    for (const seedId of topWatchedIds) {
        try {
            const data = await fetchWithAniListRetry(REC_QUERY, { id: seedId });
            const recs = data?.data?.Media?.recommendations?.nodes || [];
            for (const node of recs) {
                const rec = node.mediaRecommendation;
                if (!rec) continue;
                if (!watchedIds.has(rec.id) && !watchlistIds.has(rec.id)) {
                    candidateMap.set(rec.id, rec);
                }
            }
        } catch(e) {}
    }

    let candidates = Array.from(candidateMap.values());
    if (candidates.length === 0) return res.status(404).json({ error: 'No un-watched candidates found matching criteria' });

    let totalPages = 1;
    const initialStartPage = 1;

    const vocab = buildAnimeVocab(animeDb);
    const profileVec = getAnimeTasteProfile(vocab);
    const denseProfileVec = getCrossPollinatedDenseProfile(movieDb, 'anime');
    if (!profileVec) return res.status(400).json({ error: 'Need rated anime logged to discover!' });
    const featureNames = getAnimeFeatureNames(vocab);

    const random30 = [];
    let available = [...candidates];
    for(let i=0; i<30 && available.length > 0; i++) random30.push(available.splice(Math.floor(Math.random() * available.length), 1)[0]);

    const { getEmbedding } = require('../llm');
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
        const formattedAnime = {
            release_year: anime.startDate?.year || 2010, episodes: anime.episodes || 12,
            genres: JSON.stringify(anime.genres || []), tags: JSON.stringify((anime.tags || []).filter(t => t.rank >= 60).map(t => t.name)),
            average_score: anime.averageScore || 50, adult: anime.isAdult ? 1 : 0,
            director: anime.staff?.edges?.find(e => e.role?.toLowerCase().includes('director'))?.node?.name?.full || null,
            studios: JSON.stringify(anime.studios?.edges?.map(e => e.node.name) || [])
        };
        
        let movieVec = normalizeAnime(vectorizeAnime(formattedAnime, vocab));
        let tag_bias = cosineSimilarity(movieVec, profileVec);
        let movieDenseVec = null, story_bias = tag_bias, narrative_bias = 0, finalSimilarity = tag_bias;
        const p = require('../services/profileService').getProfile();

        if (anime.plot_embedding && denseProfileVec) {
            try {
                movieDenseVec = normalizeAnime(JSON.parse(anime.plot_embedding));
                story_bias = cosineSimilarity(movieDenseVec, denseProfileVec);
                if (p && p.narrative_embedding) narrative_bias = cosineSimilarity(movieDenseVec, p.narrative_embedding);
                const richness = Math.min(10, (anime.tags?.length || 0) + (anime.genres?.length || 0)) / 10.0;
                finalSimilarity = computeAdaptiveSimilarity(tag_bias, story_bias, narrative_bias, richness);
            } catch(e) {}
        }

        const biases = applyBiases(finalSimilarity, 'anime', { genres: formattedAnime.genres, overview: anime.parsedDescription }, p);
        finalSimilarity = biases.finalSimilarity;
        const { calculateMatchPercentage } = require('../engine/score');
        const percentage = calculateMatchPercentage(finalSimilarity);
        
        let popPenalty = Math.max(0.7, Math.min(1.0, Math.log10(anime.popularity || 10) / 5));
        let weight = finalSimilarity * popPenalty;

        return {
            id: anime.id, title: anime.title.english || anime.title.romaji, release_year: formattedAnime.release_year,
            tmdb_rating: (anime.averageScore || 0) / 10, overview: anime.parsedDescription, poster_path: anime.coverImage?.extraLarge,
            match_score: percentage, raw_cosine_similarity: tag_bias, dense_similarity: story_bias, narrative_bias,
            oracle_bias: biases.oracleBiasScore, spiritual_bias: biases.spiritualBiasScore,
            final_similarity: finalSimilarity, weight_used: weight,
            top_features: explainMatchDetailed(movieVec, profileVec, featureNames).slice(0, 5),
            movieVec, movieDenseVec
        };
    });

    const { runMMR } = require('./scoringUtils');
    const selectedMovies = runMMR(scoredCandidates, 30, 0.7);
    selectedMovies.forEach(m => {
        m.explanation = `Matches your taste for ${m.top_features.slice(0, 3).map(e => e.friendlyName || e.rawName || e.name).join(', ')}.`;
        delete m.movieVec; delete m.movieDenseVec;
    });

    const responseData = { movies: selectedMovies, totalPages, startPage: initialStartPage };
    try {
        fs.writeFileSync(cachePath, JSON.stringify(responseData));
    } catch(e) { console.error('Failed to write anime recommendation cache', e); }

    res.json(responseData);
}

router.get('/', async (req, res) => {
    try {
        if (req.params.domain === 'anime') {
            await handleAnimeRecommend(req, res);
        } else {
            await handleMovieRecommend(req, res);
        }
    } catch (error) {
        console.error('Recommend error:', error);
        res.status(500).json({ error: 'Failed to recommend media' });
    }
});

module.exports = router;
