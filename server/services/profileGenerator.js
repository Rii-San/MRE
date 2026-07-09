const { executeWithFallback, genAI } = require('./gemini');
const { generateTasteSummary } = require('./preprocessor');
const { getCachedTasteSummary } = require('../engine/cache');

const PROFILE_PROMPT_TEMPLATE = `You are a personality profile generator. Given a user's birth data, quiz answers, taste data (movies/anime watched, genres, ratings), and an optional self-description, compute all 24 traits below and return ONLY valid JSON matching the schema at the end.

INPUT:
- birth_date (YYYY-MM-DD, required): {{birth_date}}
- birth_time (HH:MM, 24hr, optional): {{birth_time}}
- birth_location (city or lat/long, optional): {{birth_location}}
- quiz_answers (object, optional, per-trait as noted below): {{quiz_answers}}
- taste_data (optional — array of {title, type: movie|anime|show, genre_tags, user_rating}): {{taste_data}}
- self_description (optional — user's own free-text bio, ≤100 words): {{self_description}}
- locked_fields (array of trait keys the user has manually confirmed — Gemini must never overwrite these): {{locked_fields}}
- confirmed_traits (object mapping locked trait keys to their confirmed values. USE these values to inform and improve your predictions for the unlocked traits!): {{confirmed_traits}}

For every trait, output a "source" of one of: computed | user_input | ai_predicted, plus "locked": true/false.
For ai_predicted traits, also output "confidence": high | moderate | low | none — see per-trait guidance below. "none" means: entertainment-only guess, no research basis, label it as such in the UI copy, don't pretend it's psychometric.

═══════════════════════════════════════
TIER A — SPIRITUAL & CULTURAL (12 traits)
═══════════════════════════════════════

1. vedic_sign (rashi) — Moon's sidereal zodiacal position (Lahiri ayanamsa) at exact birth_time + birth_location, via ephemeris calculation. Requires full birth data. NO shortcut using birth_date alone — a date-only approximation of a Moon-based sign is worse than useless, it's actively wrong. If birth_time/location missing: source = ai_predicted, confidence = none, and say so plainly ("we can't compute this without your birth time — here's Gemini's best guess from your taste profile, for fun only").

2. nakshatra — Same ephemeris dependency as #1. Same fallback rule: no data → ai_predicted/none, not a guess dressed up as astronomy.

3. chinese_zodiac — From the lunar calendar year at birth_date (correctly handling the Jan 21–Feb 20 lunar new year boundary, not just calendar year). This already avoids the sloppy "just the Gregorian year" mistake — keep it exact.

4. chinese_five_element — Compute via the full Four Pillars (BaZi) method: derive the Heavenly Stem + Earthly Branch for year, month, day, AND hour (if birth_time available), then determine the dominant element by weighting across all pillars — not the lazy "last digit of birth year" shortcut. If birth_time is missing, use the three pillars available (year/month/day) — still far richer than year alone. Only if birth_date itself is incomplete does this fall to ai_predicted/low confidence.

5. ayurvedic_dosha — Primary: 20-question dosha quiz (quiz_answers.dosha_quiz). Deterministic fallback: derive from vedic_sign + nakshatra's ruling element (classical Ayurveda-Jyotish mapping) — this only works if #1/#2 were actually computed, not ai_predicted. If neither quiz nor real vedic_sign exists: ai_predicted from taste_data + self_description, confidence = low (no direct research linking screen-taste to dosha).

6. aura_color — Primary: aura_quiz (mood/energy/color-preference items). Deterministic fallback: numerology_life_path_number → fixed number-to-color table (this is a real deterministic mapping, not a shortcut — keep). Final fallback: ai_predicted from taste_data/self_description, confidence = none (color-aura has no evidentiary base at all; be explicit about that in UI copy).

7. crystal_ally — Deterministic lookup from aura_color (1:1 table). No prediction needed once aura_color exists.

8. spirit_animal — Primary: spirit_animal_quiz. Deterministic fallback: derive from chinese_zodiac's animal family. Final fallback: ai_predicted from taste_data (e.g. protagonist archetypes in the anime/movies they rate highly), confidence = none.

9. human_design_type — Full planetary/gate chart at (birth_time − 88 solar days), requires exact birth_time + location. There is no meaningful shortcut here — approximating without exact data produces a wrong Type, not an estimate. If missing: ai_predicted, confidence = none, labeled clearly as a placeholder guess, not a Human Design reading.

10. numerology_life_path — Deterministic digit-sum reduction of the FULL birth_date (day+month+year), reducing to 1–9 unless a master number (11/22/33) appears mid-reduction. Already whole-date-based — no change needed, just don't let anyone simplify this to birth year alone.

11. tarot_birth_card — Deterministic reduction of full birth_date to 1–22, mapped to Major Arcana. Whole-date-based already — keep.

12. birthstone — DEFAULT METHOD CHANGED: derive from the ruling planet of the user's actual vedic_sign + nakshatra (Jyotish gemstone tradition), NOT the Western month-based list. This requires vedic_sign to be genuinely computed (see #1) — so birthstone inherits whatever real astronomical precision the user's birth data supports, rather than "April = diamond for literally a quarter of the population." If vedic_sign itself had to fall back to ai_predicted (no birth time/location), birthstone inherits that same fallback and confidence level — don't quietly drop back to the Western month list as a "safer" default; that reintroduces the exact crudeness we're avoiding. Only offer the Western month list as an opt-in display toggle for users who specifically want it, clearly labeled as the simpler/less precise system.

═══════════════════════════════════════
TIER B — POPULAR PSYCHOLOGY (4 traits)
disclaimer: "Widely used for self-reflection; test-retest reliability is weaker than Tier C."
═══════════════════════════════════════

13. love_language — Primary: Chapman's 30-item forced-choice quiz. Fallback: ai_predicted from self_description text (linguistic cues about what makes the user feel cared for) + taste_data, confidence = low.

14. mbti_type — Primary: mbti_quiz (4 dichotomies). Fallback: ai_predicted from self_description + taste_data (genre/pacing preferences have weak-but-nonzero correlation with I/E and S/N), confidence = low.

15. enneagram_type — Primary: enneagram_quiz. Fallback: ai_predicted from self_description, confidence = low (self-description text is a more defensible signal for this than taste data alone).

16. humor_style — Primary: Humor Styles Questionnaire (32-item). Fallback: ai_predicted from taste_data, especially comedy/genre ratings, confidence = moderate — humor preference in media is one of the more directly-analogous signals here.

═══════════════════════════════════════
TIER C — EVIDENCE-BASED PSYCHOLOGY (8 traits)
disclaimer: "Backed by peer-reviewed, replicated research."
═══════════════════════════════════════

17. big_five — Primary: BFI-44 or validated 10-item short form. Fallback: ai_predicted from taste_data genre distribution, confidence = HIGH for openness and extraversion specifically — genre-preference research shows real correlations (e.g. openness with science-fiction/fantasy, extraversion with adventure/horror), moderate for conscientiousness/agreeableness/neuroticism where evidence is thinner. Output as five 0–100 percentiles, rendered as bars, never collapsed to one label regardless of source.

18. attachment_style — Primary: ECR short-form quiz. Fallback: ai_predicted from self_description tone/content, confidence = low. Taste_data alone is a weak signal here — don't over-claim.

19. chronotype — Primary: reduced Morningness-Eveningness Questionnaire. Better-than-quiz option if available: derive from actual viewing-timestamp data (when the user watches, not what) — this is real behavioral data, source = computed, not predicted. Fallback if neither exists: ai_predicted, confidence = none.

20. sensitivity_hsp — Primary: Aron's HSP Scale short form. Fallback: ai_predicted from self_description + taste_data (e.g. affinity for emotionally intense or slow/atmospheric content), confidence = low.

21. screen_taste_personality — Maps movie/anime genre distribution to the analogous entertainment-preference dimensions (Communal, Aesthetic, Dark, Thrilling, Cerebral) found in film-genre personality research. source = computed directly from taste_data, not ai_predicted.

22. locus_of_control — Primary: Rotter short-form quiz. Fallback: ai_predicted from self_description, confidence = low.

23. optimism — Primary: LOT-R (10 items). Fallback: ai_predicted from self_description sentiment + taste_data (tone of preferred content), confidence = low-moderate.

24. sensation_seeking — Primary: Brief Sensation Seeking Scale (8 items). Fallback: ai_predicted from taste_data — this one has real backing, since horror/thriller/action preference correlates with sensation-seeking in the literature, confidence = moderate.

OUTPUT JSON SCHEMA:
{
  "user": { "name": "string", "birth_date": "string", "birth_time": "string|null", "birth_location": "string|null" },
  "self_description": "string|null",
  "traits": {
    "spiritual": [ { "key": "string", "label": "string", "value": "string", "source": "computed|ai_predicted|user_input", "confidence": "high|moderate|low|none|null", "locked": true|false }, ... 12 items ],
    "popular_psychology": [ { "key": "string", "label": "string", "value": "string", "source": "user_input|ai_predicted", "confidence": "string|null", "locked": true|false, "disclaimer": "string" }, ... 4 items ],
    "evidence_based": [ { "key": "string", "label": "string", "value": "string|object", "source": "user_input|computed|ai_predicted", "confidence": "string|null", "locked": true|false, "disclaimer": "string" }, ... 8 items ]
  }
}
`;


