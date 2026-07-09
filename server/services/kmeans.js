'use strict';

/**
 * Cosine distance between two vectors: 1 - cosine_similarity.
 * Returns 0 for identical directions, 1 for orthogonal, 2 for opposite.
 * @param {number[]} a 
 * @param {number[]} b 
 * @returns {number}
 */
function cosineDist(a, b) {
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    if (denom === 0) return 1;
    return 1 - (dot / denom);
}

/**
 * Spherical K-Means implementation with outlier detection based on distance thresholds.
 * @param {Array<{vec: Array<number>}>} items - items to cluster
 * @param {number} k - number of clusters
 * @param {number} maxIter - maximum iterations for k-means
 * @returns { clusters, outliers }
 */
function kMeansWithOutliers(items, k, maxIter = 100) {
    if (items.length === 0) return { clusters: [], outliers: [] };
    if (items.length <= k) return { clusters: items.map(i => [i]), outliers: [] };

    // Initialize centroids randomly
    let centroids = [];
    const used = new Set();
    while (centroids.length < k) {
        const idx = Math.floor(Math.random() * items.length);
        if (!used.has(idx)) {
            used.add(idx);
            centroids.push([...items[idx].vec]);
        }
    }

    let assignments = new Array(items.length).fill(-1);
    let changed = true;
    let iter = 0;

    // K-Means loop
    while (changed && iter < maxIter) {
        changed = false;
        iter++;
        
        for (let i = 0; i < items.length; i++) {
            let minDist = Infinity;
            let bestK = -1;
            for (let j = 0; j < k; j++) {
                const d = cosineDist(items[i].vec, centroids[j]);
                if (d < minDist) {
                    minDist = d;
                    bestK = j;
                }
            }
            if (assignments[i] !== bestK) {
                assignments[i] = bestK;
                changed = true;
            }
        }
        
        const newCentroids = Array(k).fill(0).map(() => Array(items[0].vec.length).fill(0));
        const counts = Array(k).fill(0);
        
        for (let i = 0; i < items.length; i++) {
            const clusterIdx = assignments[i];
            counts[clusterIdx]++;
            for (let d = 0; d < items[i].vec.length; d++) {
                newCentroids[clusterIdx][d] += items[i].vec[d];
            }
        }
        
        for (let j = 0; j < k; j++) {
            if (counts[j] > 0) {
                for (let d = 0; d < centroids[j].length; d++) {
                    centroids[j][d] = newCentroids[j][d] / counts[j];
                }
            }
        }
    }

    // Outlier detection step
    const clusters = Array(k).fill(0).map(() => []);
    const outliers = [];
    
    // For each cluster, find the mean distance and std dev
    for (let j = 0; j < k; j++) {
        const clusterItems = [];
        const distances = [];
        for (let i = 0; i < items.length; i++) {
            if (assignments[i] === j) {
                const d = cosineDist(items[i].vec, centroids[j]);
                clusterItems.push({ item: items[i], dist: d });
                distances.push(d);
            }
        }
        
        if (distances.length === 0) continue;
        
        const meanDist = distances.reduce((a, b) => a + b, 0) / distances.length;
        const variance = distances.reduce((a, b) => a + Math.pow(b - meanDist, 2), 0) / distances.length;
        const stdDev = Math.sqrt(variance);
        
        // Items beyond 1.2 standard deviations from the cluster mean are outliers
        const threshold = meanDist + (1.2 * stdDev); 
        
        clusterItems.forEach(ci => {
            if (ci.dist > threshold) {
                outliers.push(ci.item);
            } else {
                clusters[j].push(ci.item);
            }
        });
    }

    return {
        clusters: clusters.filter(c => c.length > 2), // Drop tiny clusters (size <= 2)
        outliers
    };
}

/**
 * Evaluates K = 3, 4, 5 and selects the most balanced clustering, 
 * OR uses targetK if provided.
 * @param {Array} items 
 * @param {number} targetK 
 * @returns { clusters, outliers }
 */
function optimalKMeans(items, targetK = null) {
    if (items.length < 3) return { clusters: [], outliers: items };
    
    // If user specified a target cluster size, use it directly (compute once)
    if (targetK && targetK >= 2) {
        // Run a few initializations and pick the best to avoid bad random seeds
        let bestClusters = [];
        let bestOutliers = items;
        let minDiff = Infinity;
        for (let tries = 0; tries < 5; tries++) {
            const { clusters, outliers } = kMeansWithOutliers(items, targetK);
            if (clusters.length < 2) continue;
            
            const sizes = clusters.map(c => c.length);
            const diff = (Math.max(...sizes) - Math.min(...sizes)) + (outliers.length * 1.5);
            if (diff < minDiff) {
                minDiff = diff;
                bestClusters = clusters;
                bestOutliers = outliers;
            }
        }
        return { clusters: bestClusters.length > 0 ? bestClusters : [items], outliers: bestOutliers };
    }

    if (items.length <= 15) return kMeansWithOutliers(items, 2); // For very small datasets, just do K=2

    let bestClusters = [];
    let bestOutliers = items;
    let minDiff = Infinity;
    
    // Try K from 3 to 5, running multiple initializations
    for (let k = 3; k <= 5; k++) {
        for (let tries = 0; tries < 5; tries++) {
            const { clusters, outliers } = kMeansWithOutliers(items, k);
            if (clusters.length < 2) continue;
            
            const sizes = clusters.map(c => c.length);
            const max = Math.max(...sizes);
            const min = Math.min(...sizes);
            
            // Heuristic metric: penalize large variance in cluster size AND penalize excessive outliers
            const diff = (max - min) + (outliers.length * 1.5);
            
            if (diff < minDiff) {
                minDiff = diff;
                bestClusters = clusters;
                bestOutliers = outliers;
            }
        }
    }

    return { clusters: bestClusters, outliers: bestOutliers };
}

module.exports = { kMeansWithOutliers, optimalKMeans, cosineDist };
