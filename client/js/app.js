let archiveData = [];

// DOM Elements
const navLinks = document.querySelectorAll('.nav-links li');
const views = document.querySelectorAll('.view-section');
const archiveGrid = document.getElementById('archive-grid');
const searchInput = document.getElementById('archive-search');
const sortSelect = document.getElementById('archive-sort');

const tmdbSearchInput = document.getElementById('tmdb-search-input');
const tmdbSearchBtn = document.getElementById('tmdb-search-btn');
const tmdbResults = document.getElementById('tmdb-results');
const addLogForm = document.getElementById('add-log-form');

const domainState = {
    movies: {
        predictInput: '', predictResultsHTML: '', predictScoreCardHTML: `
                        <div class="prediction-header">
                            <div class="score-circle">
                                <span id="predict-score-val">0</span>%
                            </div>
                            <div class="prediction-info">
                                <h3 id="predict-title">Title</h3>
                            </div>
                        </div>
                        <div id="predict-explanation" style="margin-top:1.2rem;"></div>
                        <div id="predict-warning" class="hidden" style="margin-top:1rem; padding:1rem; background:rgba(239, 68, 68, 0.1); border-left:4px solid #ef4444; border-radius:4px; font-size:0.9rem; color:#ef4444;"></div>
        `, predictScoreCardHidden: true, discoverHTML: '<div id="discover-list" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 350px), 1fr)); gap: 1.5rem; align-items: start;"></div>', discoverHidden: true
    },
    anime: {
        predictInput: '', predictResultsHTML: '', predictScoreCardHTML: `
                        <div class="prediction-header">
                            <div class="score-circle">
                                <span id="predict-score-val">0</span>%
                            </div>
                            <div class="prediction-info">
                                <h3 id="predict-title">Title</h3>
                            </div>
                        </div>
                        <div id="predict-explanation" style="margin-top:1.2rem;"></div>
                        <div id="predict-warning" class="hidden" style="margin-top:1rem; padding:1rem; background:rgba(239, 68, 68, 0.1); border-left:4px solid #ef4444; border-radius:4px; font-size:0.9rem; color:#ef4444;"></div>
        `, predictScoreCardHidden: true, discoverHTML: '<div id="discover-list" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 350px), 1fr)); gap: 1.5rem; align-items: start;"></div>', discoverHidden: true
    }
};

function saveDomainState(domain) {
    if (!domain) return;
    domainState[domain].predictInput = document.getElementById('predict-search-input').value;
    domainState[domain].predictResultsHTML = document.getElementById('predict-results').innerHTML;
    domainState[domain].predictScoreCardHTML = document.getElementById('predict-score-card').innerHTML;
    domainState[domain].predictScoreCardHidden = document.getElementById('predict-score-card').classList.contains('hidden');
    domainState[domain].discoverHTML = document.getElementById('discover-result').innerHTML;
    domainState[domain].discoverHidden = document.getElementById('discover-result').classList.contains('hidden');
}

function restoreDomainState(domain) {
    document.getElementById('predict-search-input').value = domainState[domain].predictInput;
    document.getElementById('predict-results').innerHTML = domainState[domain].predictResultsHTML;
    document.getElementById('predict-score-card').innerHTML = domainState[domain].predictScoreCardHTML;
    if (domainState[domain].predictScoreCardHidden) {
        document.getElementById('predict-score-card').classList.add('hidden');
    } else {
        document.getElementById('predict-score-card').classList.remove('hidden');
    }
    document.getElementById('discover-result').innerHTML = domainState[domain].discoverHTML;
    if (domainState[domain].discoverHidden) {
        document.getElementById('discover-result').classList.add('hidden');
    } else {
        document.getElementById('discover-result').classList.remove('hidden');
    }
}

