const { createDatabase } = require('./dbFactory');

const db = createDatabase('anime_watchlist.db', (db) => {
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
});

module.exports = db;
