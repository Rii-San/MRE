const animeDb = require('./server/db/anime_db');
function cosineDist(v1, v2) {
    let dot = 0, norm1 = 0, norm2 = 0;
    for(let i=0; i<v1.length; i++) {
        dot += v1[i]*v2[i];
        norm1 += v1[i]*v1[i];
        norm2 += v2[i]*v2[i];
    }
    if (norm1 === 0 || norm2 === 0) return 1;
    return 1 - (dot / (Math.sqrt(norm1) * Math.sqrt(norm2)));
}

function dbscan(items, eps = 0.32, minPts = 3) {
    const C = [];
    const noise = [];
    const visited = new Set();
    const clusterAssigned = new Set();
    
    const getNeighbors = (idx) => {
        const neighbors = [];
        for(let i=0; i<items.length; i++) {
            if (cosineDist(items[idx].vec, items[i].vec) <= eps) {
                neighbors.push(i);
            }
        }
        return neighbors;
    };
    
    for(let i=0; i<items.length; i++) {
        if (visited.has(i)) continue;
        visited.add(i);
        const neighbors = getNeighbors(i);
        
        if (neighbors.length < minPts) {
            noise.push(i);
        } else {
            const cluster = [];
            C.push(cluster);
            const seedSet = [...neighbors];
            
            while(seedSet.length > 0) {
                const q = seedSet.pop();
                if (!visited.has(q)) {
                    visited.add(q);
                    const qNeighbors = getNeighbors(q);
                    if (qNeighbors.length >= minPts) {
                        for(let qn of qNeighbors) {
                            if (!seedSet.includes(qn) && !visited.has(qn)) {
                                seedSet.push(qn);
                            }
                        }
                    }
                }
                if (!clusterAssigned.has(q)) {
                    clusterAssigned.add(q);
                    cluster.push(q);
                }
            }
        }
    }
    const actualNoise = noise.filter(i => !clusterAssigned.has(i));
    
    return {
        clusters: C.map(indices => indices.map(i => items[i])),
        outliers: actualNoise.map(i => items[i])
    };
}

const items = animeDb.prepare('SELECT title_english, title_romaji, user_rating, plot_embedding FROM watched_anime w JOIN anime a ON w.anilist_id = a.anilist_id WHERE plot_embedding IS NOT NULL AND user_rating >= 8.0').all();

console.log("Total liked anime:", items.length);
if (items.length > 0) {
    const parsed = items.map(i => ({ 
        title: i.title_english || i.title_romaji, 
        user_rating: i.user_rating, 
        vec: JSON.parse(i.plot_embedding) 
    }));
    
    // Test the specific epsilons we care about
    for (const eps of [0.32, 0.3, 0.28, 0.25]) {
        const res = dbscan(parsed, eps, 3);
        console.log(`\n=== EPS: ${eps} -> Clusters: ${res.clusters.length}, Outliers: ${res.outliers.length} ===`);
        res.clusters.forEach((c, idx) => {
            console.log(`  Cluster ${idx} size: ${c.length} - e.g. ${c.slice(0,3).map(x=>x.title).join(', ')}`);
        });
    }
}
