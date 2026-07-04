const db = require('./db/db');
const { getEmbedding } = require('./llm');
const { selectPrimaryGenres, computeGenreIDF } = require('./engine/genre_utils');
const { getCache, invalidateGenreIDF } = require('./engine/cache');
const logger = require('./utils/logger');

async function fetchOMDbPlot(imdb_id, title, year) {
    const OMDB_API_KEY = process.env.OMDB_API_KEY;
    if (!OMDB_API_KEY) {
        logger.warn('OMDB_API_KEY not set. Cannot fetch OMDb plot.', 'OMDb');
        return null;
    }

    try {
        let url = `http://www.omdbapi.com/?apikey=${OMDB_API_KEY}&plot=full`;
        if (imdb_id) {
            url += `&i=${imdb_id}`;
        } else {
            url += `&t=${encodeURIComponent(title)}`;
            if (year) {
                url += `&y=${year}`;
            }
        }

        const res = await fetchWithRetry(url);
        if (!res) return null;
        
        const data = await res.json();

        if (data.Response === 'True' && data.Plot && data.Plot !== 'N/A') {
            return data.Plot;
        } else {
            logger.warn(`No OMDb plot found for ${imdb_id || title}: ${data.Error || 'N/A plot'}`, 'OMDb');
        }
    } catch (e) {
        logger.warn(`Failed to fetch OMDb plot for ${imdb_id || title}: ${e.message}`, 'OMDb');
    }
    return null;
}
async function fetchWithRetry(url, retries = 5) {
    for (let i = 0; i < retries; i++) {
        try {
            const res = await fetch(url, {
                headers: {
                    'Accept': 'application/json',
                    'User-Agent': 'MRE-App/1.0'
                }
            });
            if (res.status === 429) {
                // TMDB rate limit hit — back off for 2 seconds before retrying
                logger.warn(`429 Rate Limit hit, backing off... (attempt ${i + 1})`, 'TMDB');
                await new Promise(r => setTimeout(r, 2000 * (i + 1)));
                continue;
            }
            if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);
            return res;
        } catch (err) {
            if (i === retries - 1) throw err;
            await new Promise(r => setTimeout(r, 1000 * (i + 1)));
        }
    }
}

async function fetchAndCacheMovie(tmdb_id) {
    const TMDB_API_KEY = process.env.TMDB_API_KEY;
    
    // Fetch movie details with appended credits and keywords
    const movieRes = await fetchWithRetry(`https://api.themoviedb.org/3/movie/${tmdb_id}?api_key=${TMDB_API_KEY}&append_to_response=credits,keywords`);
    const movieData = await movieRes.json();

    // Process data
    const title = movieData.title;
    const release_year = movieData.release_date ? parseInt(movieData.release_date.substring(0, 4)) : null;
    const runtime = movieData.runtime || 0;
    const country = movieData.production_countries && movieData.production_countries.length > 0 
        ? movieData.production_countries[0].name 
        : null;
    const genreNames = movieData.genres?.map(g => g.name) || [];
    const genres = JSON.stringify(genreNames);
    const keywords = JSON.stringify(movieData.keywords?.keywords?.map(k => k.name) || []);
    const tmdb_rating = movieData.vote_average || 0;
    const tmdb_votes = movieData.vote_count || 0;
    const overview = movieData.overview || '';
    
    // Extract rich metadata
    const director = movieData.credits?.crew?.find(c => c.job === 'Director')?.name || null;
    const top_cast = JSON.stringify(movieData.credits?.cast?.slice(0, 5).map(c => c.name) || []);
    const production_companies = JSON.stringify(movieData.production_companies?.map(p => p.name) || []);
    const original_language = movieData.original_language || null;
    const adult = movieData.adult ? 1 : 0;
    const poster_path = movieData.poster_path || null;
    const imdb_id = movieData.imdb_id || null;

    // Franchise/Collection tracking
    const collection_id = movieData.belongs_to_collection?.id || null;
    const collection_name = movieData.belongs_to_collection?.name || null;

    // Compute primary genres (top 2 most descriptive using IDF × position)
    // Build a quick IDF from all movies currently in the DB
    const movieCache = getCache('movie');
    let genreIDF = movieCache.genreIDF;
    if (!genreIDF) {
        const allGenreRows = db.prepare('SELECT genres FROM movies WHERE genres IS NOT NULL').all();
        const allGenreArrays = allGenreRows.map(r => { try { return JSON.parse(r.genres); } catch(e) { return []; } });
        genreIDF = computeGenreIDF(allGenreArrays);
        movieCache.genreIDF = genreIDF;
    }
    const primary_genres = JSON.stringify(selectPrimaryGenres(genreNames, genreIDF, 2));

    // Fetch dense semantic embedding from LM Studio using OMDb plot
    let plot_embedding = null;
    const omdbPlot = await fetchOMDbPlot(imdb_id, title, release_year);
    if (omdbPlot) {
        const embedArr = await getEmbedding(omdbPlot);
        if (embedArr) {
            plot_embedding = JSON.stringify(embedArr);
        }
    } else {
        logger.warn(`No OMDb plot found for ${title} (${release_year}), no embedding generated.`, 'OMDb');
    }

    // Insert into DB
    const stmt = db.prepare(`
        INSERT OR REPLACE INTO movies (tmdb_id, title, release_year, runtime, country, genres, keywords, tmdb_rating, tmdb_votes, overview, plot_embedding, director, top_cast, production_companies, original_language, adult, poster_path, collection_id, collection_name, primary_genres, last_updated)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `);
    
    stmt.run(tmdb_id, title, release_year, runtime, country, genres, keywords, tmdb_rating, tmdb_votes, overview, plot_embedding, director, top_cast, production_companies, original_language, adult, poster_path, collection_id, collection_name, primary_genres);
    invalidateGenreIDF('movie');
    
    return { tmdb_rating, title, release_year, runtime, country, genres, keywords, tmdb_votes, overview, plot_embedding, director, top_cast, production_companies, original_language, adult, collection_id, collection_name, primary_genres };
}

module.exports = { fetchWithRetry, fetchAndCacheMovie, fetchOMDbPlot };
