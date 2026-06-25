const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, '../../data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'anime.db');
const db = new Database(dbPath);

function initDb() {
    db.exec(`
        CREATE TABLE IF NOT EXISTS anime (
            anilist_id INTEGER PRIMARY KEY,
            title_english TEXT,
            title_romaji TEXT,
            release_year INTEGER,
            episodes INTEGER,
            format TEXT,
            genres TEXT,
            tags TEXT,
            average_score REAL,
            popularity INTEGER,
            description TEXT,
            cover_image TEXT,
            director TEXT,
            studios TEXT,
            adult BOOLEAN,
            plot_embedding TEXT
        );
    `);

    // Schema upgrades
    try {
        db.exec("ALTER TABLE anime ADD COLUMN franchise_group_id INTEGER;");
    } catch (e) { /* Column already exists */ }
    try {
        db.exec("ALTER TABLE anime ADD COLUMN primary_genres TEXT;");
    } catch (e) { /* Column already exists */ }

    db.exec(`
        CREATE TABLE IF NOT EXISTS watched_anime (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            anilist_id INTEGER NOT NULL,
            user_rating REAL,
            watch_date TEXT,
            notes TEXT,
            FOREIGN KEY (anilist_id) REFERENCES anime(anilist_id)
        );
    `);
}

initDb();

module.exports = db;
