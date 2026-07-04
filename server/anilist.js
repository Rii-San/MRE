const db = require('./db/anime_db');
const { getEmbedding } = require('./llm');
const logger = require('./utils/logger');
const { selectPrimaryGenres, computeGenreIDF } = require('./engine/genre_utils');
const { getCache, invalidateGenreIDF, invalidateCache } = require('./engine/cache');

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
                    'User-Agent': 'MRE-App/1.0'
                },
                body: JSON.stringify({ query, variables })
            });

            // Release the lock for the next request after 750ms (enforcing 90/min)
            setTimeout(releaseNext, 750);

            // Check rate limits from headers
            const remaining = parseInt(response.headers.get('x-ratelimit-remaining') || '90');
            if (remaining < 5) {
                logger.warn(`Approaching rate limit (${remaining} left). Pausing globally for 5 seconds...`, 'AniList');
                // Append a 5 second penalty to the global queue
                aniListQueuePromise = aniListQueuePromise.then(() => delay(5000));
            }

            if (response.status === 429) {
                const retryAfter = parseInt(response.headers.get('retry-after') || '60');
                logger.warn(`429 Rate Limited! Sleeping globally for ${retryAfter} seconds...`, 'AniList');
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
            
            logger.error(`Fetch error: ${error.message}`, 'AniList');
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

async function mutateWithAniListOAuth(query, variables, token, retries = 3) {
    for (let i = 0; i < retries; i++) {
        await aniListQueuePromise;
        let releaseNext;
        aniListQueuePromise = new Promise(resolve => { releaseNext = resolve; });

        try {
            const res = await fetch(ANILIST_API_URL, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'User-Agent': 'MRE-App/1.0'
                },
                body: JSON.stringify({ query, variables })
            });

            setTimeout(releaseNext, 750);
            
            const remaining = parseInt(res.headers.get('x-ratelimit-remaining') || '90');
            if (remaining < 5) aniListQueuePromise = aniListQueuePromise.then(() => delay(5000));
            
            if (res.status === 429) {
                const retryAfter = parseInt(res.headers.get('retry-after') || '60');
                aniListQueuePromise = aniListQueuePromise.then(() => delay(retryAfter * 1000));
                continue;
            }

            if (!res.ok) {
                const errText = await res.text();
                throw new Error(`AniList OAuth HTTP Error: ${res.status} - ${errText}`);
            }
            return await res.json();
        } catch (error) {
            if (typeof releaseNext === 'function') releaseNext();
            if (i === retries - 1) throw error;
            await delay(2000 * (i + 1));
        }
    }
}

async function syncRatingToAniList(anilist_id, user_rating, token) {
    if (!token) return;
    const SAVE_ENTRY_QUERY = `
    mutation ($mediaId: Int, $status: MediaListStatus, $scoreRaw: Int) {
      SaveMediaListEntry (mediaId: $mediaId, status: $status, scoreRaw: $scoreRaw) {
        id
        status
      }
    }
    `;
    const scoreRaw = Math.round(user_rating * 10);
    try {
        await mutateWithAniListOAuth(SAVE_ENTRY_QUERY, {
            mediaId: anilist_id,
            status: "COMPLETED",
            scoreRaw: scoreRaw
        }, token);
        logger.info(`Synced rating for anime ${anilist_id} to AniList account`, 'AniList');
    } catch(e) {
        logger.error(`Failed to sync rating to AniList: ${e.message}`, 'AniList');
    }
}

