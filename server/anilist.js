const db = require('./db/anime_db');
const { getEmbedding } = require('./llm');
const { selectPrimaryGenres, computeGenreIDF } = require('./engine/genre_utils');
const { getCache, invalidateGenreIDF } = require('./engine/cache');

const ANILIST_API_URL = 'https://graphql.anilist.co';

async function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Global Promise Queue to strictly enforce 1 req / 0.75s locally and prevent race conditions
let aniListQueuePromise = Promise.resolve();

async function fetchWithAniListRetry(query, variables, retries = 3) {
    for (let i = 0; i < retries; i++) {
        // Wait in line for our turn
        await aniListQueuePromise;
        
        // Lock the queue for the next requester
        let releaseNext;
        aniListQueuePromise = new Promise(resolve => { releaseNext = resolve; });

        try {
            const response = await fetch(ANILIST_API_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                },
                body: JSON.stringify({ query, variables })
            });

            // Release the lock for the next request after 750ms (enforcing 90/min)
            setTimeout(releaseNext, 750);

            // Check rate limits from headers
            const remaining = parseInt(response.headers.get('x-ratelimit-remaining') || '90');
            if (remaining < 5) {
                console.log(`[AniList] Approaching rate limit (${remaining} left). Pausing globally for 5 seconds...`);
                // Append a 5 second penalty to the global queue
                aniListQueuePromise = aniListQueuePromise.then(() => delay(5000));
            }

            if (response.status === 429) {
                const retryAfter = parseInt(response.headers.get('retry-after') || '60');
                console.warn(`[AniList] 429 Rate Limited! Sleeping globally for ${retryAfter} seconds...`);
                // Append the rate limit penalty to the global queue
                aniListQueuePromise = aniListQueuePromise.then(() => delay(retryAfter * 1000));
                continue; // retry
            }

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`AniList HTTP Error: ${response.status} - ${errText}`);
            }

            return await response.json();
        } catch (error) {
            // Ensure the queue is released even if the fetch throws a network error
            if (typeof releaseNext === 'function') releaseNext();
            
            console.error(`[AniList] Fetch error: ${error.message}`);
            if (i === retries - 1) throw error;
            await delay(2000 * (i + 1));
        }
    }
}

const ANIME_DETAILS_QUERY = `
query ($id: Int) {
  Media(id: $id, type: ANIME) {
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
    relations {
      edges {
        relationType
        node { id }
      }
    }
  }
}
`;

async function fetchAndCacheAnime(anilist_id) {
    const data = await fetchWithAniListRetry(ANIME_DETAILS_QUERY, { id: anilist_id });
    
    if (!data || !data.data || !data.data.Media) {
        throw new Error(`Anime not found for ID: ${anilist_id}`);
    }

    const media = data.data.Media;
    
    const title_english = media.title.english || media.title.romaji || null;
    const title_romaji = media.title.romaji || media.title.english || null;
    const release_year = media.startDate?.year || null;
    const episodes = media.episodes || null;
    const format = media.format || null;
    
    const genreNames = media.genres || [];
    const genres = JSON.stringify(genreNames);
    
    // Compute primary genres
    const animeCache = getCache('anime');
    let genreIDF = animeCache.genreIDF;
    if (!genreIDF) {
        const allGenreRows = db.prepare('SELECT genres FROM anime WHERE genres IS NOT NULL').all();
        const allGenreArrays = allGenreRows.map(r => { try { return JSON.parse(r.genres); } catch(e) { return []; } });
        genreIDF = computeGenreIDF(allGenreArrays);
        animeCache.genreIDF = genreIDF;
    }
    const primary_genres = JSON.stringify(selectPrimaryGenres(genreNames, genreIDF, 2));
    
    // Filter tags to meaningful ones (rank > 60%) to prevent noise
    const tags = JSON.stringify((media.tags || []).filter(t => t.rank >= 60).map(t => t.name));
    
    const average_score = media.averageScore || 0;
    const popularity = media.popularity || 0;
    const description = (media.description || '').replace(/<[^>]*>?/gm, ''); // Strip lingering HTML
    const cover_image = media.coverImage?.extraLarge || null;
    const adult = media.isAdult ? 1 : 0;
    
    // Extract Director from Staff
    let director = null;
    if (media.staff && media.staff.edges) {
        const d_edge = media.staff.edges.find(e => e.role && e.role.toLowerCase().includes('director'));
        if (d_edge && d_edge.node && d_edge.node.name) director = d_edge.node.name.full;
    }

    // Extract Studio
    let studios = [];
    if (media.studios && media.studios.edges) {
        studios = media.studios.edges.map(e => e.node.name);
    }
    const studios_str = JSON.stringify(studios);

    // Extract Franchise Group ID
    // We group by finding the lowest anilist_id in the relations chain
    // (SEQUEL, PREQUEL, SIDE_STORY, PARENT, ALTERNATIVE)
    let franchise_group_id = anilist_id;
    if (media.relations && media.relations.edges) {
        const validRelations = ['SEQUEL', 'PREQUEL', 'SIDE_STORY', 'PARENT', 'ALTERNATIVE'];
        const relatedIds = media.relations.edges
            .filter(e => validRelations.includes(e.relationType) && e.node && e.node.id)
            .map(e => e.node.id);
        
        if (relatedIds.length > 0) {
            // Include self, then take the minimum ID to act as the franchise identifier
            relatedIds.push(anilist_id);
            franchise_group_id = Math.min(...relatedIds);
        }
    }

    // Get Embeddings for Description
    let plot_embedding = null;
    if (description) {
        const embedArr = await getEmbedding(description);
        if (embedArr) {
            plot_embedding = JSON.stringify(embedArr);
        }
    }

    const stmt = db.prepare(`
        INSERT OR REPLACE INTO anime 
        (anilist_id, title_english, title_romaji, release_year, episodes, format, genres, tags, average_score, popularity, description, cover_image, director, studios, adult, plot_embedding, franchise_group_id, primary_genres)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(anilist_id, title_english, title_romaji, release_year, episodes, format, genres, tags, average_score, popularity, description, cover_image, director, studios_str, adult, plot_embedding, franchise_group_id, primary_genres);
    invalidateGenreIDF('anime');

    return { anilist_id, title_english, title_romaji, release_year, genres, average_score, description, cover_image, franchise_group_id, primary_genres };
}

module.exports = { fetchWithAniListRetry, fetchAndCacheAnime };
