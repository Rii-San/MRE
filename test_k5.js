const sqlite = require('better-sqlite3');
const { optimalKMeans } = require('./server/services/kmeans');

function getWatched(dbPath, isAnime) {
    const db = new sqlite(dbPath);
    const table = isAnime ? 'watched_anime w JOIN anime a ON w.anilist_id = a.anilist_id' : 'watched w JOIN movies a ON w.tmdb_id = a.tmdb_id';
    return db.prepare(`SELECT * FROM ${table}`).all();
}

function testDomain(domainName, dbPath, isAnime, k) {
    console.log(`\n=== Clustering ${domainName} (k=${k}) ===`);
    const allWatched = getWatched(dbPath, isAnime);
    
    const descCol = isAnime ? 'description' : 'overview';
    const items = [];
    allWatched.forEach(item => {
        if (item.user_rating >= 8.0 && item.plot_embedding && item[descCol]) {
            try {
                items.push({
                    ...item,
                    vec: JSON.parse(item.plot_embedding),
                    desc: item[descCol].replace(/\(Source:.*?\)/gi, '').replace(/\[Written by.*?\]/gi, '').trim()
                });
            } catch(e) {}
        }
    });

    const res = optimalKMeans(items, k);
    
    if (!res.clusters || res.clusters.length === 0) {
        console.log("No clusters found.");
        return;
    }

    res.clusters.forEach((c, idx) => {
        c.sort((a, b) => b.user_rating - a.user_rating);
        const topTitles = c.slice(0, 5).map(x => isAnime ? (x.title_english || x.title_romaji) : x.title).join(', ');
        console.log(`Cluster ${idx + 1} (${c.length} items): ${topTitles}`);
    });
    
    console.log(`Outliers: ${res.outliers.length} items`);
}

testDomain("ANIME", "./data/anime.db", true, 5);
testDomain("MOVIE", "./data/movie.db", false, 5);
