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
    const GET_USER_LIST = `query { Viewer { id } }`;
    const GET_LIST_ENTRIES = `
    query ($userId: Int) { 
      MediaListCollection(userId: $userId, type: ANIME) { 
        lists { 
          status
          entries { 
            mediaId 
            score 
            media {
              title { english romaji }
              startDate { year }
              coverImage { extraLarge }
            }
          } 
        } 
      } 
    }`;
    
    try {
        const viewerData = await mutateWithAniListOAuth(GET_USER_LIST, {}, token);
        if (!viewerData?.data?.Viewer?.id) throw new Error("Could not fetch Viewer ID");
        const userId = viewerData.data.Viewer.id;
        
        const listData = await mutateWithAniListOAuth(GET_LIST_ENTRIES, { userId }, token);
        const lists = listData?.data?.MediaListCollection?.lists || [];
        
        const today = new Date().toISOString().split('T')[0];
        let importedWatched = 0;
        let importedWatchlist = 0;
        
        const animeWdb = require('./db/anime_watchlistDb');
        
        db.transaction(() => {
            animeWdb.transaction(() => {
                for (const list of lists) {
                    const status = list.status;
                    for (const entry of list.entries) {
                        const anilist_id = entry.mediaId;
                        const media = entry.media;
                        
                        if (status === 'COMPLETED' || status === 'DROPPED' || status === 'PAUSED') {
                            let user_rating = entry.score;
                            // Convert 100-point scale to 10-point scale if necessary
                            if (user_rating > 10) user_rating = user_rating / 10;
                            // If AniList has no rating, default to 5 for new entries
                            if (user_rating === 0) user_rating = 5;
                            
                            const existing = db.prepare('SELECT id, user_rating FROM watched_anime WHERE anilist_id = ?').get(anilist_id);
                            if (existing) {
                                // CRITICAL: NEVER overwrite a local MRE rating with an AniList unrated (0 -> 5)
                                // Only update if AniList specifically has a >0 rating and we somehow want to sync it,
                                // but to be safest to protect the user's MRE data, we just skip overwriting completely.
                                // MRE local ratings are the source of truth.
                                if (entry.score === 0 && existing.user_rating > 0) {
                                    // Two-way sync: If AniList is missing the score but we have it locally, upload it safely!
                                    syncRatingToAniList(anilist_id, existing.user_rating, token).catch(() => {});
                                }
                            } else {
                                db.prepare('INSERT INTO watched_anime (anilist_id, user_rating, watch_date, notes) VALUES (?, ?, ?, ?)').run(anilist_id, user_rating, today, 'Synced from AniList');
                                importedWatched++;
                            }
                        } else if (status === 'CURRENT' || status === 'PLANNING') {
                            const existing = animeWdb.prepare('SELECT anilist_id FROM watchlist_anime WHERE anilist_id = ?').get(anilist_id);
                            if (!existing && media) {
                                animeWdb.prepare(`INSERT INTO watchlist_anime (anilist_id, title_english, title_romaji, release_year, cover_image, added_date) VALUES (?, ?, ?, ?, ?, ?)`).run(
                                    anilist_id, 
                                    media.title?.english || media.title?.romaji, 
                                    media.title?.romaji || media.title?.english,
                                    media.startDate?.year || null,
                                    media.coverImage?.extraLarge || null,
                                    today
                                );
                                importedWatchlist++;
                            }
                        }
                    }
                }
            })();
        })();
        logger.info(`Successfully synced ${importedWatched} watched and ${importedWatchlist} watchlist anime from AniList profile`, 'AniListSync');
        const { invalidateCache, invalidateWatchlist } = require('./engine/cache');
        invalidateCache('anime');
        invalidateWatchlist('anime');
    } catch(e) {
        logger.error(`Failed to pull watch history from AniList: ${e.message}`, 'AniListSync');
    }
}

module.exports = { fetchWithAniListRetry, fetchAndCacheAnime, syncRatingToAniList, syncWatchHistoryFromAniList };
