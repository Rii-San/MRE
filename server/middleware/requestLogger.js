const logger = require('../utils/logger');

const requestLogger = (req, res, next) => {
    const start = process.hrtime();

    // Intercept response finish to log the request
    res.on('finish', () => {
        const diff = process.hrtime(start);
        const time = Math.round(diff[0] * 1e3 + diff[1] * 1e-6); // Convert to ms
        
        const method = req.method;
        const url = req.originalUrl || req.url;
        const status = res.statusCode;
        
        // Don't log spammy polling endpoints
        if (url === '/api/sync/status') return;
        
        let statusColor = '\x1b[32m'; // Green for success
        if (status >= 400 && status < 500) statusColor = '\x1b[33m'; // Yellow for client errors
        else if (status >= 500) statusColor = '\x1b[31m'; // Red for server errors

        const resetColor = '\x1b[0m';
        
        logger.http(`${method} ${url} - ${statusColor}${status}${resetColor} - ${time}ms`, 'Express');
    });

    next();
};

module.exports = requestLogger;
