# Movie & Anime Recommender Engine (MRE)

A completely local, AI-powered recommender system that provides highly personalized movie and anime recommendations. Instead of relying on traditional keyword searches, MRE uses advanced dense vector embeddings to truly understand what a movie or anime is about, letting you search by concept, vibe, or semantic meaning.

## 🌟 Features
- **Semantic Search**: Search by concepts, feelings, or plots (e.g., *"A sci-fi movie about time loops and aliens"*).
- **Dual Database**: Separate, optimized databases for both Movies (via TMDB) and Anime (via AniList).
- **Personalized Tracking**: Keeps track of your watched history and personal ratings.
- **Bulk CSV Importer**: A built-in CLI tool to instantly import your existing watch history from platforms like Letterboxd or MyAnimeList.
- **100% Local Inference**: Uses the fast `nomic-embed-text` model running locally on your hardware.

---

## 🛠️ Installation & Setup

This project requires a small amount of initial setup before it is ready to use. 

### 1. Install Dependencies
Make sure you have [Node.js](https://nodejs.org/) installed. Open a terminal in the project folder and run:
```bash
npm install
```

### 2. Environment Variables (.env)
Create a new file in the root directory named exactly `.env` and add the following lines to it:
```env
PORT=3000
TMDB_API_KEY=your_tmdb_api_key_here
OMDB_API_KEY=your_omdb_api_key_here
ANILIST_CLIENT_ID=your_anilist_client_id_here
ANILIST_CLIENT_SECRET=your_anilist_client_secret_here
```

**How to get a TMDB API Key (It's Free!):**
1. Go to [The Movie Database (TMDB)](https://www.themoviedb.org/) and create a free account.
2. Go to your Account Settings -> API.
3. Request an API key (choose "Developer" for personal use).
4. Copy the "API Key (v3 auth)" and paste it into your `.env` file.

**How to get an OMDb API Key (It's Free!):**
1. Go to [OMDb API](http://www.omdbapi.com/apikey.aspx).
2. Choose the "FREE" tier and enter your email.
3. Check your email to verify and copy the API key.
4. Paste it into your `.env` file.

**How to get an AniList OAuth Client ID (For Anime Tracking):**
1. Go to your [AniList Developer Settings](https://anilist.co/settings/developer).
2. Click **Create New Client**.
3. Set the Name to anything (e.g., "MRE App").
4. **CRITICAL:** Set the **Redirect URL** to `http://localhost:3000/api/auth/anilist/callback`
5. Save, then copy your newly generated `Client ID` and `Client Secret` into your `.env` file.

### 3. Download the AI Model
To understand human language, the app needs an embedding model. 
1. Create a folder named `models` inside the root directory.
2. Download the [nomic-embed-text-v1.5.Q8_0.gguf](https://huggingface.co/nomic-ai/nomic-embed-text-v1.5-GGUF/resolve/main/nomic-embed-text-v1.5.Q8_0.gguf) model directly from HuggingFace.
3. Place the downloaded `.gguf` file inside the `models/` folder.

---

## 🚀 How to Run

Once everything is set up, starting the app is incredibly simple:
1. Double-click the **`start_mre.bat`** file in the root directory.
2. The local server will start, and you can open your browser to `http://localhost:3000`.

---

## 📦 Importing Your Watch History (CSV)

If you have a history of watched movies or anime, you can inject them directly into the databases to immediately improve your recommendations.

1. Ensure your `.csv` file is formatted with two columns: **Name, Rating**
   ```csv
   Inception, 9.5
   Spirited Away, 10
   ```
2. Place the CSV file(s) into the `csv_import2db/` folder (create it if it doesn't exist).
3. Right-click on `scripts/CsvDatabaseImporter.ps1` and select **Run with PowerShell** (or run it via terminal).
4. Follow the interactive menu to select your CSV and choose the target database (`movie.db` or `anime.db`). The script will automatically fetch all rich metadata from the APIs, generate the AI embeddings, and store them!

---

## 🧠 How It Works (The Math)

Traditional databases search for exact word matches. MRE uses **Dense Vector Embeddings** and **Cosine Similarity**.

1. **Vectorization**: When a new movie or anime is added to the database, its plot, genres, director, and tags are fed into the `nomic-embed-text` AI model. The AI converts this text into a "vector"—a 768-dimensional mathematical coordinate in space.
2. **Semantic Search**: When you search for "a gritty cyberpunk detective story," your search query is *also* converted into a vector coordinate.
3. **Cosine Similarity**: The system calculates the mathematical angle (Cosine Similarity) between your query vector and every movie vector in the database. 
   - A score closer to `1.0` means the vectors point in the exact same direction (highly relevant).
   - A score closer to `0.0` or `-1.0` means they are unrelated.
4. **Scoring**: The engine takes the top semantic matches and applies a final weighting algorithm that mixes in public popularity, global ratings, and your personal watch history to deliver the perfect recommendation.
