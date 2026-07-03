const path = require('path');

// ANSI Color Codes
const colors = {
    reset: "\x1b[0m",
    red: "\x1b[31m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    blue: "\x1b[34m",
    magenta: "\x1b[35m",
    cyan: "\x1b[36m",
    white: "\x1b[37m",
    gray: "\x1b[90m"
};

const getTimestamp = () => {
    const now = new Date();
    return `${now.toISOString().replace('T', ' ').substring(0, 19)}`;
};

const formatMessage = (level, color, component, msg, ...args) => {
    const timestamp = `${colors.gray}[${getTimestamp()}]${colors.reset}`;
    const lvl = `${color}[${level}]${colors.reset}`;
    const comp = component ? `${colors.magenta}[${component}]${colors.reset} ` : '';
    
    // Convert objects to string representation if needed, or rely on console.log's native handling
    return [ `${timestamp} ${lvl} ${comp}${msg}`, ...args ];
};

const logger = {
    info: (msg, component = '', ...args) => {
        console.log(...formatMessage('INFO ', colors.cyan, component, msg, ...args));
    },
    warn: (msg, component = '', ...args) => {
        console.warn(...formatMessage('WARN ', colors.yellow, component, msg, ...args));
    },
    error: (msg, component = '', ...args) => {
        console.error(...formatMessage('ERROR', colors.red, component, msg, ...args));
    },
    debug: (msg, component = '', ...args) => {
        console.debug(...formatMessage('DEBUG', colors.blue, component, msg, ...args));
    },
    http: (msg, component = 'HTTP', ...args) => {
        console.log(...formatMessage('HTTP ', colors.green, component, msg, ...args));
    },
    // Useful for a plain log with no level formatting but keeping the timestamp
    log: (msg, ...args) => {
        console.log(`${colors.gray}[${getTimestamp()}]${colors.reset} ${msg}`, ...args);
    }
};

module.exports = logger;
