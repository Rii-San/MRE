const db = require('../db/db');
const animeDb = require('../db/anime_db');
const { buildVocab, getFeatureNames, buildAnimeVocab, getAnimeFeatureNames } = require('../engine/vectorize');
const { getTasteProfile, getAnimeTasteProfile } = require('../engine/score');
const natural = require('natural');
const { generateClusterLabel, generatePlotNarrative } = require('./gemini');
const { optimalKMeans, cosineDist } = require('./kmeans');

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

// cosineDist and clustering are now imported from hdbscan.js

function getClusterRepresentatives(clusterItems, count = 3) {
    if (clusterItems.length === 0) return [];
    if (clusterItems.length <= count) return [...clusterItems];
    
    const centroid = new Array(clusterItems[0].vec.length).fill(0);
    for(let item of clusterItems) {
        for(let i=0; i<item.vec.length; i++) centroid[i] += item.vec[i];
    }
    for(let i=0; i<centroid.length; i++) centroid[i] /= clusterItems.length;
    
    let best = null;
    let minDist = Infinity;
    let medoidIdx = -1;
    for(let i=0; i<clusterItems.length; i++) {
        const d = cosineDist(clusterItems[i].vec, centroid);
        if (d < minDist) {
            minDist = d;
            best = clusterItems[i];
            medoidIdx = i;
        }
    }
    
    const reps = [best];
    const available = [];
    for(let i=0; i<clusterItems.length; i++) {
        if (i !== medoidIdx) available.push(clusterItems[i]);
    }
    
    // Fisher-Yates shuffle
    for(let i = available.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [available[i], available[j]] = [available[j], available[i]];
    }
    
    for(let i=0; i < Math.min(count - 1, available.length); i++) {
        reps.push(available[i]);
    }
    
    return reps;
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
        if (items.length === 0) return { medoids: [], outliers: [], rawClusters: [], rawOutliers: [] };
        if (items.length < 3) return { medoids: items.map(i => i.desc), outliers: [], rawClusters: [], rawOutliers: [] };
        
        // Single K-Means call — dynamically selects best k to balance clusters and detect outliers
        const res = optimalKMeans(items);

        const medoids = res.clusters.flatMap(c => getClusterRepresentatives(c)).map(m => m.desc);
        
        // If K-Means found no clusters, fallback to top 3 items
        if (medoids.length === 0) {
            items.sort((a, b) => b.user_rating - a.user_rating);
            return { medoids: items.slice(0, 3).map(i => i.desc), outliers: [], rawClusters: [], rawOutliers: [] };
        }
        
        const outliers = res.outliers.map(o => o.desc).slice(0, 3); // limit to 3 outliers
        return { medoids, outliers, rawClusters: res.clusters, rawOutliers: res.outliers };
    };

    const liked = processSet(likedItems);
    const disliked = processSet(dislikedItems);
    
    // Prepare outliers text for the summary output
    const outlierTitleKey = isAnime ? 'title_english' : 'title';
    const fallbackTitleKey = isAnime ? 'title_romaji' : 'title';
    let outlierText = null;
    
    if (liked.rawOutliers && liked.rawOutliers.length > 0) {
        const numOutliers = Math.min(3, liked.rawOutliers.length);
        const outlierStrings = [];
        for (let i = 0; i < numOutliers; i++) {
            const out = liked.rawOutliers[i];
            const title = out[outlierTitleKey] || out[fallbackTitleKey];
            outlierStrings.push(`Loved "${title}" (Rated ${out.user_rating})`);
        }
        outlierText = `OUTLIER FAVORITES: ${outlierStrings.join(', ')} despite them being semantically distant from their core taste.`;
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
    
    // Sort clusters and prepare titles for batch generation
    const preparedClusters = clusters.map(c => {
        c.sort((a, b) => b.user_rating - a.user_rating);
        const top5Titles = c.slice(0, 5).map(x => isAnime ? (x.title_english || x.title_romaji) : x.title).join(', ');
        const top3Titles = c.slice(0, 3).map(x => isAnime ? (x.title_english || x.title_romaji) : x.title).join(', ');
        const percentage = Math.round((c.length / totalVectors) * 100);
        return { c, top5Titles, top3Titles, percentage };
    });

    let labels = [];
    try {
        const { generateClusterLabelsBatch } = require('./gemini');
        labels = await generateClusterLabelsBatch(preparedClusters.map(pc => pc.top5Titles));
    } catch(e) {
        console.warn(`[Preprocessor] Batch label generation failed: ${e.message}`);
    }

    const formattedClusters = preparedClusters.map((pc, idx) => {
        let label = labels[idx];
        if (!label) {
            const genreCounts = {};
            pc.c.forEach(item => {
                try {
                    if (item.genres) {
                        JSON.parse(item.genres).forEach(g => { genreCounts[g] = (genreCounts[g] || 0) + 1; });
                    }
                } catch(e) {}
            });
            const topGenre = Object.entries(genreCounts).sort((a, b) => b[1] - a[1])[0];
            label = topGenre ? topGenre[0] + " Archetype" : "Distinctive Taste";
        }
        
        return ` - ${label} (${pc.percentage}%): e.g., ${pc.top3Titles}`;
    });

    return formattedClusters;
}

