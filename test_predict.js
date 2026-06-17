fetch('http://localhost:3000/api/anime_recommend/predict', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tmdb_id: 20 })
}).then(async res => {
    console.log("Status:", res.status);
    const text = await res.text();
    console.log("Response:", text);
}).catch(console.error);
