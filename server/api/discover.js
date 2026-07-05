const express = require('express');
const router = express.Router({ mergeParams: true });
const movieDb = require('../db/db');
const animeDb = require('../db/anime_db');
const movieWdb = require('../db/watchlistDb');
const animeWdb = require('../db/anime_watchlistDb');
const { fetchWithRetry } = require('../tmdb');
const { fetchWithAniListRetry } = require('../anilist');
const { buildVocab, normalizeL2: normalizeMovie, vectorizeMovie, getFeatureNames, buildAnimeVocab, normalizeAnime, vectorizeAnime, getAnimeFeatureNames } = require('../engine/vectorize');
const { getTasteProfile, getDenseTasteProfile, getAnimeTasteProfile, getCrossPollinatedDenseProfile, cosineSimilarity, explainMatchDetailed, calculateMatchPercentage } = require('../engine/score');
const { getCache } = require('../engine/cache');
const { tmdbCache } = require('../utils/lru');
const { applyBiases, runMMR, computeAdaptiveSimilarity } = require('./scoringUtils');

const GENRE_MAP = {
    "Action": 28, "Adventure": 12, "Animation": 16, "Comedy": 35, "Crime": 80, 
    "Documentary": 99, "Drama": 18, "Family": 10751, "Fantasy": 14, "History": 36, 
    "Horror": 27, "Music": 10402, "Mystery": 9648, "Romance": 10749, 
    "Science Fiction": 878, "TV Movie": 10770, "Thriller": 53, "War": 10752, "Western": 37
};