async function generateTasteSummary() {
    let summary = "";
    let combinedTasteData = {
        lovedGenres: [],
        hatedGenres: [],
        lovedTags: [],
        hatedTags: []
    };
    
    const processDomain = async (dbConn, isAnime, title) => {
        let domainSummary = `=== THEIR ${title} TASTE ===\n\n`;
        let tasteFormat = null;
        try {
            const allWatched = getAllWatched(dbConn, isAnime);
            if (allWatched.length === 0) {
                return { domainSummary: domainSummary + `Not enough data to form a vision.\n\n`, tasteFormat: null };
            }

            const vocab = isAnime ? buildAnimeVocab(dbConn) : buildVocab(dbConn);
            const profile = isAnime ? getAnimeTasteProfile(vocab) : getTasteProfile(dbConn, vocab);
            const names = isAnime ? getAnimeFeatureNames(vocab) : getFeatureNames(vocab);
            
            tasteFormat = formatTasteProfile(profile, names);
            const meta = extractMetadata(allWatched, isAnime);
            const drift = calculateTasteDrift(allWatched);
            const notes = allWatched.map(m => m.notes).filter(n => n);
            
            // Extract medoids via K-Means
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
        return { domainSummary, tasteFormat };
    };

    const movieResult = await processDomain(db, false, "MOVIE");
    summary += movieResult.domainSummary;
    if (movieResult.tasteFormat) {
        combinedTasteData.lovedGenres.push(...movieResult.tasteFormat.lovedGenres);
        combinedTasteData.hatedGenres.push(...movieResult.tasteFormat.hatedGenres);
        combinedTasteData.lovedTags.push(...movieResult.tasteFormat.lovedTags);
        combinedTasteData.hatedTags.push(...movieResult.tasteFormat.hatedTags);
    }

    const animeResult = await processDomain(animeDb, true, "ANIME");
    summary += animeResult.domainSummary;
    if (animeResult.tasteFormat) {
        combinedTasteData.lovedGenres.push(...animeResult.tasteFormat.lovedGenres);
        combinedTasteData.hatedGenres.push(...animeResult.tasteFormat.hatedGenres);
        combinedTasteData.lovedTags.push(...animeResult.tasteFormat.lovedTags);
        combinedTasteData.hatedTags.push(...animeResult.tasteFormat.hatedTags);
    }

    // Deduplicate lists
    combinedTasteData.lovedGenres = [...new Set(combinedTasteData.lovedGenres)];
    combinedTasteData.hatedGenres = [...new Set(combinedTasteData.hatedGenres)];
    combinedTasteData.lovedTags = [...new Set(combinedTasteData.lovedTags)];
    combinedTasteData.hatedTags = [...new Set(combinedTasteData.hatedTags)];

    return { summary, tasteData: combinedTasteData };
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
    
    if (items.length < 3) return items.sort((a,b) => b.user_rating - a.user_rating).slice(0, 10).map(i => i.id);
    
    const res = optimalKMeans(items);
    const medoids = res.clusters.flatMap(c => getClusterRepresentatives(c)).map(m => m.id);
    
    if (medoids.length === 0) return items.sort((a,b) => b.user_rating - a.user_rating).slice(0, 10).map(i => i.id);
    
    const outliers = res.outliers.slice(0, 2).map(m => m.id);
    return [...medoids, ...outliers];
}

module.exports = { generateTasteSummary, getMedoidSeedIds };
