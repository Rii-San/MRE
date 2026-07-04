const db = require('./server/db/db');
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

const items = db.prepare('SELECT title, plot_embedding FROM watched w JOIN movies m ON w.tmdb_id = m.tmdb_id WHERE plot_embedding IS NOT NULL').all();

console.log("Total items:", items.length);
if (items.length > 0) {
    const parsed = items.map(i => ({ title: i.title, vec: JSON.parse(i.plot_embedding) }));
    
    // Find Shutter Island
    const shutter = parsed.find(i => i.title === 'Shutter Island');
    const dragon = parsed.find(i => i.title.includes('Dragon'));
    
    if (shutter && dragon) {
        console.log(`Dist between ${shutter.title} and ${dragon.title}:`, cosineDist(shutter.vec, dragon.vec));
    }
    
    // Calculate average pairwise distance
    let totalDist = 0;
    let count = 0;
    let maxDist = 0;
    let minDist = 2;
    for(let i=0; i<parsed.length; i++) {
        for(let j=i+1; j<parsed.length; j++) {
            const d = cosineDist(parsed[i].vec, parsed[j].vec);
            totalDist += d;
            count++;
            if (d > maxDist) maxDist = d;
            if (d < minDist) minDist = d;
        }
    }
    console.log(`Avg distance: ${totalDist/count}`);
    console.log(`Min distance: ${minDist}`);
    console.log(`Max distance: ${maxDist}`);
}
