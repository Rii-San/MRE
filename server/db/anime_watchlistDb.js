const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, '../../data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'anime_watchlist.db');
const db = new Database(dbPath);

function initDb() {
    db.exec(`
        CREATE TABLE IF NOT EXISTS watchlist_anime (
            anilist_id INTEGER PRIMARY KEY,
            title_english TEXT,
            title_romaji TEXT,
            release_year INTEGER,
            cover_image TEXT,
            added_date TEXT
        );
    `);
}

initDb();

module.exports = db;
