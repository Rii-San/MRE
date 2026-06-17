const query = `
query ($search: String) {
    Page(page: 1, perPage: 10) {
        media(search: $search, type: ANIME, sort: SEARCH_MATCH) {
            id
            title {
                romaji
                english
            }
            startDate {
                year
            }
            coverImage {
                large
            }
        }
    }
}
`;

fetch('https://graphql.anilist.co', {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
    },
    body: JSON.stringify({
        query: query,
        variables: { search: "naruto" }
    })
}).then(res => res.text()).then(text => console.log(text)).catch(e => console.error(e));
