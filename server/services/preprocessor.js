const db = require('../db/db');
const animeDb = require('../db/anime_db');
const { buildVocab, getFeatureNames, buildAnimeVocab, getAnimeFeatureNames } = require('../engine/vectorize');
const { getTasteProfile, getAnimeTasteProfile } = require('../engine/score');
const natural = require('natural');
const { generateClusterLabel, generatePlotNarrative } = require('./gemini');

function analyzeSentiment(notes) {
    if (!notes || notes.length === 0) return "Neutral";
    const Analyzer = natural.SentimentAnalyzer;
    const stemmer = natural.PorterStemmer;
    const analyzer = new Analyzer("English", stemmer, "afinn");
    
    let totalScore = 0;
    notes.forEach(note => {
        const words = new natural.WordTokenizer().tokenize(note);
        totalScore += analyzer.getSentiment(words);
    });
    const avg = totalScore / notes.length;
    
    if (avg > 0.5) return "Writes about content with immense warmth and passion. Highly positive and enthusiastic.";
    if (avg > 0) return "Writes with a generally positive, reflective, and appreciative tone. More of an appreciator than a harsh critic.";
    if (avg < -0.5) return "Highly critical and negative in notes. Hard to please and looks for flaws.";
    if (avg < 0) return "Somewhat critical and analytical. Tends to note what went wrong in a story.";
    return "Neutral, analytical, and objective in writing notes.";
}

function getAllWatched(dbConnection, isAnime) {
    const table = isAnime ? 'watched_anime w JOIN anime a ON w.anilist_id = a.anilist_id' : 'watched w JOIN movies m ON w.tmdb_id = m.tmdb_id';
    return dbConnection.prepare(`SELECT * FROM ${table}`).all();
}

function extractMetadata(allWatched, isAnime) {
    const genres = new Set();
    const countries = new Set();
    const decades = new Set();
    
    allWatched.forEach(item => {
        try {
            if (item.genres) {
                JSON.parse(item.genres).forEach(g => genres.add(g));
            }
            if (!isAnime && item.country) countries.add(item.country);
            if (item.release_year) decades.add(Math.floor(item.release_year / 10) * 10);
        } catch(e) {}
    });

    return {
        uniqueGenres: genres.size,
        uniqueCountries: countries.size,
        uniqueDecades: decades.size
    };
}

function formatTasteProfile(profileVec, featureNames) {
    if (!profileVec || !featureNames || profileVec.length !== featureNames.length) return null;
    
    const features = [];
    for (let i = 0; i < profileVec.length; i++) {
        if (Math.abs(profileVec[i]) > 0.001) {
            features.push({ name: featureNames[i], score: profileVec[i] });
        }
    }
    
    features.sort((a, b) => b.score - a.score);
    
    const pos = features.filter(f => f.score > 0.05);
    const neg = features.filter(f => f.score < -0.01).reverse(); // Relaxed threshold for dislikes

    const extract = (list, prefix) => list.filter(f => f.name.startsWith(prefix)).map(f => f.name.replace(prefix, '').trim());
    
    return {
        lovedGenres: extract(pos, 'Genre: ').slice(0, 8),
        lovedTags: extract(pos, 'Tag: ').slice(0, 15),
        hatedGenres: extract(neg, 'Genre: ').slice(0, 5),
        hatedTags: extract(neg, 'Tag: ').slice(0, 10),
    };
}

function cosineDist(v1, v2) {
    let dot = 0;
    for(let i=0; i<v1.length; i++) dot += v1[i]*v2[i];
    return 1 - dot;
}