async function syncWatchHistoryFromAniList(token) {
    if (!token) return;
    logger.info('Starting manual AniList watch history master sync...', 'AniListSync');
    const GET_USER_LIST = `query { Viewer { id } }`;
    const GET_LIST_ENTRIES = `
    query ($userId: Int) { 
      MediaListCollection(userId: $userId, type: ANIME) { 
        lists { 
          status
          entries { 
            id
            mediaId 
            score 
          } 
        } 
      } 
    }`;
    const DELETE_ENTRY = `
    mutation ($id: Int) {
      DeleteMediaListEntry(id: $id) { deleted }
    }`;
    const SAVE_ENTRY_COMPLETED = `
    mutation ($mediaId: Int, $status: MediaListStatus, $scoreRaw: Int) {
      SaveMediaListEntry (mediaId: $mediaId, status: $status, scoreRaw: $scoreRaw) {
        id
        status
      }
    }`;
    const SAVE_ENTRY_PLANNING = `
    mutation ($mediaId: Int, $status: MediaListStatus) {
      SaveMediaListEntry (mediaId: $mediaId, status: $status) {
        id
        status
      }
    }`;
    
    try {
        logger.info('Fetching AniList Viewer ID...', 'AniListSync');
        const viewerData = await mutateWithAniListOAuth(GET_USER_LIST, {}, token);
        if (!viewerData?.data?.Viewer?.id) throw new Error("Could not fetch Viewer ID");
        const userId = viewerData.data.Viewer.id;
        
        logger.info(`Fetching remote lists for Viewer ID: ${userId}...`, 'AniListSync');
        const listData = await mutateWithAniListOAuth(GET_LIST_ENTRIES, { userId }, token);
        const lists = listData?.data?.MediaListCollection?.lists || [];
        
        logger.info('Loading local database state...', 'AniListSync');
        const animeWdb = require('./db/anime_watchlistDb');
        
        const localWatchedRows = db.prepare('SELECT anilist_id, user_rating FROM watched_anime').all();
        const localWatchedMap = new Map();
        localWatchedRows.forEach(r => localWatchedMap.set(r.anilist_id, r.user_rating));
        
        const localWatchlistRows = animeWdb.prepare('SELECT anilist_id FROM watchlist_anime').all();
        const localWatchlistSet = new Set(localWatchlistRows.map(r => r.anilist_id));

        let deletedCount = 0;
        let updatedCount = 0;
        const aniListEntries = new Map();

        // 1. Process AniList entries and delete extras not in local DB
        for (const list of lists) {
            for (const entry of list.entries) {
                let s = entry.score;
                if (s > 10) s = s / 10;
                
                aniListEntries.set(entry.mediaId, { id: entry.id, status: list.status, score: s });
                
                if (!localWatchedMap.has(entry.mediaId) && !localWatchlistSet.has(entry.mediaId)) {
                    await mutateWithAniListOAuth(DELETE_ENTRY, { id: entry.id }, token);
                    deletedCount++;
                }
            }
        }
        
        // 2. Push Local Watched (COMPLETED)
        for (const [mediaId, user_rating] of localWatchedMap.entries()) {
            const aniListEntry = aniListEntries.get(mediaId);
            const expectedScore = user_rating;
            if (!aniListEntry || aniListEntry.status !== 'COMPLETED' || aniListEntry.score !== expectedScore) {
                await mutateWithAniListOAuth(SAVE_ENTRY_COMPLETED, { mediaId: mediaId, status: "COMPLETED", scoreRaw: Math.round(user_rating * 10) }, token);
                updatedCount++;
            }
        }

        // 3. Push Local Watchlist (PLANNING)
        for (const mediaId of localWatchlistSet) {
            const aniListEntry = aniListEntries.get(mediaId);
            // Allow CURRENT if the user manually set it to watching on AniList, otherwise default to PLANNING
            if (!aniListEntry || (aniListEntry.status !== 'PLANNING' && aniListEntry.status !== 'CURRENT')) {
                await mutateWithAniListOAuth(SAVE_ENTRY_PLANNING, { mediaId: mediaId, status: "PLANNING" }, token);
                updatedCount++;
            }
        }

        logger.info(`AniList Master Sync: Pushed local DB to AniList. Updated/Inserted ${updatedCount}, Deleted ${deletedCount}`, 'AniListSync');
        
    } catch(e) {
        logger.error(`Failed to push sync to AniList: ${e.message}`, 'AniListSync');
    }
}

module.exports = { fetchWithAniListRetry, fetchAndCacheAnime, syncRatingToAniList, syncWatchHistoryFromAniList };
