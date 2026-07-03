const { createDatabase, safeAddColumn } = require('./dbFactory');

const db = createDatabase('anime.db', (db) => {
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

    safeAddColumn(db, 'anime', 'franchise_group_id', 'INTEGER');
    safeAddColumn(db, 'anime', 'primary_genres', 'TEXT');

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
});

module.exports = db;