function dbscan(items, eps = 0.45, minPts = 3) {
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

function getMedoid(clusterItems) {
    if (clusterItems.length === 0) return null;
    if (clusterItems.length === 1) return clusterItems[0];
    
    const centroid = new Array(clusterItems[0].vec.length).fill(0);
    for(let item of clusterItems) {
        for(let i=0; i<item.vec.length; i++) centroid[i] += item.vec[i];
    }
    for(let i=0; i<centroid.length; i++) centroid[i] /= clusterItems.length;
    
    let best = null;
    let minDist = Infinity;
    for(let item of clusterItems) {
        const d = cosineDist(item.vec, centroid);
        if (d < minDist) {
            minDist = d;
            best = item;
        }
    }
    return best;
}

function extractCorePlots(allWatched, isAnime) {
    const descCol = isAnime ? 'description' : 'overview';
    
    const prepareItems = (thresholdFn) => {
        const items = [];
        allWatched.forEach(item => {
            if (thresholdFn(item.user_rating) && item.plot_embedding && item[descCol]) {
                try {
                    items.push({
                        ...item,
                        vec: JSON.parse(item.plot_embedding),
                        desc: item[descCol].replace(/\(Source:.*?\)/gi, '').replace(/\[Written by.*?\]/gi, '').trim()
                    });
                } catch(e) {}
            }
        });
        return items;
    };

    const likedItems = prepareItems(r => r >= 8.0);
    const dislikedItems = prepareItems(r => r <= 4.0);

    const processSet = (items) => {
        if (items.length === 0) return { medoids: [], outliers: [] };
        if (items.length < 5) return { medoids: items.map(i => i.desc), outliers: [] };
        
        const res = dbscan(items, 0.45, 3);
        const medoids = res.clusters.map(c => getMedoid(c)).filter(m => m).map(m => m.desc);
        
        // If DBSCAN found no clusters (too sparse), fallback to top 3 items
        if (medoids.length === 0) {
            items.sort((a, b) => isAnime ? (b.user_rating - a.user_rating) : (b.user_rating - a.user_rating)); // wait, already sorted if we do b-a
            return { medoids: items.slice(0, 3).map(i => i.desc), outliers: [] };
        }
        
        const outliers = res.outliers.map(o => o.desc).slice(0, 2); // limit to 2 outliers
        return { medoids, outliers, rawClusters: res.clusters };
    };

    const liked = processSet(likedItems);
    const disliked = processSet(dislikedItems);
    
    // Also prepare outliers text for the summary output
    const outlierTitleKey = isAnime ? 'title_english' : 'title';
    const fallbackTitleKey = isAnime ? 'title_romaji' : 'title';
    let outlierText = null;
    
    if (likedItems.length >= 5) {
        const res = dbscan(likedItems, 0.45, 3);
        if (res.outliers.length > 0) {
            const out = res.outliers[0];
            const title = out[outlierTitleKey] || out[fallbackTitleKey];
            outlierText = `OUTLIER FAVORITE: Loved "${title}" (Rated ${out.user_rating}) despite it being semantically distant from their core taste.`;
        }
    }

    return { likedPlots: [...liked.medoids, ...liked.outliers], dislikedPlots: disliked.medoids, outlierText, likedClusters: liked.rawClusters };
}

function calculateTasteDrift(allWatched) {
    const rated = allWatched.filter(item => item.watch_date && item.user_rating >= 7.0)
        .sort((a, b) => new Date(a.watch_date) - new Date(b.watch_date));
    
    if (rated.length < 20) return null;
    
    const mid = Math.floor(rated.length / 2);
    const past = rated.slice(0, mid);
    const recent = rated.slice(mid);
    
    const getTopGenres = (items) => {
        const counts = {};
        items.forEach(item => {
            try {
                if (item.genres) {
                    JSON.parse(item.genres).forEach(g => { counts[g] = (counts[g] || 0) + 1; });
                }
            } catch(e) {}
        });
        const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
        return sorted.slice(0, 3).map(x => x[0]);
    };
    
    const pastGenres = getTopGenres(past);
    const recentGenres = getTopGenres(recent);
    
    if (pastGenres.join(',') !== recentGenres.join(',')) {
        return `TASTE EVOLUTION: Their taste has shifted over time. Historically favored ${pastGenres.join(', ')}, but recently gravitating toward ${recentGenres.join(', ')}.`;
    } else {
        return `TASTE EVOLUTION: Their taste is highly stable over time, consistently favoring ${recentGenres.join(', ')}.`;
    }
}

async function formatClusters(clusters, isAnime, totalVectors) {
    if (!clusters || clusters.length === 0) return null;
    
    const formattedClusters = await Promise.all(clusters.map(async (c) => {
        c.sort((a, b) => b.user_rating - a.user_rating);
        const top5Titles = c.slice(0, 5).map(x => isAnime ? (x.title_english || x.title_romaji) : x.title).join(', ');
        
        let label = "Distinctive Taste";
        try {
            label = await generateClusterLabel(top5Titles);
        } catch(e) {
            const genreCounts = {};
            c.forEach(item => {
                try {
                    if (item.genres) {
                        JSON.parse(item.genres).forEach(g => { genreCounts[g] = (genreCounts[g] || 0) + 1; });
                    }
                } catch(e) {}
            });
            const topGenre = Object.entries(genreCounts).sort((a, b) => b[1] - a[1])[0];
            if (topGenre) label = topGenre[0] + " Archetype";
        }
        
        const percentage = Math.round((c.length / totalVectors) * 100);
        const top3Titles = c.slice(0, 3).map(x => isAnime ? (x.title_english || x.title_romaji) : x.title).join(', ');
        return ` - ${label} (${percentage}%): e.g., ${top3Titles}`;
    }));

    return formattedClusters;
}

async function generateTasteSummary() {
    let summary = "";
    
    const processDomain = async (dbConn, isAnime, title) => {
        let domainSummary = `=== THEIR ${title} TASTE ===\n\n`;
        try {
            const allWatched = getAllWatched(dbConn, isAnime);
            if (allWatched.length === 0) {
                return domainSummary + `Not enough data to form a vision.\n\n`;
            }

            const vocab = isAnime ? buildAnimeVocab(dbConn) : buildVocab(dbConn);
            const profile = isAnime ? getAnimeTasteProfile(vocab) : getTasteProfile(dbConn, vocab);
            const names = isAnime ? getAnimeFeatureNames(vocab) : getFeatureNames(vocab);
            
            const tasteFormat = formatTasteProfile(profile, names);
            const meta = extractMetadata(allWatched, isAnime);
            const drift = calculateTasteDrift(allWatched);
            const notes = allWatched.map(m => m.notes).filter(n => n);
            
            // Extract medoids via DBSCAN
            const { likedPlots, dislikedPlots, outlierText, likedClusters } = extractCorePlots(allWatched, isAnime);
            
            // Generate Narrative via Gemini
            let narrative = { likedSentence: "Stories that align with their aesthetic.", dislikedSentence: "Stories that clash with their preferences." };
            if (likedPlots.length > 0 || dislikedPlots.length > 0) {
                try {
                    narrative = await generatePlotNarrative(likedPlots, dislikedPlots);
                } catch (e) {
                    console.warn(`[Preprocessor] Gemini plot synthesis failed: ${e.message}`);
                }
            }

            // Format Clusters
            let totalLiked = allWatched.filter(r => r.user_rating >= 8.0).length;
            const formattedArchetypes = await formatClusters(likedClusters, isAnime, totalLiked || 1);
            
            domainSummary += `TASTE BREADTH:\nExplores a palette spanning ${meta.uniqueGenres} genres across ${isAnime ? '' : meta.uniqueCountries + ' countries and '}${meta.uniqueDecades} decades.\n\n`;
            
            if (tasteFormat) {
                domainSummary += `GENRES THEY LOVE: ${tasteFormat.lovedGenres.join(', ') || 'None strongly'}\n`;
                domainSummary += `THEMES & ELEMENTS THEY SEEK: ${tasteFormat.lovedTags.join(', ') || 'None strongly'}\n\n`;
                domainSummary += `GENRES THEY DISLIKE: ${tasteFormat.hatedGenres.join(', ') || 'None strongly'}\n`;
                domainSummary += `THEMES & ELEMENTS THEY REJECT: ${tasteFormat.hatedTags.join(', ') || 'None strongly'}\n\n`;
            }
            
            domainSummary += `WHAT THEIR BELOVED STORIES ARE ABOUT:\n${narrative.likedSentence}\n\n`;
            domainSummary += `WHAT THEIR DISLIKED STORIES ARE ABOUT:\n${narrative.dislikedSentence}\n\n`;
            
            if (outlierText) domainSummary += `${outlierText}\n\n`;
            if (drift) domainSummary += `${drift}\n\n`;
            
            if (formattedArchetypes && formattedArchetypes.length > 0) {
                domainSummary += `TASTE ARCHETYPES (distinct flavors in their library):\n${formattedArchetypes.join('\n')}\n\n`;
            }
            
            domainSummary += `VIEWER PERSONALITY:\n${analyzeSentiment(notes)}\n\n`;
        } catch(e) {
            console.error(`${title} taste summary error:`, e);
            domainSummary += `The vision is clouded.\n\n`;
        }
        return domainSummary;
    };

    summary += await processDomain(db, false, "MOVIE");
    summary += await processDomain(animeDb, true, "ANIME");

    return summary;
}

function getMedoidSeedIds(dbConnection, isAnime) {
    const allWatched = getAllWatched(dbConnection, isAnime);
    const idCol = isAnime ? 'anilist_id' : 'tmdb_id';
    
    const items = [];
    allWatched.forEach(item => {
        if (item.user_rating >= 7.0 && item.plot_embedding) {
            try {
                items.push({
                    id: item[idCol],
                    user_rating: item.user_rating,
                    vec: JSON.parse(item.plot_embedding)
                });
            } catch(e) {}
        }
    });
    
    if (items.length < 5) return items.sort((a,b) => b.user_rating - a.user_rating).slice(0, 10).map(i => i.id);
    
    const res = dbscan(items, 0.45, 3);
    const medoids = res.clusters.map(c => getMedoid(c)).filter(m => m).map(m => m.id);
    
    if (medoids.length === 0) return items.sort((a,b) => b.user_rating - a.user_rating).slice(0, 10).map(i => i.id);
    
    const outliers = res.outliers.slice(0, 2).map(m => m.id);
    return [...medoids, ...outliers];
}

module.exports = { generateTasteSummary, getMedoidSeedIds };
