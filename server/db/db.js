const { createDatabase, safeAddColumn } = require('./dbFactory');

const db = createDatabase('movie.db', (db) => {
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
            plot_embedding TEXT,
            last_updated TEXT
        );
    `);

    safeAddColumn(db, 'movies', 'overview', 'TEXT');
    safeAddColumn(db, 'movies', 'plot_embedding', 'TEXT');
    safeAddColumn(db, 'movies', 'director', 'TEXT');
    safeAddColumn(db, 'movies', 'top_cast', 'TEXT');
    safeAddColumn(db, 'movies', 'production_companies', 'TEXT');
    safeAddColumn(db, 'movies', 'original_language', 'TEXT');
    safeAddColumn(db, 'movies', 'adult', 'BOOLEAN');
    safeAddColumn(db, 'movies', 'poster_path', 'TEXT');
    safeAddColumn(db, 'movies', 'collection_id', 'INTEGER');
    safeAddColumn(db, 'movies', 'collection_name', 'TEXT');
    safeAddColumn(db, 'movies', 'primary_genres', 'TEXT');
    safeAddColumn(db, 'movies', 'last_updated', 'TEXT');

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
});

module.exports = db;
