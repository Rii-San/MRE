const { getCache } = require('./cache');
const { calcBM25IDF } = require('./genre_utils');

function createVectorizer({ domain, getRowsQuery, features, continuousFeatures }) {
    function buildVocab(db) {
        const cache = getCache(domain);
        if (cache.vocab) return cache.vocab;
        
        const rows = db.prepare(getRowsQuery).all();
        const N = rows.length || 1;
        
        const counts = {};
        features.forEach(f => { counts[f.name] = {}; });
        
        rows.forEach(row => {
            features.forEach(f => {
                const val = row[f.column];
                if (val) {
                    if (f.type === 'json_array') {
                        try {
                            JSON.parse(val).forEach(item => {
                                counts[f.name][item] = (counts[f.name][item] || 0) + 1;
                            });
                        } catch (e) { /* ignore parse errors */ }
                    } else if (f.type === 'scalar') {
                        counts[f.name][val] = (counts[f.name][val] || 0) + 1;
                    }
                }
            });
        });
        
        const vocab = {};
        const idf = {};
        
        features.forEach(f => {
            let items = Object.keys(counts[f.name]);
            if (f.topN) {
                items = Object.entries(counts[f.name])
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, f.topN)
                    .map(e => e[0]);
            }
            vocab[f.name] = items.sort();
            
            idf[f.name] = {};
            items.forEach(item => {
                idf[f.name][item] = calcBM25IDF(N, counts[f.name][item]);
            });
        });
        
        cache.vocab = { ...vocab, idf };
        return cache.vocab;
    }
    
    function getFeatureNames(vocab) {
        const names = [];
        features.forEach(f => {
            vocab[f.name].forEach(item => names.push(`${f.label}: ${item}`));
        });
        continuousFeatures.forEach(f => names.push(f.label));
        return names;
    }
    
    function normalizeL2(vec) {
        const mag = Math.sqrt(vec.reduce((sum, val) => sum + val * val, 0));
        if (mag === 0) return vec;
        return vec.map(v => v / mag);
    }
    
    function vectorizeItem(item, vocab) {
        const vec = [];
        
        features.forEach(f => {
            let itemVals = [];
            const rawVal = f.valueAccessor ? f.valueAccessor(item) : item[f.column];
            
            if (rawVal) {
                if (f.type === 'json_array') {
                    try { itemVals = typeof rawVal === 'string' ? JSON.parse(rawVal) : rawVal; } catch(e) {}
                } else if (f.type === 'scalar') {
                    itemVals = [rawVal];
                }
            }
            
            vocab[f.name].forEach(v => {
                vec.push(itemVals.includes(v) ? (vocab.idf[f.name][v] * f.weight) : 0);
            });
        });
        
        continuousFeatures.forEach(f => {
            vec.push(f.accessor(item));
        });
        
        return vec;
    }
    
    return { buildVocab, getFeatureNames, normalizeL2, vectorizeItem };
}

module.exports = { createVectorizer };
