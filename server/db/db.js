const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Ensure data directory exists
const dataDir = path.join(__dirname, '../../data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'movie.db');
const db = new Database(dbPath, { verbose: console.log });

function initDb() {
    // Create movies table (local cache of TMDB data)
    db.exec(`
        CREATE TABLE IF NOT EXISTS movies (
            tmdb_id INTEGER PRIMARY KEY,
            title TEXT NOT NULL,
            release_year INTEGER,
            runtime INTEGER,
            country TEXT,
            genres TEXT,
            keywords TEXT,
            tmdb_rating REAL,
            tmdb_votes INTEGER,
            overview TEXT,
            plot_embedding TEXT
        );
    `);

    // Schema upgrades for existing databases
    try {
        db.exec("ALTER TABLE movies ADD COLUMN overview TEXT;");
    } catch (e) { /* Column already exists */ }
    try {
        db.exec("ALTER TABLE movies ADD COLUMN plot_embedding TEXT;");
    } catch (e) { /* Column already exists */ }
    try {
        db.exec("ALTER TABLE movies ADD COLUMN director TEXT;");
    } catch (e) { /* Column already exists */ }
    try {
        db.exec("ALTER TABLE movies ADD COLUMN top_cast TEXT;");
    } catch (e) { /* Column already exists */ }
    try {
        db.exec("ALTER TABLE movies ADD COLUMN production_companies TEXT;");
    } catch (e) { /* Column already exists */ }
    try {
        db.exec("ALTER TABLE movies ADD COLUMN original_language TEXT;");
    } catch (e) { /* Column already exists */ }
    try {
        db.exec("ALTER TABLE movies ADD COLUMN adult BOOLEAN;");
    } catch (e) { /* Column already exists */ }
    try {
        db.exec("ALTER TABLE movies ADD COLUMN poster_path TEXT;");
    } catch (e) { /* Column already exists */ }
    try {
        db.exec("ALTER TABLE movies ADD COLUMN collection_id INTEGER;");
    } catch (e) { /* Column already exists */ }
    try {
        db.exec("ALTER TABLE movies ADD COLUMN collection_name TEXT;");
    } catch (e) { /* Column already exists */ }
    try {
        db.exec("ALTER TABLE movies ADD COLUMN primary_genres TEXT;");
    } catch (e) { /* Column already exists */ }

    // Create watched table (personal log)
    db.exec(`
        CREATE TABLE IF NOT EXISTS watched (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tmdb_id INTEGER NOT NULL,
            user_rating REAL,
            rating_diff REAL,
            watch_date TEXT,
            watched_with TEXT,
            rewatch BOOLEAN DEFAULT 0,
            notes TEXT,
            FOREIGN KEY (tmdb_id) REFERENCES movies(tmdb_id)
        );
    `);
    
    console.log("Database initialized successfully.");
}

initDb();

module.exports = db;
