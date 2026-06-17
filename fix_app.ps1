$content = Get-Content 'client\app.js' -Raw

# Fix all mangled apiUrl calls
$content = $content.Replace("apiUrl('atched/bulk", "apiUrl('watched/bulk")
$content = $content.Replace("apiUrl('atchlist/export", "apiUrl('watchlist/export")
$content = $content.Replace("apiUrl('atchlist/import", "apiUrl('watchlist/import")
$content = $content.Replace("apiUrl('atchlist``", "apiUrl('watchlist``")
$content = $content.Replace("apiUrl('iscover?", "apiUrl('discover?")
$content = $content.Replace("apiUrl('nsights``", "apiUrl('insights``")
$content = $content.Replace("apiUrl('atched``", "apiUrl('watched``")

# Fix the broken watchlist delete line
$content = $content.Replace("await fetch(``')DELETE' });", "await fetch(apiUrl(``watchlist/`${tmdbId}``), { method: 'DELETE' });")

Set-Content 'client\app.js' $content
Write-Host "Done"