// Initialize
// Initialize
document.addEventListener('DOMContentLoaded', () => {
    // ── Domain Toggle ──────────────────────────────────────────
    const btnMovies = document.getElementById('domain-movie-btn');
    const btnAnime = document.getElementById('domain-anime-btn');

    function switchDomain(domain) {
        if (window.CURRENT_DOMAIN) saveDomainState(window.CURRENT_DOMAIN);
        
        window.CURRENT_DOMAIN = domain;
        const discoverBtn = document.getElementById('discover-btn');
        if (domain === 'movies') {
            btnMovies.classList.add('active');
            btnMovies.style.color = '#fff';
            btnAnime.classList.remove('active');
            btnAnime.style.color = 'rgba(255,255,255,0.5)';
            if (discoverBtn) discoverBtn.textContent = '🔮 Discover 5 Movies';
            
            document.querySelector('[data-view="add"]').innerHTML = '➕ Log Movie';
            const logHeader = document.querySelector('#view-add h2');
            if (logHeader) logHeader.textContent = 'Log a Movie';
            if (tmdbSearchInput) tmdbSearchInput.placeholder = 'Search for a movie on TMDB...';
        } else {
            btnAnime.classList.add('active');
            btnAnime.style.color = '#fff';
            btnMovies.classList.remove('active');
            btnMovies.style.color = 'rgba(255,255,255,0.5)';
            if (discoverBtn) discoverBtn.textContent = '🔮 Discover 5 Anime';
            
            document.querySelector('[data-view="add"]').innerHTML = '➕ Log Anime';
            const logHeader = document.querySelector('#view-add h2');
            if (logHeader) logHeader.textContent = 'Log an Anime';
            if (tmdbSearchInput) tmdbSearchInput.placeholder = 'Search for an anime on AniList...';
        }
        
        restoreDomainState(domain);
        
        // Refresh active view
        document.querySelector('.nav-links li.active').click();
    }

    btnMovies.addEventListener('click', () => switchDomain('movies'));
    btnAnime.addEventListener('click', () => switchDomain('anime'));

    fetchArchive();

    // ── Background Sync Poller ─────────────────────────────────
    async function pollSyncStatus() {
        try {
            const res = await fetch(`${API_BASE}/sync/status`);
            const statusFull = await res.json();
            const status = window.CURRENT_DOMAIN === 'anime' ? statusFull.anime : statusFull.movie;
            const badge = document.getElementById('sync-indicator');
            const text = document.getElementById('sync-text');
            
            if (status && status.running && status.remaining > 0) {
                badge.classList.remove('hidden');
                text.textContent = `Syncing data... (${status.remaining} left)`;
            } else {
                badge.classList.add('hidden');
            }
        } catch (e) {
            // Silently fail so we don't spam console if server drops
        }
    }
    
    // Poll every 3 seconds
    setInterval(pollSyncStatus, 3000);
    pollSyncStatus(); // Initial check

    // ── Export ────────────────────────────────────────────────
    document.getElementById('export-btn').addEventListener('click', async () => {
        try {
            const res = await fetch(`${API_BASE}/export`);
            if (!res.ok) throw new Error('Export failed');
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `mre_archive_${new Date().toISOString().slice(0,10)}.json`;
            a.click();
            URL.revokeObjectURL(url);
            showToast('✅ Archive exported successfully!');
        } catch (err) {
            console.error(err);
            showToast('❌ Export failed', true);
        }
    });

    // ── Import ────────────────────────────────────────────────
    document.getElementById('import-file-input').addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        try {
            const text = await file.text();
            const parsed = JSON.parse(text);

            // Support both raw array and our { entries: [...] } wrapper format
            const entries = Array.isArray(parsed) ? parsed : parsed.entries;

            if (!entries) throw new Error('Invalid file format');

            showToast('⏳ Importing...');

            const res = await fetch(`${API_BASE}/export`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ entries })
            });

            const result = await res.json();
            if (!res.ok) throw new Error(result.error || 'Import failed');

            showToast(`✅ Imported ${result.imported} entries, skipped ${result.skipped} duplicates`);
            fetchArchive(); // Refresh grid
        } catch (err) {
            console.error(err);
            showToast(`❌ ${err.message}`, true);
        }

        // Reset file input so same file can be re-imported if needed
        e.target.value = '';
    });

    // Edit Modal Flow — must run after DOM is ready
    const editModal = document.getElementById('edit-modal');
    const closeEditModalBtn = document.getElementById('close-edit-modal');
    const cancelEditBtn = document.getElementById('cancel-edit-btn');
    const editLogForm = document.getElementById('edit-log-form');

    // Close on X button
    closeEditModalBtn.addEventListener('click', () => {
        editModal.classList.add('hidden');
    });

    // Close on Cancel button
    cancelEditBtn.addEventListener('click', () => {
        editModal.classList.add('hidden');
    });

    // Close on backdrop click
    editModal.addEventListener('click', (e) => {
        if (e.target === editModal) editModal.classList.add('hidden');
    });

    // Save changes
    editLogForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const submitBtn = editLogForm.querySelector('button[type="submit"]');
        const originalText = submitBtn.textContent;
        submitBtn.textContent = 'Saving...';
        submitBtn.disabled = true;

        const tmdbId = document.getElementById('edit-tmdb-id').value;
        const payload = {
            user_rating: parseFloat(document.getElementById('edit-rating').value),
            watch_date: document.getElementById('edit-date').value,
            rewatch: document.getElementById('edit-rewatch').checked,
            notes: document.getElementById('edit-notes').value
        };

        try {
            const res = await fetch(apiUrl(`watched/${tmdbId}`), {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!res.ok) {
                const errorData = await res.json();
                throw new Error(errorData.error || 'Failed to update');
            }

            editModal.classList.add('hidden');
            fetchArchive();
        } catch (err) {
            console.error(err);
            alert(err.message);
        } finally {
            submitBtn.textContent = originalText;
            submitBtn.disabled = false;
        }
    });
});

// Navigation
navLinks.forEach(link => {
    link.addEventListener('click', (e) => {
        navLinks.forEach(l => l.classList.remove('active'));
        e.currentTarget.classList.add('active');
        
        const targetView = e.currentTarget.dataset.view;
        views.forEach(v => {
            v.classList.remove('active');
            if (v.id === `view-${targetView}`) {
                v.classList.add('active');
            }
        });

        if(targetView === 'archive') {
            fetchArchive(); // refresh data
        } else if (targetView === 'watchlist') {
            fetchWatchlist();
        } else if (targetView === 'predict') {
            const formContainer = document.querySelector('#view-predict .form-container');
            const searchBox = formContainer.querySelector('.tmdb-search-box');
            const p = formContainer.querySelector('p');
            
            searchBox.classList.remove('hidden');
            if (window.CURRENT_DOMAIN === 'anime') {
                p.innerHTML = 'Search any anime to see how well it matches your personal taste profile.';
            } else {
                p.innerHTML = 'Search any movie to see how well it matches your personal taste profile.';
            }
        }
    });
});

// ── Watchlist Logic ────────────────────────────────────────────────
const watchlistGrid = document.getElementById('watchlist-grid');
let watchlistData = [];

async function fetchWatchlist() {
    try {
        const res = await fetch(apiUrl('watchlist'));
        if (!res.ok) throw new Error('Failed to fetch watchlist');
        const raw = await res.json();
        
        if (window.CURRENT_DOMAIN === 'anime') {
            watchlistData = raw.map(a => ({
                id: a.anilist_id,
                tmdb_id: a.anilist_id,
                title: a.title_english || a.title_romaji || 'Unknown',
                release_year: a.release_year,
                poster_path: a.cover_image,
                added_date: a.added_date
            }));
        } else {
            watchlistData = raw.map(m => ({ ...m, id: m.tmdb_id }));
        }

        renderWatchlist();
    } catch (err) {
        console.error(err);
        watchlistGrid.innerHTML = `<p style="color: #ef4444;">Failed to load watchlist.</p>`;
    }
}

