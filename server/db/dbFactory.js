const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const logger = require('../utils/logger');

function createDatabase(dbFileName, initSchema) {
    const dataDir = path.join(__dirname, '../../data');
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }
    
    const dbPath = path.join(dataDir, dbFileName);
    const db = new Database(dbPath);
    
    if (initSchema) {
        initSchema(db);
    }
    
    logger.info(`Database ${dbFileName} initialized successfully.`, 'DB');
    return db;
}

function safeAddColumn(db, table, column, type) {
    try {
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type};`);
    } catch (e) { 
        // Column already exists
    }
}

module.exports = { createDatabase, safeAddColumn };