async function generate24Traits(profileInput, existingProfile) {
    let summaryText = getCachedTasteSummary();
    if (!summaryText) {
        const result = await generateTasteSummary(3, 3);
        summaryText = result.summary;
    }
    
    const lockedFields = [];
    const confirmedTraits = {};
    if (existingProfile && existingProfile.traits) {
        Object.values(existingProfile.traits).flat().forEach(t => {
            if (t.locked) {
                lockedFields.push(t.key);
                confirmedTraits[t.key] = t.value;
            }
        });
    }

    const prompt = PROFILE_PROMPT_TEMPLATE
        .replace('{{birth_date}}', profileInput.user?.birth_date || 'null')
        .replace('{{birth_time}}', profileInput.user?.birth_time || 'null')
        .replace('{{birth_location}}', profileInput.user?.birth_location || 'null')
        .replace('{{quiz_answers}}', JSON.stringify(profileInput.quiz_answers || {}))
        .replace('{{taste_data}}', summaryText || 'No taste data available')
        .replace('{{self_description}}', profileInput.self_description || 'null')
        .replace('{{locked_fields}}', JSON.stringify(lockedFields))
        .replace('{{confirmed_traits}}', JSON.stringify(confirmedTraits));

    const systemInstruction = "You are a personality profile generator that calculates 24 distinct traits. Obey the rules for locked fields strictly. DO NOT output markdown code blocks. Output raw JSON only.";
    
    return await executeWithFallback(async (modelName) => {
        const model = genAI.getGenerativeModel({
            model: modelName,
            systemInstruction: systemInstruction,
            generationConfig: { 
                responseMimeType: "application/json", 
                maxOutputTokens: 8192, 
                temperature: 0.2, 
                thinkingConfig: { thinkingBudget: 0 } 
            }
        });
        
        const result = await model.generateContent(prompt);
        return JSON.parse(result.response.text());
    });
}

module.exports = {
    generate24Traits
};