function renderWatchlist() {
    if (watchlistData.length === 0) {
        watchlistGrid.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">📋</div>
                <h3>Your watchlist is empty</h3>
                <p>Discover movies and save them for later!</p>
            </div>
        `;
        return;
    }

    watchlistGrid.innerHTML = watchlistData.map(m => {
        const posterHtml = m.poster_path 
            ? (m.poster_path.startsWith('http')
                ? `<img src="${m.poster_path}" alt="${m.title}" style="width:100%; aspect-ratio:2/3; object-fit:cover; border-radius:6px; margin-bottom:0.8rem;">`
                : `<img src="https://image.tmdb.org/t/p/w300${m.poster_path}" alt="${m.title}" style="width:100%; aspect-ratio:2/3; object-fit:cover; border-radius:6px; margin-bottom:0.8rem;">`)
            : '';
        return `
        <div class="movie-card slide-up watchlist-item" data-id="${m.tmdb_id}">
            ${posterHtml}
            <h3 class="movie-title">${m.title}</h3>
            <div class="movie-meta">
                <span>${m.release_year || '?'}</span>
                <span>📋 Added ${m.added_date}</span>
            </div>
            <div style="display:flex; gap:0.5rem; margin-top:1rem;">
                <button class="primary-btn log-watchlist-btn" style="flex:1; font-size:0.8rem; padding:0.4rem;" data-id="${m.tmdb_id}" data-title="${m.title.replace(/"/g, '&quot;')}">Log Movie</button>
                <button class="secondary-btn remove-watchlist-btn" style="flex:1; font-size:0.8rem; padding:0.4rem; border-color:#ef4444; color:#ef4444;" data-id="${m.tmdb_id}">Remove</button>
            </div>
        </div>`;
    }).join('');

    // Bind log buttons
    document.querySelectorAll('.log-watchlist-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const tmdbId = e.currentTarget.dataset.id;
            const title = e.currentTarget.dataset.title;
            document.getElementById('quicklog-tmdb-id').value = tmdbId;
            document.getElementById('quicklog-movie-title').textContent = title;
            document.getElementById('quicklog-date').value = new Date().toISOString().split('T')[0];
            
            // Mark it so we know it came from watchlist
            document.getElementById('quicklog-form').dataset.fromWatchlist = 'true';
            
            document.getElementById('quicklog-modal').classList.remove('hidden');
        });
    });

    // Bind remove buttons
    document.querySelectorAll('.remove-watchlist-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const tmdbId = e.currentTarget.dataset.id;
            try {
                const res = await fetch(apiUrl(`watchlist/${tmdbId}`), { method: 'DELETE' });
                if (!res.ok) throw new Error('Failed to remove');
                showToast('✅ Removed from Watchlist');
                fetchWatchlist();
            } catch (err) {
                showToast('❌ ' + err.message, true);
            }
        });
    });
}

// Watchlist Export
document.getElementById('export-watchlist-btn').addEventListener('click', async () => {
    try {
        const res = await fetch(apiUrl('watchlist/export'));
        if (!res.ok) throw new Error('Failed to export watchlist');
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `mre_watchlist_${new Date().toISOString().slice(0,10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
        showToast('✅ Watchlist exported!');
    } catch (err) {
        showToast('❌ Export failed', true);
    }
});

// Watchlist Import
document.getElementById('import-watchlist-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        const entries = Array.isArray(parsed) ? parsed : parsed.entries;

        if (!entries || parsed.type !== 'watchlist') throw new Error('Invalid file format. Expected watchlist JSON.');

        showToast('⏳ Importing watchlist...');

        const res = await fetch(apiUrl('watchlist/import'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ entries, type: 'watchlist' })
        });

        const result = await res.json();
        if (!res.ok) throw new Error(result.error || 'Import failed');

        showToast(`✅ Imported ${result.imported} entries, skipped ${result.skipped}`);
        fetchWatchlist();
    } catch (err) {
        showToast(`❌ ${err.message}`, true);
    }
    e.target.value = '';
});

// Fetch & Render Archive
async function fetchArchive() {
    try {
        const res = await fetch(apiUrl('watched'));
        if (!res.ok) throw new Error('Failed to fetch');
        const raw = await res.json();

        // Normalize anime vs movie shapes into a single unified shape
        if (window.CURRENT_DOMAIN === 'anime') {
            archiveData = raw.map(a => ({
                id: a.anilist_id,
                anilist_id: a.anilist_id,
                title: a.title_english || a.title_romaji || 'Unknown',
                release_year: a.release_year,
                watch_date: a.watch_date,
                user_rating: a.user_rating,
                notes: a.notes,
                cover_image: a.cover_image,  // AniList CDN URL (not TMDB path)
                poster_path: null,
                rewatch: 0,
                tmdb_id: null
            }));
        } else {
            archiveData = raw.map(m => ({ ...m, id: m.tmdb_id }));
        }

        renderArchive();
    } catch (err) {
        console.error(err);
        archiveGrid.innerHTML = `<p style="color: #ef4444;">Failed to load archive.</p>`;
    }
}

