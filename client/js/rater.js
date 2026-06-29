// ── SYSTEMATIC RATING ASSISTANT ──

const CATS = [
  {
    id: 'story', icon: '📖', name: 'How was the Story?', weight: 3.0,
    subs: [
      { id: 'fresh',      q: 'Did the story feel fresh or predictable?' },
      { id: 'pacing',     q: 'Did the pacing keep you engaged throughout?' },
      { id: 'ending',     q: 'Did the ending satisfy you?' },
      { id: 'world',      q: 'Did the world and plot make you want to explore more?' },
    ]
  },
  {
    id: 'audio', icon: '🎵', name: 'How was the Audio?', weight: 1.0,
    subs: [
      { id: 'voices',     q: 'Were the voices clear and enjoyable?' },
      { id: 'soundtrack', q: 'Did the soundtrack move you emotionally?' },
      { id: 'memorable',  q: 'Did any music become memorable?' },
      { id: 'sfx',        q: 'Did the sound effects enhance the experience?' },
    ]
  },
  {
    id: 'characters', icon: '💖', name: 'How were the Characters?', weight: 1.5,
    subs: [
      { id: 'stealheart', q: 'Did any character steal your heart—or awaken your desire?' },
      { id: 'motivations',q: 'Were the characters\' motivations believable?' },
      { id: 'backstories',q: 'Were their backstories meaningful?' },
      { id: 'inspire',    q: 'Did any character inspire you or teach you something valuable?' },
    ]
  },
  {
    id: 'visuals', icon: '🎨', name: 'How were the Visuals?', weight: 2.5,
    subs: [
      { id: 'wallpapers', q: 'Were there scenes beautiful enough to be wallpapers?' },
      { id: 'alive',      q: 'Did the environments feel alive and immersive?' },
      { id: 'colors',     q: 'Did the colors and lighting fit the mood?' },
      { id: 'designs',    q: 'Were the costumes, props, or designs memorable?' },
    ]
  },
  {
    id: 'vibe', icon: '🌌', name: 'How was the Vibe?', weight: 2.0,
    subs: [
      { id: 'feel',       q: 'Did it make you laugh, cry, smile, or feel deeply?' },
      { id: 'goosebumps', q: 'Did it give you goosebumps or moments of awe?' },
      { id: 'moved',      q: 'Did it leave you emotionally moved?' },
      { id: 'comfort',    q: 'Did it feel comforting, soothing, or emotionally fulfilling?' },
    ]
  },
];

// State
let raterScores = {};
let currentTargetInputId = null;

function initRaterScores() {
    raterScores = {};
    CATS.forEach(c => {
        raterScores[c.id] = { override: null, subs: {} };
        c.subs.forEach(s => raterScores[c.id].subs[s.id] = 0);
    });
}
initRaterScores();

const VERDICTS = [
  [0, 0,   '— Unrated'],
  [0.1, 2, '💀 Skip it'],
  [2.1, 4, '😐 Pretty mid'],
  [4.1, 5, '🙂 Decent watch'],
  [5.1, 6, '👍 Solid'],
  [6.1, 7, '🔥 Good stuff'],
  [7.1, 8, '⭐ Really liked it'],
  [8.1, 9, '🌟 Near masterpiece'],
  [9.1, 10,'👑 Peak. All-time.'],
];

function getVerdict(t) {
    for (const [lo, hi, label] of VERDICTS) {
        if (t >= lo && t <= hi) return label;
    }
    return '—';
}

function catScore(catId) {
    if (raterScores[catId].override !== null) {
        return raterScores[catId].override;
    }
    const cat = CATS.find(c => c.id === catId);
    const subVals = cat.subs.map(s => raterScores[catId].subs[s.id]);
    const sum = subVals.reduce((a,b) => a+b, 0);
    const max = cat.subs.length * 2;
    return (sum / max) * cat.weight;
}

function totalScore() {
    return CATS.reduce((a, c) => a + catScore(c.id), 0);
}

// UI Build
function buildRaterUI() {
    const wrap = document.getElementById('rating-cats-wrap');
    if (!wrap) return;
    wrap.innerHTML = '';
    
    CATS.forEach(cat => {
        const card = document.createElement('div');
        card.className = 'cat-card';
        card.id = 'cat-' + cat.id;
        card.innerHTML = `
            <div class="cat-head">
                <div class="cat-head-left" onclick="toggleCat('${cat.id}')" style="flex:1;">
                    <span class="cat-icon">${cat.icon}</span>
                    <div>
                        <div class="cat-name" style="font-size: 0.95rem;">${cat.name}</div>
                    </div>
                </div>
                <div style="display:flex; align-items:center; gap:6px;">
                    <input type="number" class="glass-input cat-override-input" id="override-${cat.id}" min="0" max="${cat.weight}" step="0.1" value="0.0" oninput="setCatOverride('${cat.id}', this.value, this)" onblur="if(this.value !== '') this.value = parseFloat(this.value).toFixed(1)" onclick="event.stopPropagation()" style="width: 58px; padding: 4px; font-size: 0.85rem; font-weight:700; text-align: center; border-radius: 6px; background: rgba(0,0,0,0.3); border: 1px solid var(--glass-border); color: var(--success, #98c377);" title="Rate out of ${cat.weight} directly">
                    <span style="font-size: 0.8rem; color: var(--text-secondary); font-weight: 600;">/ ${cat.weight.toFixed(1)}</span>
                </div>
            </div>
            <div class="cat-divider"></div>
            <div class="subkeys" id="subs-${cat.id}" style="display: none;">
                ${cat.subs.map(s => `
                    <div class="subkey" style="grid-template-columns: 1fr auto; align-items: start;">
                        <div class="subkey-name" style="font-size: 0.82rem; font-weight: 500; line-height: 1.4; padding-top: 4px;">${s.q}</div>
                        <div class="subkey-ctrl">
                            <button type="button" class="sk-btn" onclick="adjRater('${cat.id}','${s.id}',-1)">−</button>
                            <div class="sk-pips">
                                <div class="pip" id="pip-${cat.id}-${s.id}-1"></div>
                                <div class="pip" id="pip-${cat.id}-${s.id}-2"></div>
                            </div>
                            <div class="sk-val" id="val-${cat.id}-${s.id}">0</div>
                            <button type="button" class="sk-btn" onclick="adjRater('${cat.id}','${s.id}',+1)">+</button>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
        wrap.appendChild(card);
    });
}

