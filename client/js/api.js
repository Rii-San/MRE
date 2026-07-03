const API_BASE = '/api';
window.CURRENT_DOMAIN = 'movies';
// Returns the correct API path segment for the active domain
function apiUrl(resource) {
    const globalRoutes = ['export', 'import', 'profile', 'deep_insights'];
    if (globalRoutes.includes(resource.split('?')[0])) {
        return `${API_BASE}/${resource}`;
    }
    // Convert 'movies' to 'movie' for consistency on the backend domain parameters if needed?
    // Actually our domains are 'anime' and 'movies' in index.js (wait, I used /api/:domain/... so it matches window.CURRENT_DOMAIN!)
    let domain = window.CURRENT_DOMAIN;
    if (domain === 'movies') domain = 'movie'; // Ensure backend consistency since it uses 'movie' / 'anime'
    return `${API_BASE}/${domain}/${resource}`;
}
