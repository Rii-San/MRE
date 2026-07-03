const logger = require('../utils/logger');
const { getEmbedding } = require('../llm');

function createSyncLoop(config) {
    const {
        name,
        getItemsQuery,
        getId,
        getTitle,
        getPlot,
        fetchDetails,
        updateEmbedding,
        checkMissing,
        deleteItem
    } = config;

    let status = { running: false, remaining: 0, currentItem: null };
    let currentInterval = 2000;
    let noHitCount = 0;
    const syncAttempts = new Map();

    async function processNext() {
        try {
            const itemsToSync = getItemsQuery();
            status.remaining = itemsToSync.length;

            if (itemsToSync.length === 0) {
                status.running = false;
                status.currentItem = null;
                
                noHitCount++;
                if (noHitCount >= 3) {
                    currentInterval = Math.min(currentInterval * 2, 32000);
                    noHitCount = 0;
                }
                
                setTimeout(processNext, currentInterval);
                return;
            }

            noHitCount = 0;
            currentInterval = Math.max(currentInterval / 2, 2000);

            status.running = true;
            const item = itemsToSync[0];
            const id = getId(item);
            const title = getTitle(item);
            status.currentItem = title;

            logger.info(`Repairing data for: ${title}`, name);
            
            let plot = getPlot(item);
            const fetchedPlot = await fetchDetails(item);
            if (fetchedPlot) plot = fetchedPlot;

            if (plot && !item.plot_embedding) {
                try {
                    const embedArr = await getEmbedding(plot);
                    if (embedArr) {
                        const embedStr = JSON.stringify(embedArr);
                        updateEmbedding(id, embedStr);
                    } else {
                        logger.warn(`Embedding model returned empty for ${title}`, name);
                    }
                } catch (e) {
                    logger.error(`Failed to get embedding for ${title}`, name);
                }
            }

            const stillMissing = checkMissing(id);

            if (stillMissing) {
                let attempts = syncAttempts.get(id) || 0;
                attempts++;
                
                if (attempts >= 3) {
                    logger.warn(`Deleting ${title} after 3 failed attempts to fetch complete details.`, name);
                    deleteItem(id);
                    syncAttempts.delete(id);
                } else {
                    syncAttempts.set(id, attempts);
                }
            } else {
                syncAttempts.delete(id);
            }

        } catch (err) {
            logger.error(`Loop error: ${err.message}`, name);
        }

        setTimeout(processNext, currentInterval);
    }

    return {
        startSyncLoop: () => {
            logger.info("Background repair loop started.", name);
            processNext();
        },
        getSyncStatus: () => status
    };
}

module.exports = { createSyncLoop };
