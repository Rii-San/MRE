const q = `query ($id: Int) {
  Media(id: $id, type: ANIME) {
    id
    title { english romaji }
    startDate { year }
    episodes
    format
    genres
    tags { name rank }
    averageScore
    popularity
    description(asHtml: false)
    coverImage { extraLarge }
    isAdult
    staff(perPage: 5) {
      edges { role node { name } }
    }
    studios(isMain: true) {
      edges { node { name } }
    }
  }
}`;

fetch('https://graphql.anilist.co', { 
    method: 'POST', 
    headers: {'Content-Type': 'application/json'}, 
    body: JSON.stringify({query: q, variables: {id: 1689}}) 
}).then(r=>r.json()).then(d=>console.log(JSON.stringify(d, null, 2)));