async function handleMovieDiscover(req, res) {
    const { genre, sort_by, country, depth = 0 } = req.query;
    const TMDB_API_KEY = process.env.TMDB_API_KEY;
    const genreId = genre ? GENRE_MAP[genre] : null;

    const movieCache = getCache('movie');
    let watchedIds = movieCache.watchedIds;
    if (!watchedIds) {
        watchedIds = new Set(movieDb.prepare('SELECT tmdb_id FROM watched').all().map(r => r.tmdb_id));
        movieCache.watchedIds = watchedIds;
    }
    let watchlistIds = movieCache.watchlistIds;
    if (!watchlistIds) {
        watchlistIds = new Set(movieWdb.prepare('SELECT tmdb_id FROM watchlist').all().map(r => r.tmdb_id));
        movieCache.watchlistIds = watchlistIds;
    }

    let urlBase = `https://api.themoviedb.org/3/discover/movie?api_key=${TMDB_API_KEY}&vote_count.gte=50`;
    if (genreId) urlBase += `&with_genres=${genreId}`;
    if (country) urlBase += `&with_origin_country=${country}`;
    if (sort_by && sort_by !== 'random') {
        urlBase += `&sort_by=${sort_by}`;
    }

    let totalPages = 10;
    try {
        const initialRes = await fetchWithRetry(`${urlBase}&page=1`);
        const initialData = await initialRes.json();
        if (initialData.total_pages) {
            totalPages = Math.min(initialData.total_pages, 500);
        }
    } catch(e) {}

    const isRandom = !sort_by || sort_by === 'random';
    let startPage = 1;
    if (!isRandom) {
        startPage = Math.max(1, Math.floor((depth / 100) * totalPages));
    }

    let candidatesMap = new Map();
    let requestsMade = 0;
    let currentPage = isRandom ? Math.floor(Math.random() * totalPages) + 1 : startPage;

    while (candidatesMap.size < 40 && requestsMade < 10) {
        try {
            const res = await fetchWithRetry(`${urlBase}&page=${currentPage}`);
            const data = await res.json();
            if (data.results) {
                for (const m of data.results) {
                    if (!watchedIds.has(m.id) && !watchlistIds.has(m.id)) {
                        candidatesMap.set(m.id, m);
                    }
                }
            }
        } catch(e) {}
        requestsMade++;
        if (isRandom) {
            currentPage = Math.floor(Math.random() * totalPages) + 1;
        } else {
            currentPage++;
            if (currentPage > totalPages) currentPage = 1;
        }
    }

    let candidates = Array.from(candidatesMap.values());
    if (candidates.length === 0) return res.status(404).json({ error: 'No un-watched candidates found matching criteria' });

    const vocab = buildVocab(movieDb);
    const profileVec = getTasteProfile(movieDb, vocab);
    const denseProfileVec = getDenseTasteProfile(movieDb);
    
    if (!profileVec) return res.status(400).json({ error: 'Need rated movies logged to discover!' });
    const featureNames = getFeatureNames(vocab);

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
    const enrichedCandidates = await Promise.all(candidates.map(movie =>
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

    const selectedMovies = runMMR(scoredCandidates, 40, 0.7);
    selectedMovies.forEach(m => { delete m.movieVec; delete m.movieDenseVec; });
    res.json({ movies: selectedMovies, totalPages, startPage });
}

async function handleAnimeDiscover(req, res) {
    const { genre, sort_by, depth = 0 } = req.query;

    const animeGenreMap = {
        'Science Fiction': 'Sci-Fi',
        'Documentary': 'Slice of Life'
    };
    const mappedGenre = genre ? (animeGenreMap[genre] || genre) : null;

    const sortMap = {
        'popularity.desc': 'POPULARITY_DESC',
        'primary_release_date.desc': 'START_DATE_DESC',
        'vote_average.desc': 'SCORE_DESC',
        'revenue.desc': 'TRENDING_DESC'
    };
    const mappedSort = sort_by && sortMap[sort_by] ? sortMap[sort_by] : null;

    const animeCache = getCache('anime');
    let watchedIds = animeCache.watchedIds;
    if (!watchedIds) { watchedIds = new Set(animeDb.prepare('SELECT anilist_id FROM watched_anime').all().map(r => r.anilist_id)); animeCache.watchedIds = watchedIds; }
    let watchlistIds = animeCache.watchlistIds;
    if (!watchlistIds) { watchlistIds = new Set(animeWdb.prepare('SELECT anilist_id FROM watchlist_anime').all().map(r => r.anilist_id)); animeCache.watchlistIds = watchlistIds; }

    const PAGE_INFO_QUERY = `
    query ($genre: String, $sort: [MediaSort]) {
      Page(page: 1, perPage: 1) {
        pageInfo { lastPage }
        media(type: ANIME, genre: $genre, sort: $sort) { id }
      }
    }`;

    let totalPages = 10;
    try {
        const vars = {};
        if (mappedGenre) vars.genre = mappedGenre;
        if (mappedSort) vars.sort = [mappedSort];
        const pageInfoRes = await fetchWithAniListRetry(PAGE_INFO_QUERY, vars);
        if (pageInfoRes?.data?.Page?.pageInfo?.lastPage) {
            totalPages = Math.min(pageInfoRes.data.Page.pageInfo.lastPage, 500);
        }
    } catch(e) {}

    const isRandom = !sort_by || sort_by === 'random';
    let startPage = 1;
    if (!isRandom) {
        startPage = Math.max(1, Math.floor((depth / 100) * totalPages));
    }

    const DISCOVER_QUERY = `
    query ($page: Int, $genre: String, $sort: [MediaSort]) {
      Page(page: $page, perPage: 50) {
        media(type: ANIME, genre: $genre, sort: $sort) {
          id title { english romaji } startDate { year } episodes format genres tags { name rank }
          averageScore popularity description(asHtml: false) coverImage { extraLarge }
          isAdult staff(perPage: 5) { edges { role node { name { full } } } }
          studios(isMain: true) { edges { node { name } } }
        }
      }
    }`;

    let candidatesMap = new Map();
    let requestsMade = 0;
    let currentPage = isRandom ? Math.floor(Math.random() * totalPages) + 1 : startPage;

    while (candidatesMap.size < 40 && requestsMade < 10) {
        try {
            const vars = { page: currentPage };
            if (mappedGenre) vars.genre = mappedGenre;
            if (mappedSort) vars.sort = [mappedSort];

            const pageRes = await fetchWithAniListRetry(DISCOVER_QUERY, vars);
            const mediaList = pageRes?.data?.Page?.media || [];
            for (const m of mediaList) {
                if (!watchedIds.has(m.id) && !watchlistIds.has(m.id)) {
                    candidatesMap.set(m.id, m);
                }
            }
        } catch(e) {}
        requestsMade++;
        if (isRandom) {
            currentPage = Math.floor(Math.random() * totalPages) + 1;
        } else {
            currentPage++;
            if (currentPage > totalPages) currentPage = 1;
        }
    }

    let candidates = Array.from(candidatesMap.values());
    if (candidates.length === 0) return res.status(404).json({ error: 'No un-watched candidates found matching criteria' });

    const vocab = buildAnimeVocab(animeDb);
    const profileVec = getAnimeTasteProfile(vocab);
    const denseProfileVec = getCrossPollinatedDenseProfile(movieDb, 'anime');
    if (!profileVec) return res.status(400).json({ error: 'Need rated anime logged to discover!' });
    const featureNames = getAnimeFeatureNames(vocab);

    const { getEmbedding } = require('../llm');
    const enrichedCandidates = await Promise.all(candidates.map(async (media) => {
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

    const selectedMovies = runMMR(scoredCandidates, 40, 0.7);
    selectedMovies.forEach(m => {
        delete m.movieVec; delete m.movieDenseVec;
    });

    res.json({ movies: selectedMovies, totalPages, startPage });
}

router.get('/', async (req, res) => {
    try {
        if (req.params.domain === 'anime') {
            await handleAnimeDiscover(req, res);
        } else {
            await handleMovieDiscover(req, res);
        }
    } catch (error) {
        console.error('Discover error:', error);
        res.status(500).json({ error: 'Failed to discover media' });
    }
});

module.exports = router;
