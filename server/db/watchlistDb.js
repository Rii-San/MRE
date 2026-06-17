const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Ensure data directory exists
const dataDir = path.join(__dirname, '../../data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'watchlist.db');
const db = new Database(dbPath, { verbose: console.log });

function initDb() {
    db.exec(`
        CREATE TABLE IF NOT EXISTS watchlist (
            tmdb_id INTEGER PRIMARY KEY,
            title TEXT NOT NULL,
            release_year INTEGER,
            poster_path TEXT,
            added_date TEXT NOT NULL
        );
    `);
    
    console.log("Watchlist database initialized successfully.");
}

initDb();

module.exports = db;