function toggleCat(catId) {
    const subs = document.getElementById(`subs-${catId}`);
    if (subs.style.display === 'none') {
        subs.style.display = 'flex';
    } else {
        subs.style.display = 'none';
    }
}

function setCatOverride(catId, val, inputEl) {
    const cat = CATS.find(c => c.id === catId);
    if (val === '') {
        raterScores[catId].override = null;
    } else {
        let num = parseFloat(val) || 0;
        if (num > cat.weight) {
            num = cat.weight;
            if(inputEl) inputEl.value = cat.weight.toFixed(1);
        } else if (num < 0) {
            num = 0;
            if(inputEl) inputEl.value = '0.0';
        }
        raterScores[catId].override = num;
    }
    refreshRaterTotal();
}

function adjRater(catId, subId, delta) {
    // Using micro-questions clears any manual override
    raterScores[catId].override = null;
    
    raterScores[catId].subs[subId] = Math.max(0, Math.min(2, raterScores[catId].subs[subId] + delta));
    refreshRaterSub(catId, subId);
    refreshRaterCat(catId);
    refreshRaterTotal();
}

function refreshRaterSub(catId, subId) {
    const v = raterScores[catId].subs[subId];
    document.getElementById(`val-${catId}-${subId}`).textContent = v;
    for (let i = 1; i <= 2; i++) {
        const pip = document.getElementById(`pip-${catId}-${subId}-${i}`);
        if(pip) pip.className = 'pip' + (i <= v ? (i === 2 ? ' on2' : ' on') : '');
    }
}

function refreshRaterCat(catId) {
    const cs = catScore(catId);
    const overrideInput = document.getElementById(`override-${catId}`);
    if(overrideInput && raterScores[catId].override === null) {
        overrideInput.value = cs.toFixed(1);
    }
}

function refreshRaterTotal() {
    const t = totalScore();
    const disp = Math.round(t * 10) / 10;
    
    const numEl = document.getElementById('rating-total-num');
    if(numEl) numEl.textContent = disp % 1 === 0 ? disp.toFixed(0) : disp.toFixed(1);
    
    const fillEl = document.getElementById('rating-ring-fill');
    if(fillEl) {
        const circ = 188.5;
        const offset = circ - (t / 10) * circ;
        fillEl.style.strokeDashoffset = offset;
    }
    
    const verdictVal = document.getElementById('rating-verdict-val');
    if(verdictVal) verdictVal.textContent = getVerdict(t);
    
    const barEl = document.getElementById('rating-verdict-bar');
    if(barEl) barEl.style.width = (t / 10 * 100) + '%';
}

function resetRater() {
    initRaterScores();
    CATS.forEach(cat => {
        cat.subs.forEach(s => refreshRaterSub(cat.id, s.id));
        const overrideInput = document.getElementById(`override-${cat.id}`);
        if(overrideInput) overrideInput.value = '0.0';
        refreshRaterCat(cat.id);
        const subs = document.getElementById(`subs-${cat.id}`);
        if(subs) subs.style.display = 'none';
    });
    refreshRaterTotal();
}

function openRatingModal(targetId) {
    currentTargetInputId = targetId;
    resetRater();
    document.getElementById('rating-assistant-modal').classList.remove('hidden');
}

function closeRatingModal() {
    document.getElementById('rating-assistant-modal').classList.add('hidden');
    currentTargetInputId = null;
}

function applyRating() {
    if (!currentTargetInputId) return;
    const t = totalScore();
    const disp = Math.round(t * 10) / 10;
    
    const targetInput = document.getElementById(currentTargetInputId);
    if (targetInput) {
        targetInput.value = disp;
        // Optionally trigger any change events if needed by app.js
        targetInput.dispatchEvent(new Event('input', { bubbles: true }));
        targetInput.dispatchEvent(new Event('change', { bubbles: true }));
    }
    
    closeRatingModal();
    if(typeof showToast === 'function') {
        showToast('Systematic rating applied! (' + disp + ')');
    }
}

// Bind Events on DOMContentLoaded
document.addEventListener('DOMContentLoaded', () => {
    buildRaterUI();
    refreshRaterTotal();
    
    // Bind wand buttons
    document.querySelectorAll('.rate-sys-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const target = btn.dataset.target;
            openRatingModal(target);
        });
    });
    
    const closeBtn = document.getElementById('close-rating-modal');
    if(closeBtn) closeBtn.addEventListener('click', closeRatingModal);
    
    const resetBtn = document.getElementById('reset-rating-btn');
    if(resetBtn) resetBtn.addEventListener('click', resetRater);
    
    const applyBtn = document.getElementById('apply-rating-btn');
    if(applyBtn) applyBtn.addEventListener('click', applyRating);
});
