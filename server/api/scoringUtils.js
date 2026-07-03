const { cosineSimilarity, calculateMatchPercentage } = require('../engine/score');

function applyBiases(finalSimilarity, domain, item, profile) {
    // Oracle Bias
    let oracleBiasScore = 0;
    try {
        if (profile && profile.bias) {
            const genresStr = (item.genres || []).toString().toLowerCase();
            const plotStr = (item.overview || '').toLowerCase();
            
            if (profile.bias.boost_genres) profile.bias.boost_genres.forEach(g => { if (genresStr.includes(g.toLowerCase())) oracleBiasScore += 0.05; });
            if (profile.bias.suppress_genres) profile.bias.suppress_genres.forEach(g => { if (genresStr.includes(g.toLowerCase())) oracleBiasScore -= 0.05; });
            if (profile.bias.mood_keywords) profile.bias.mood_keywords.forEach(k => { if (plotStr.includes(k.toLowerCase())) oracleBiasScore += 0.03; });
        }
    } catch(e) {}

    // Spiritual Bias
    let spiritualBiasScore = 0;
    try {
        const { getDailyReading } = require('../services/horoscopeService');
        const daily = getDailyReading();
        if (daily && daily.bias) {
            const genresStr = (item.genres || []).toString().toLowerCase();
            const plotStr = (item.overview || '').toLowerCase();
            
            if (daily.bias.boost_genres) daily.bias.boost_genres.forEach(g => { if (genresStr.includes(g.toLowerCase())) spiritualBiasScore += 0.05; });
            if (daily.bias.suppress_genres) daily.bias.suppress_genres.forEach(g => { if (genresStr.includes(g.toLowerCase())) spiritualBiasScore -= 0.05; });
            if (daily.bias.mood_keywords) daily.bias.mood_keywords.forEach(k => { if (plotStr.includes(k.toLowerCase())) spiritualBiasScore += 0.03; });
            
            spiritualBiasScore = Math.max(-0.15, Math.min(0.15, spiritualBiasScore));
        }
    } catch(e) {}

    return {
        oracleBiasScore,
        spiritualBiasScore,
        finalSimilarity: finalSimilarity + oracleBiasScore + spiritualBiasScore
    };
}

function runMMR(candidates, targetCount = 30, lambda = 0.7) {
    const selected = [];
    const remaining = [...candidates];

    while (selected.length < targetCount && remaining.length > 0) {
        if (selected.length === 0) {
            remaining.sort((a, b) => b.weight_used - a.weight_used);
            selected.push(remaining.shift());
        } else {
            let bestIdx = -1;
            let bestMMR = -Infinity;
            
            for (let i = 0; i < remaining.length; i++) {
                const cand = remaining[i];
                let maxRedundancy = 0;
                for (const sel of selected) {
                    let simSparse = cosineSimilarity(cand.movieVec, sel.movieVec);
                    let simDense = 0;
                    if (cand.movieDenseVec && sel.movieDenseVec) {
                        simDense = cosineSimilarity(cand.movieDenseVec, sel.movieDenseVec);
                    }
                    const simFinal = (simSparse * 0.5) + (simDense * 0.5);
                    if (simFinal > maxRedundancy) maxRedundancy = simFinal;
                }
                
                const mmrScore = (lambda * cand.weight_used) - ((1.0 - lambda) * maxRedundancy);
                if (mmrScore > bestMMR) {
                    bestMMR = mmrScore;
                    bestIdx = i;
                }
            }
            
            selected.push(remaining[bestIdx]);
            remaining.splice(bestIdx, 1);
        }
    }
    
    selected.sort((a, b) => b.match_score - a.match_score);
    return selected;
}

function computeAdaptiveSimilarity(tag_bias, story_bias, narrative_bias, richness) {
    let sparseWeight = 0.20 + (0.45 * richness);
    let denseWeight = 1.0 - sparseWeight;
    
    if (narrative_bias !== 0) {
        sparseWeight *= 0.8;
        denseWeight *= 0.8;
        return (tag_bias * sparseWeight) + (story_bias * denseWeight) + (narrative_bias * 0.2);
    } else {
        return (tag_bias * sparseWeight) + (story_bias * denseWeight);
    }
}

module.exports = {
    applyBiases,
    runMMR,
    computeAdaptiveSimilarity
};
