const { createDatabase } = require('./dbFactory');

const db = createDatabase('movie_watchlist.db', (db) => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS watchlist (
            tmdb_id INTEGER PRIMARY KEY,
            title TEXT NOT NULL,
            release_year INTEGER,
            poster_path TEXT,
            added_date TEXT NOT NULL
        );
    `);
});

module.exports = db;