function renderArchive() {
    const query = searchInput.value.toLowerCase();
    const sortVal = sortSelect.value;

    let filtered = archiveData.filter(m => 
        m.title.toLowerCase().includes(query) || 
        (m.notes && m.notes.toLowerCase().includes(query))
    );

    filtered.sort((a, b) => {
        if (sortVal === 'date_desc') return new Date(b.watch_date) - new Date(a.watch_date);
        if (sortVal === 'rating_desc') return b.user_rating - a.user_rating;
        if (sortVal === 'title_asc') return a.title.localeCompare(b.title);
        return 0;
    });

    archiveGrid.innerHTML = filtered.map(m => {
        // Poster: anime uses a full CDN URL; movies use TMDB path
        const posterHtml = m.cover_image
            ? `<img src="${m.cover_image}" alt="${m.title}" style="width:100%; aspect-ratio:2/3; object-fit:cover; border-radius:6px; margin-bottom:0.8rem;">`
            : (m.poster_path
                ? `<img src="https://image.tmdb.org/t/p/w300${m.poster_path}" alt="${m.title}" style="width:100%; aspect-ratio:2/3; object-fit:cover; border-radius:6px; margin-bottom:0.8rem;">`
                : '');
        return `
        <div class="movie-card slide-up archive-item" data-id="${m.id}" style="cursor: pointer;">
            <span class="edit-hint">✏️ Click to edit</span>
            <div class="rating-badge">★ ${parseFloat(m.user_rating).toFixed(1)}</div>
            ${posterHtml}
            <h3 class="movie-title">${m.title}</h3>
            <div class="movie-meta">
                <span>${m.release_year || '?'}</span>
                <span>📅 ${m.watch_date}</span>
                ${m.rewatch ? '<span title="Rewatch">🔄 Rewatch</span>' : ''}
            </div>
            ${m.notes ? `<div class="notes-preview">${m.notes}</div>` : ''}
        </div>`;
    }).join('');

    if (filtered.length === 0) {
        archiveGrid.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">🎬</div>
                <h3>${archiveData.length === 0 ? 'Your archive is empty' : 'No matches found'}</h3>
                <p>${archiveData.length === 0 ? 'Log your first movie to get started!' : 'Try a different search term.'}</p>
            </div>
        `;
    }

    document.querySelectorAll('.archive-item').forEach(card => {
        card.addEventListener('click', () => {
            const itemId = parseInt(card.dataset.id);
            const movie = archiveData.find(m => m.id === itemId);
            if (!movie) return;

            document.getElementById('edit-tmdb-id').value = movie.tmdb_id || movie.anilist_id;
            document.getElementById('edit-movie-title').textContent = movie.title || movie.title_english || movie.title_romaji;
            document.getElementById('edit-rating').value = movie.user_rating;
            document.getElementById('edit-date').value = movie.watch_date;
            document.getElementById('edit-rewatch').checked = movie.rewatch === 1;
            document.getElementById('edit-notes').value = movie.notes || '';

            const modal = document.getElementById('edit-modal');
            console.log('Modal element:', modal);
            modal.classList.remove('hidden');
        });
    });
}

searchInput.addEventListener('input', renderArchive);
sortSelect.addEventListener('change', renderArchive);

// Add Movie Flow
let searchTimeout;
tmdbSearchInput.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    const query = e.target.value.trim();
    const dropdown = document.getElementById('tmdb-autocomplete');
    
    if (!query) {
        dropdown.classList.add('hidden');
        return;
    }
    
    searchTimeout = setTimeout(async () => {
        try {
            const searchEndpoint = window.CURRENT_DOMAIN === 'anime' ? 'anime_search' : 'movies/search';
            const res = await fetch(`${API_BASE}/${searchEndpoint}?query=${encodeURIComponent(query)}`);
            const data = await res.json();
            
            if (!data.results || data.results.length === 0) {
                dropdown.innerHTML = '<div style="padding: 1rem; color: #888;">No results found</div>';
                dropdown.classList.remove('hidden');
                return;
            }

            dropdown.innerHTML = data.results.slice(0, 5).map(m => {
                const posterHtml = m.poster_path 
                    ? `<img src="${m.poster_path.startsWith('http') ? m.poster_path : `https://image.tmdb.org/t/p/w92${m.poster_path}`}">` 
                    : '<div style="width:35px;height:52px;background:#333;"></div>';
                return `
                <div class="autocomplete-item" data-id="${m.id}" data-title="${m.title.replace(/"/g, '&quot;')}" data-year="${m.release_date ? m.release_date.substring(0,4) : ''}" data-poster="${m.poster_path || ''}">
                    ${posterHtml}
                    <div>
                        <div style="font-weight:600;">${m.title}</div>
                        <div style="font-size:0.85rem; color:#888;">${m.release_date ? m.release_date.substring(0,4) : 'N/A'} • ★ ${(m.vote_average || 0).toFixed(1)}</div>
                    </div>
                </div>`;
            }).join('');

            dropdown.querySelectorAll('.autocomplete-item').forEach(item => {
                item.addEventListener('click', () => {
                    document.getElementById('log-tmdb-id').value = item.dataset.id;
                    document.getElementById('selected-title').textContent = item.dataset.title;
                    document.getElementById('selected-year').textContent = item.dataset.year;
                    
                    dropdown.classList.add('hidden');
                    tmdbSearchInput.value = item.dataset.title;
                    addLogForm.classList.remove('hidden');
                    document.getElementById('log-date').value = new Date().toISOString().split('T')[0];
                });
            });

            dropdown.classList.remove('hidden');
        } catch (e) {
            console.error(e);
        }
    }, 300);
});

// Close dropdowns when clicking outside
document.addEventListener('click', (e) => {
    if (!e.target.closest('.tmdb-search-box')) {
        document.getElementById('tmdb-autocomplete').classList.add('hidden');
        const pDrop = document.getElementById('predict-autocomplete');
        if (pDrop) pDrop.classList.add('hidden');
    }
});
    
// Removed old tmdbSearchBtn click listener

// Submit Log Form
addLogForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = e.target.querySelector('button[type="submit"]');
    const originalText = submitBtn.textContent;
    submitBtn.textContent = 'Saving...';
    submitBtn.disabled = true;

    const payload = {
        tmdb_id: parseInt(document.getElementById('log-tmdb-id').value),
        user_rating: parseFloat(document.getElementById('log-rating').value),
        watch_date: document.getElementById('log-date').value,
        rewatch: document.getElementById('log-rewatch').checked,
        notes: document.getElementById('log-notes').value
    };

    try {
        const res = await fetch(apiUrl('watched'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        if (!res.ok) {
            const errorData = await res.json();
            throw new Error(errorData.error || 'Failed to save');
        }
        
        // Reset form and go to archive
        addLogForm.reset();
        addLogForm.classList.add('hidden');
        document.querySelector('[data-view="archive"]').click(); // Switch view
        
    } catch (err) {
        console.error(err);
        alert(err.message);
    } finally {
        submitBtn.textContent = originalText;
        submitBtn.disabled = false;
    }
});

// Predict UI DOM
const predictSearchInput = document.getElementById('predict-search-input');
const predictSearchBtn = document.getElementById('predict-search-btn');
const predictResults = document.getElementById('predict-results');
const predictScoreCard = document.getElementById('predict-score-card');

// Predict Flow
let predictSearchTimeout;
predictSearchInput.addEventListener('input', (e) => {
    clearTimeout(predictSearchTimeout);
    const query = e.target.value.trim();
    const dropdown = document.getElementById('predict-autocomplete');
    
    if (!query) {
        dropdown.classList.add('hidden');
        return;
    }
    
    predictSearchTimeout = setTimeout(async () => {
        try {
            const searchEndpoint = window.CURRENT_DOMAIN === 'anime' ? 'anime_search' : 'movies/search';
            const res = await fetch(`${API_BASE}/${searchEndpoint}?query=${encodeURIComponent(query)}`);
            const data = await res.json();
            
            if (!data.results || data.results.length === 0) {
                dropdown.innerHTML = '<div style="padding: 1rem; color: #888;">No results found</div>';
                dropdown.classList.remove('hidden');
                return;
            }

            dropdown.innerHTML = data.results.slice(0, 5).map(m => {
                const posterHtml = m.poster_path 
                    ? `<img src="${m.poster_path.startsWith('http') ? m.poster_path : `https://image.tmdb.org/t/p/w92${m.poster_path}`}">` 
                    : '<div style="width:35px;height:52px;background:#333;"></div>';
                return `
                <div class="autocomplete-item" data-id="${m.id}" data-title="${m.title.replace(/"/g, '&quot;')}" data-year="${m.release_date ? m.release_date.substring(0,4) : ''}" data-poster="${m.poster_path || ''}">
                    ${posterHtml}
                    <div>
                        <div style="font-weight:600;">${m.title}</div>
                        <div style="font-size:0.85rem; color:#888;">${m.release_date ? m.release_date.substring(0,4) : 'N/A'} • ★ ${(m.vote_average || 0).toFixed(1)}</div>
                    </div>
                </div>`;
            }).join('');

            dropdown.querySelectorAll('.autocomplete-item').forEach(item => {
                item.addEventListener('click', async () => {
                    dropdown.classList.add('hidden');
                    predictSearchInput.value = item.dataset.title;
                    
                    // Trigger prediction logic
                    predictScoreCard.classList.remove('hidden');
                    predictResults.innerHTML = '';
                    predictScoreCard.querySelector('#predict-score-val').textContent = '...';
                    predictScoreCard.querySelector('#predict-title').textContent = 'Analyzing taste vectors...';

                    try {
                        const res = await fetch(apiUrl('recommend/predict'), {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ tmdb_id: item.dataset.id })
                        });
                        const preData = await res.json();
                        
                        if (preData.error) throw new Error(preData.error);
                        
                        predictResults.innerHTML = '';
                        predictScoreCard.classList.remove('hidden');
                        document.getElementById('predict-title').textContent = item.dataset.title;
                        
                        const statsHtml = `<div class="nerd-stats" style="margin-top:1rem;">
                            <div class="nerd-title">🤓 Nerd Stats</div>
                            <div>Metadata match (TF-IDF): ${preData.raw_cosine_similarity.toFixed(4)}</div>
                            ${preData.dense_similarity ? `<div>Plot meaning match (Semantic): ${preData.dense_similarity.toFixed(4)}</div>` : ''}
                            ${preData.dense_similarity ? `<div>Blended final score: ${preData.final_similarity.toFixed(4)}</div>` : ''}
                            <div style="margin-top:0.4rem; margin-bottom:0.2rem;">Top metadata matches:</div>
                            <ul>${preData.top_features.map(f => `<li>+${f.score.toFixed(4)} &nbsp;${f.rawName}</li>`).join('')}</ul>
                            ${preData.mismatches && preData.mismatches.length > 0 ? `
                            <div style="margin-top:0.6rem; margin-bottom:0.2rem; color:#f59e0b;">Unfamiliar metadata:</div>
                            <ul style="color:#f59e0b;">${preData.mismatches.map(m => `<li>${m.rawName} (movie: ${m.movieScore.toFixed(3)}, your profile: ${m.profileScore.toFixed(3)})</li>`).join('')}</ul>
                            ` : ''}
                        </div>`;

                        const warningHtml = preData.warning ? `
                            <div style="margin-top:0.6rem; padding:0.6rem 0.9rem; background:rgba(245,158,11,0.1); border:1px solid rgba(245,158,11,0.3); border-radius:7px; font-size:0.9rem; color:#fcd34d; display:flex; gap:0.5rem; align-items:flex-start;">
                                <span style="flex-shrink:0;">⚠️</span>
                                <span>${preData.warning}</span>
                            </div>` : '';

                        document.getElementById('predict-explanation').innerHTML = `
                            <div style="font-size:1rem; line-height:1.5; color:var(--text-secondary);">${preData.explanation}</div>
                            ${warningHtml}
                            ${statsHtml}
                            <div style="margin-top:1rem; display:flex; gap:0.5rem; justify-content:flex-end;">
                                <button class="primary-btn quicklog-predict-trigger" data-tmdb-id="${item.dataset.id}" data-title="${item.dataset.title.replace(/"/g, '&quot;')}" style="font-size:0.85rem; padding:0.5rem 1rem;">➕ Add to Archive</button>
                                <button class="secondary-btn add-to-watchlist-btn" data-id="${item.dataset.id}" data-title="${item.dataset.title.replace(/"/g, '&quot;')}" data-year="${item.dataset.year}" data-poster="${item.dataset.poster}" style="font-size:0.85rem; padding:0.5rem 1rem;">📋 Add to Watchlist</button>
                            </div>
                        `;
                        
                        document.querySelector('#predict-explanation .add-to-watchlist-btn').addEventListener('click', async (e) => {
                            try {
                                const payload = {
                                    tmdb_id: e.currentTarget.dataset.id,
                                    title: e.currentTarget.dataset.title,
                                    release_year: e.currentTarget.dataset.year,
                                    poster_path: e.currentTarget.dataset.poster
                                };
                                const rw = await fetch(apiUrl('watchlist'), {
                                    method: 'POST',
                                    headers: {'Content-Type': 'application/json'},
                                    body: JSON.stringify(payload)
                                });
                                const rd = await rw.json();
                                if(!rw.ok) throw new Error(rd.error);
                                showToast('✅ Added to Watchlist!');
                            } catch(err) {
                                showToast('❌ ' + err.message, true);
                            }
                        });
                        
                        document.querySelector('#predict-explanation .quicklog-predict-trigger').addEventListener('click', (e) => {
                            openQuickLog(e.currentTarget.dataset.tmdbId, e.currentTarget.dataset.title);
                        });
                        
                        const scoreSpan = document.getElementById('predict-score-val');
                        const circle = document.querySelector('.score-circle');
                        
                        let current = 0;
                        const target = preData.score;
                        circle.style.setProperty('--score', '0');
                        
                        const interval = setInterval(() => {
                            if(current >= target) {
                                clearInterval(interval);
                                scoreSpan.textContent = target;
                                circle.style.setProperty('--score', target);
                            } else {
                                current += 1;
                                if(current > target) current = target;
                                scoreSpan.textContent = current;
                                circle.style.setProperty('--score', current);
                            }
                        }, 10);

                    } catch (e) {
                        predictResults.innerHTML = `<p style="color:#ef4444;">Error: ${e.message}</p>`;
                    }
                });
            });

            dropdown.classList.remove('hidden');
        } catch (e) {
            console.error(e);
        }
    }, 300);
});


// Discover UI DOM
const discoverBtn = document.getElementById('discover-btn');
const discoverResult = document.getElementById('discover-result');

discoverBtn.addEventListener('click', async () => {
    const genre = document.getElementById('discover-genre').value;
    const sortBy = document.getElementById('discover-sort').value;
    const hiddenGem = document.getElementById('discover-hidden-gem').checked;
    
    discoverBtn.textContent = 'Discovering...';
    discoverResult.classList.add('hidden');
    
    try {
        let url = apiUrl(`discover?genre=${genre}&hidden_gem=${hiddenGem}&sort_by=${sortBy}`);
        const res = await fetch(url);
        const data = await res.json();
        
        if (!res.ok) throw new Error(data.error || 'Failed to discover');
        
        const listEl = document.getElementById('discover-list');
        listEl.innerHTML = data.movies.map((m, idx) => {
            const statsHtml = `<div class="nerd-stats" style="margin-top:0.5rem;">
                <div class="nerd-title">🤓 Nerd Stats</div>
                <div>Metadata match (TF-IDF): ${m.raw_cosine_similarity.toFixed(4)}</div>
                ${m.dense_similarity ? `<div>Plot meaning match (Semantic): ${m.dense_similarity.toFixed(4)}</div>` : ''}
                <div style="color:var(--accent-primary); margin-top:0.2rem; font-weight:bold;">Blended Score: ${m.final_similarity.toFixed(4)}</div>
                <div style="margin-top:0.4rem; margin-bottom:0.2rem;">Top matching features:</div>
                <ul>${m.top_features.map(f => `<li>+${f.score.toFixed(3)} ${f.rawName}</li>`).join('')}</ul>
            </div>`;

            const posterHtml = m.poster_path
                ? (m.poster_path.startsWith('http') 
                    ? `<img src="${m.poster_path}" alt="Poster" style="width:80px; min-width:80px; border-radius:10px; box-shadow: 0 6px 16px rgba(0,0,0,0.6);">`
                    : `<img src="https://image.tmdb.org/t/p/w185${m.poster_path}" alt="Poster" style="width:80px; min-width:80px; border-radius:10px; box-shadow: 0 6px 16px rgba(0,0,0,0.6);">`)
                : `<div style="width:80px; min-width:80px; height:120px; background:rgba(255,255,255,0.04); border-radius:10px; display:flex; align-items:center; justify-content:center; font-size:1.5rem;">🎬</div>`;

            return `
            <div class="glass-panel slide-up" style="display:flex; gap:1.5rem; align-items:flex-start; padding: 1.5rem; animation-delay:${idx*0.06}s;">
                ${posterHtml}
                <div style="flex:1; min-width:0;">
                    <div style="display:flex; align-items:baseline; gap:0.6rem; flex-wrap:wrap; margin-bottom:0.5rem;">
                        <h3 style="font-size:1.15rem; font-weight:700;">${m.title}</h3>
                        <span style="color:var(--text-secondary); font-size:0.9rem;">${m.release_year}</span>
                    </div>
                    <div style="display:flex; gap:0.5rem; margin-bottom:0.8rem; flex-wrap:wrap;">
                        <span class="rating-badge">🎯 ${m.match_score}% match</span>
                        <span class="rating-badge" style="background:rgba(255,255,255,0.05); border-color:var(--glass-border); color:var(--text-secondary);">⭐ ${parseFloat(m.tmdb_rating).toFixed(1)} TMDB</span>
                    </div>
                    <p style="color: var(--text-secondary); font-size:0.9rem; line-height: 1.55; margin-bottom:0.8rem;">${m.overview || 'No overview available.'}</p>
                    ${statsHtml}
                    <div style="display:flex; gap:0.5rem; margin-top:1rem;">
                        <button class="primary-btn quicklog-trigger" 
                            data-tmdb-id="${m.id}" 
                            data-title="${m.title.replace(/"/g, '&quot;')}" 
                            style="flex:1; font-size:0.82rem; padding:0.45rem 0.9rem;">
                            ➕ Add to Archive
                        </button>
                        <button class="secondary-btn discover-add-watchlist-btn" 
                            data-id="${m.id}" 
                            data-title="${m.title.replace(/"/g, '&quot;')}" 
                            data-year="${m.release_year}" 
                            data-poster="${m.poster_path}" 
                            style="flex:1; font-size:0.82rem; padding:0.45rem 0.9rem;">
                            📋 Watchlist
                        </button>
                    </div>
                </div>
            </div>`;
        }).join('');

        // Wire up quicklog buttons after render
        document.querySelectorAll('.quicklog-trigger').forEach(btn => {
            btn.addEventListener('click', () => openQuickLog(btn.dataset.tmdbId, btn.dataset.title));
        });

        document.querySelectorAll('.discover-add-watchlist-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                try {
                    const payload = {
                        tmdb_id: e.currentTarget.dataset.id,
                        title: e.currentTarget.dataset.title,
                        release_year: e.currentTarget.dataset.year,
                        poster_path: e.currentTarget.dataset.poster
                    };
                    const rw = await fetch(apiUrl('watchlist'), {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify(payload)
                    });
                    const rd = await rw.json();
                    if(!rw.ok) throw new Error(rd.error);
                    showToast('✅ Added to Watchlist!');
                } catch(err) {
                    showToast('❌ ' + err.message, true);
                }
            });
        });
        
        discoverResult.classList.remove('hidden');
    } catch (err) {
        console.error(err);
        alert(err.message);
    } finally {
        discoverBtn.textContent = window.CURRENT_DOMAIN === 'anime' ? '🔮 Discover 5 Anime' : '🔮 Discover 5 Movies';
    }
});

// Insights Flow
const insightsNav = document.querySelector('[data-view="insights"]');
const insightsContent = document.getElementById('insights-content');

insightsNav.addEventListener('click', async () => {
    insightsContent.innerHTML = '<p style="color: var(--text-secondary);">Analyzing your taste profile...</p>';
    try {
        const res = await fetch(apiUrl('insights'));
        const data = await res.json();

        if (data.error) {
            insightsContent.innerHTML = `<div class="empty-state"><div class="empty-state-icon">📊</div><h3>${data.error}</h3></div>`;
            return;
        }

        const generateBarHtml = (arr) => {
            if (!arr || arr.length === 0) return '<p style="color:var(--text-secondary); font-size:0.9rem;">Not enough data yet.</p>';
            const maxVal = Math.max(...arr.map(x => x.count), 1);
            return arr.map(x => `
                <div class="genre-row">
                    <span class="genre-name">${x.name} <span style="color:var(--text-secondary); font-size:0.8rem; font-weight:400;">(${x.count})</span></span>
                    <div class="genre-bar-wrap">
                        <div class="genre-bar" style="width:${Math.round((x.count/maxVal)*100)}%"></div>
                    </div>
                    <span class="genre-rating">★ ${x.avgRating}</span>
                </div>
            `).join('');
        };

        const genreHtml = generateBarHtml(data.top_genres);
        const directorHtml = generateBarHtml(data.top_directors);
        const actorHtml = generateBarHtml(data.top_actors);

        insightsContent.innerHTML = `
            <div class="insights-grid" style="margin-bottom:1.5rem;">
                <div class="insight-card slide-up">
                    <div class="insight-card-label">📺 Total Logged</div>
                    <div class="insight-card-value">${data.total_logged}</div>
                    <div class="insight-card-text">movies in your archive</div>
                </div>
                <div class="insight-card slide-up" style="animation-delay:0.08s;">
                    <div class="insight-card-label">⭐ You vs The Crowd</div>
                    <div class="insight-card-text" style="font-size:0.95rem; color:var(--text-primary); margin-top:0.4rem;">${data.crowd_relation}</div>
                </div>
                <div class="insight-card slide-up" style="animation-delay:0.16s;">
                    <div class="insight-card-label">🕰 Era Preference</div>
                    <div class="insight-card-text" style="font-size:0.95rem; color:var(--text-primary); margin-top:0.4rem;">${data.era_fact}</div>
                </div>
            </div>
            
            <div style="display:flex; flex-direction:column; gap:1rem;">
                <div class="insight-card slide-up" style="animation-delay:0.24s;">
                    <div class="insight-card-label" style="margin-bottom:1rem;">🎭 Top Genres</div>
                    ${genreHtml}
                </div>
                
                <div style="display:flex; gap:1rem; flex-wrap:wrap;">
                    <div class="insight-card slide-up" style="animation-delay:0.32s; flex:1; min-width:300px;">
                        <div class="insight-card-label" style="margin-bottom:1rem;">🎬 Top Directors</div>
                        ${directorHtml}
                    </div>
                    <div class="insight-card slide-up" style="animation-delay:0.40s; flex:1; min-width:300px;">
                        <div class="insight-card-label" style="margin-bottom:1rem;">${window.CURRENT_DOMAIN === 'anime' ? '🌟 Top Studios' : '🌟 Top Actors'}</div>
                        ${actorHtml}
                    </div>
                </div>
            </div>
        `;

    } catch (err) {
        console.error(err);
        insightsContent.innerHTML = `<p style="color:#ef4444;">Error loading insights.</p>`;
    }
});
// ── Quick-Log Modal (Discover → Archive shortcut) ─────────────────────────
function openQuickLog(tmdbId, title) {
    document.getElementById('quicklog-tmdb-id').value = tmdbId;
    document.getElementById('quicklog-movie-title').textContent = title;
    document.getElementById('quicklog-rating').value = '';
    document.getElementById('quicklog-date').value = new Date().toISOString().split('T')[0];
    document.getElementById('quicklog-rewatch').checked = false;
    document.getElementById('quicklog-notes').value = '';
    document.getElementById('quicklog-modal').classList.remove('hidden');
}

document.addEventListener('DOMContentLoaded', () => {
    const quicklogModal = document.getElementById('quicklog-modal');
    const quicklogForm  = document.getElementById('quicklog-form');

    // Close triggers
    document.getElementById('close-quicklog-modal').addEventListener('click', () => quicklogModal.classList.add('hidden'));
    document.getElementById('cancel-quicklog-btn').addEventListener('click', () => quicklogModal.classList.add('hidden'));
    quicklogModal.addEventListener('click', e => { if (e.target === quicklogModal) quicklogModal.classList.add('hidden'); });

    // Submit
    quicklogForm.addEventListener('submit', async e => {
        e.preventDefault();
        const submitBtn = quicklogForm.querySelector('button[type="submit"]');
        const originalText = submitBtn.textContent;
        submitBtn.textContent = 'Saving...';
        submitBtn.disabled = true;

        const tmdbId = parseInt(document.getElementById('quicklog-tmdb-id').value);
        const payload = {
            tmdb_id: tmdbId,
            user_rating: parseFloat(document.getElementById('quicklog-rating').value),
            watch_date: document.getElementById('quicklog-date').value,
            rewatch: document.getElementById('quicklog-rewatch').checked,
            notes: document.getElementById('quicklog-notes').value
        };

        try {
            const res = await fetch(apiUrl('watched'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const result = await res.json();
            if (!res.ok) throw new Error(result.error || 'Failed to save');

            quicklogModal.classList.add('hidden');
            
            // Show toast (grab showToast from parent DOMContentLoaded scope via event)
            const toast = document.getElementById('toast');
            toast.textContent = `✅ Added to Archive!`;
            toast.style.background = 'linear-gradient(135deg,#4f8ef7,#7c3aed)';
            toast.classList.add('visible');
            clearTimeout(toast._timer);
            toast._timer = setTimeout(() => toast.classList.remove('visible'), 3500);
            if (quicklogForm.dataset.fromWatchlist === 'true') {
                try {
                    await fetch(apiUrl(`watchlist/${tmdbId}`), { method: 'DELETE' });
                } catch(e) { console.error('Failed to remove from watchlist', e); }
                quicklogForm.dataset.fromWatchlist = 'false';
            }

        } catch (err) {
            console.error(err);
            alert(err.message);
        } finally {
            submitBtn.textContent = originalText;
            submitBtn.disabled = false;
        }
    });

    // ── Bulk Modal Logic ──────────────────────────────────────
    const openBulkLogBtn = document.getElementById('open-bulk-log-btn');
    const bulkLogModal = document.getElementById('bulk-log-modal');
    const closeBulkLogBtn = document.getElementById('close-bulk-log-modal');
    const bulkFetchBtn = document.getElementById('bulk-fetch-btn');
    const bulkBackBtn = document.getElementById('bulk-back-btn');
    const bulkSaveBtn = document.getElementById('bulk-save-btn');

    const bulkStep1 = document.getElementById('bulk-step-1');
    const bulkStep2 = document.getElementById('bulk-step-2');
    const bulkListInput = document.getElementById('bulk-list-input');
    const bulkMatchGrid = document.getElementById('bulk-match-grid');

    let currentBulkMatches = [];

    if (openBulkLogBtn) {
        openBulkLogBtn.addEventListener('click', () => {
            bulkLogModal.classList.remove('hidden');
            bulkStep1.classList.remove('hidden');
            bulkStep2.classList.add('hidden');
            bulkListInput.value = '';
            currentBulkMatches = [];
        });

        closeBulkLogBtn.addEventListener('click', () => {
            bulkLogModal.classList.add('hidden');
        });
        bulkLogModal.addEventListener('click', (e) => {
            if (e.target === bulkLogModal) bulkLogModal.classList.add('hidden');
        });

        bulkBackBtn.addEventListener('click', () => {
            bulkStep2.classList.add('hidden');
            bulkStep1.classList.remove('hidden');
        });

        bulkFetchBtn.addEventListener('click', async () => {
            const rawText = bulkListInput.value;
            const titles = rawText.split('\n').map(t => t.trim()).filter(t => t.length > 0);
            
            if (titles.length === 0) return;

            bulkFetchBtn.textContent = 'Fetching Matches...';
            bulkFetchBtn.disabled = true;

            try {
                const res = await fetch(`${API_BASE}/movies/bulk-match`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ titles })
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error);

                currentBulkMatches = data.matches;

                // Render Step 2
                bulkMatchGrid.innerHTML = currentBulkMatches.map((m, idx) => {
                    if (m.error) {
                        return `
                        <div class="bulk-match-item" style="border-color:#ef4444;">
                            <div style="width:45px; height:68px; background:rgba(239,68,68,0.2); border-radius:6px; display:flex; align-items:center; justify-content:center;">❌</div>
                            <div class="bulk-match-info">
                                <h4 style="color:#ef4444;">${m.match_query}</h4>
                                <div style="font-size:0.85rem; color:#888;">No match found</div>
                            </div>
                        </div>`;
                    }

                    return `
                    <div class="bulk-match-item">
                        ${m.poster_path ? `<img src="https://image.tmdb.org/t/p/w92${m.poster_path}">` : '<div style="width:45px; height:68px; background:#333; border-radius:6px;"></div>'}
                        <div class="bulk-match-info">
                            <div style="font-size:0.75rem; color:var(--text-secondary); text-transform:uppercase;">Searched: "${m.match_query}"</div>
                            <h4>${m.title}</h4>
                            <div style="font-size:0.85rem; color:#888;">${m.release_year}</div>
                        </div>
                        <div class="bulk-match-rating">
                            <input type="number" class="glass-input bulk-rating-input" data-idx="${idx}" min="0" max="10" step="0.5" placeholder="0-10" style="width:100%; padding:0.5rem; text-align:center;">
                        </div>
                    </div>`;
                }).join('');

                bulkStep1.classList.add('hidden');
                bulkStep2.classList.remove('hidden');

            } catch (err) {
                const toast = document.getElementById('toast');
                toast.textContent = '❌ Failed to bulk match: ' + err.message;
                toast.style.background = 'linear-gradient(135deg,#ef4444,#b91c1c)';
                toast.classList.add('visible');
                clearTimeout(toast._timer);
                toast._timer = setTimeout(() => toast.classList.remove('visible'), 3500);
            } finally {
                bulkFetchBtn.textContent = 'Fetch Matches';
                bulkFetchBtn.disabled = false;
            }
        });

        bulkSaveBtn.addEventListener('click', async () => {
            const inputs = document.querySelectorAll('.bulk-rating-input');
            const entries = [];

            inputs.forEach(input => {
                const val = input.value.trim();
                if (val !== '') {
                    const idx = parseInt(input.dataset.idx);
                    const match = currentBulkMatches[idx];
                    entries.push({
                        tmdb_id: match.id,
                        user_rating: parseFloat(val)
                    });
                }
            });

            if (entries.length === 0) {
                alert('Please enter at least one rating.');
                return;
            }

            bulkSaveBtn.textContent = 'Saving...';
            bulkSaveBtn.disabled = true;

            try {
                const res = await fetch(apiUrl('watched/bulk'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ entries })
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error);

                bulkLogModal.classList.add('hidden');
                
                const toast = document.getElementById('toast');
                toast.textContent = `✅ Saved ${data.imported} movies to archive!`;
                toast.style.background = 'linear-gradient(135deg,#4f8ef7,#7c3aed)';
                toast.classList.add('visible');
                clearTimeout(toast._timer);
                toast._timer = setTimeout(() => toast.classList.remove('visible'), 3500);

                document.querySelector('[data-view="archive"]').click();
                
            } catch (err) {
                alert('❌ Failed to save: ' + err.message);
            } finally {
                bulkSaveBtn.textContent = 'Save All Ratings';
                bulkSaveBtn.disabled = false;
            }
        });
    }

});

