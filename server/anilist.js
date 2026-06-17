const db = require('./db/anime_db');
const { getEmbedding } = require('./llm');

const ANILIST_API_URL = 'https://graphql.anilist.co';

async function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Global throttle to strictly enforce 1 req / 0.75s locally as well
let lastRequestTime = 0;

async function fetchWithAniListRetry(query, variables, retries = 3) {
    for (let i = 0; i < retries; i++) {
        const now = Date.now();
        const timeSinceLast = now - lastRequestTime;
        if (timeSinceLast < 750) {
            await delay(750 - timeSinceLast);
        }
        lastRequestTime = Date.now();

        try {
            const response = await fetch(ANILIST_API_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                },
                body: JSON.stringify({ query, variables })
            });

            // Check rate limits from headers
            const remaining = parseInt(response.headers.get('x-ratelimit-remaining') || '90');
            if (remaining < 5) {
                console.log(`[AniList] Approaching rate limit (${remaining} left). Pausing for 5 seconds...`);
                await delay(5000);
            }

            if (response.status === 429) {
                const retryAfter = parseInt(response.headers.get('retry-after') || '60');
                console.warn(`[AniList] 429 Rate Limited! Sleeping for ${retryAfter} seconds...`);
                await delay(retryAfter * 1000);
                continue; // retry
            }

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`AniList HTTP Error: ${response.status} - ${errText}`);
            }

            return await response.json();
        } catch (error) {
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
    const genres = JSON.stringify(media.genres || []);
    
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
        (anilist_id, title_english, title_romaji, release_year, episodes, format, genres, tags, average_score, popularity, description, cover_image, director, studios, adult, plot_embedding)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(anilist_id, title_english, title_romaji, release_year, episodes, format, genres, tags, average_score, popularity, description, cover_image, director, studios_str, adult, plot_embedding);

    return { anilist_id, title_english, title_romaji, release_year, genres, average_score, description, cover_image };
}

module.exports = { fetchWithAniListRetry, fetchAndCacheAnime };
