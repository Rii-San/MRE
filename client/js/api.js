const API_BASE = '/api';
window.CURRENT_DOMAIN = 'movies';
// Returns the correct API path segment for the active domain
function apiUrl(resource) {
    if (window.CURRENT_DOMAIN === 'anime') return `${API_BASE}/anime_${resource}`;
    return `${API_BASE}/${resource}`;
}
