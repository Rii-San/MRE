document.addEventListener('DOMContentLoaded', () => {
    const profileTiersContainer = document.getElementById('profile-tiers-container');
    const generateBtn = document.getElementById('generate-profile-btn');
    const bioText = document.getElementById('profile-bio-text');
    const editBioBtn = document.getElementById('edit-bio-btn');
    const exportBtn = document.getElementById('export-profile-btn');
    const importBtn = document.getElementById('import-profile-btn');
    const importInput = document.getElementById('import-profile-input');


    let currentProfile = {};

    function loadProfile() {
        fetch(apiUrl('profile'))
            .then(res => res.json())
            .then(data => {
                currentProfile = data || {};
                renderProfile();
            })
            .catch(err => console.error("Error loading profile:", err));
    }

    function renderConfidenceBadge(source, confidence) {
        if (source === 'locked') {
            return '';
        }
        if (source !== 'ai_predicted') return ''; // computed / user_input

        const labels = {
            high: "Predicted · research-backed",
            moderate: "Predicted",
            low: "Rough guess",
            none: "Just for fun"
        };
        const label = labels[confidence] || "Predicted";
        return `<span style="font-size: 0.65rem; color: var(--text-secondary); border: 1px dashed var(--glass-border); border-radius: 4px; padding: 2px 4px;">${label}</span>`;
    }

    function renderTraitValue(trait) {
        if (trait.key === 'big_five' && typeof trait.value === 'object') {
            const val = trait.value;
            return `
                <div class="big-five-grid">
                    ${Object.entries(val).map(([k, v]) => `
                        <div class="big-five-item" style="display: flex; flex-direction: column; align-items: stretch; gap: 0.2rem; margin-top: 0.5rem;">
                            <div style="display: flex; justify-content: space-between;">
                                <span class="big-five-label" style="text-transform: capitalize; font-size: 0.8rem;">${k}</span>
                                <span class="big-five-val" style="font-size: 0.8rem;" id="bf-val-${k}">${v}</span>
                            </div>
                            <input type="range" class="big-five-slider" data-key="${k}" min="0" max="100" value="${v}" style="width: 100%; accent-color: #10b981; cursor: pointer;">
                        </div>
                    `).join('')}
                </div>
            `;
        }
        return `<div style="font-size: 0.95rem; font-weight: 600; color: #e8eaed; margin-top: 0.2rem;">${trait.value || 'Unset'}</div>`;
    }

    function renderTier(title, count, items, disclaimer = '', dotColor = '#9c27b0') {
        if (!items || items.length === 0) return '';
        
        let html = `
            <div style="margin-bottom: 2rem;">
                <h3 style="font-size: 0.9rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-secondary); margin-bottom: 0.5rem; display: flex; align-items: center; gap: 0.5rem;">
                    <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: ${dotColor};"></span>
                    ${title} · ${count}
                </h3>
                ${disclaimer ? `<p style="font-size: 0.75rem; color: rgba(255,255,255,0.4); margin-bottom: 1rem; font-style: italic;">${disclaimer}</p>` : ''}
                <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 1rem;">
        `;

        items.forEach(t => {
            const extraClass = t.key === 'big_five' ? 'big-five-row' : '';
            const lockedClass = t.locked ? 'locked' : '';
            html += `
                <div class="profile-gray-tile trait-tile ${extraClass} ${lockedClass}" data-key="${t.key}" style="position: relative;">
                    <div style="position: absolute; top: 0.8rem; right: 0.8rem; z-index: 10;" title="Lock/Unlock this trait">
                        <input type="checkbox" class="trait-lock-checkbox" data-key="${t.key}" ${t.locked ? 'checked' : ''} style="cursor: pointer; width: 16px; height: 16px; accent-color: #10b981;">
                    </div>
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.2rem; padding-right: 2rem;">
                        <div style="font-size: 0.75rem; color: var(--text-secondary);">${t.label}</div>
                        ${renderConfidenceBadge(t.locked ? 'locked' : t.source, t.confidence)}
                    </div>
                    ${renderTraitValue(t)}
                </div>
            `;
        });

        html += `</div></div>`;
        return html;
    }

    function renderProfile() {
        if (currentProfile.self_description) {
            bioText.textContent = currentProfile.self_description;
            bioText.style.color = "#fff";
        } else {
            bioText.textContent = "Add a short description of yourself (100 words max)…";
            bioText.style.color = "var(--text-secondary)";
        }

        // Render Header
        const user = currentProfile.user || {};
        const name = user.name || 'Explorer';
        const initials = name.substring(0, 2).toUpperCase();
        let metaParts = [];
        if (user.birth_date && user.birth_date !== 'null') metaParts.push(user.birth_date);
        if (user.birth_time && user.birth_time !== 'null') metaParts.push(user.birth_time);
        if (user.birth_location && user.birth_location !== 'null') metaParts.push(user.birth_location);
        
        const headerHtml = `
            <div class="profile-header-card" id="profile-header-clickable" style="cursor: pointer; position: relative;">
                <div class="profile-avatar">${initials}</div>
                <div class="profile-header-info">
                    <h3>${name}</h3>
                    <p>${metaParts.length > 0 ? metaParts.join(' · ') : 'Birth data unset'}</p>
                </div>
                <button class="absolute text-gray-400 text-xs" style="position: absolute; top: 1rem; right: 1rem; background: transparent; border: none; color: var(--text-secondary); cursor: pointer;">✎</button>
            </div>
        `;
        document.getElementById('profile-header-container').innerHTML = headerHtml;

        document.getElementById('profile-header-clickable').addEventListener('click', () => {
            const u = currentProfile.user || {};
            document.getElementById('profile-edit-name').value = u.name || '';
            document.getElementById('profile-edit-dob').value = (u.birth_date && u.birth_date !== 'null') ? u.birth_date : '';
            document.getElementById('profile-edit-time').value = (u.birth_time && u.birth_time !== 'null') ? u.birth_time : '';
            document.getElementById('profile-edit-location').value = (u.birth_location && u.birth_location !== 'null') ? u.birth_location : '';
            document.getElementById('edit-profile-modal').classList.remove('hidden');
        });

        const traits = currentProfile.traits;
        const hasTraits = traits && (
            (traits.spiritual && traits.spiritual.length > 0) ||
            (traits.popular_psychology && traits.popular_psychology.length > 0) ||
            (traits.evidence_based && traits.evidence_based.length > 0)
        );

        if (!hasTraits) {
            profileTiersContainer.innerHTML = '<p style="color: var(--text-secondary);">No profile data yet. Click "Generate Full Profile" above to discover yourself!</p>';
            return;
        }

        let html = '';
        html += renderTier('Spiritual and cultural', traits.spiritual?.length || 0, traits.spiritual, '', '#9c27b0');
        html += renderTier('Popular psychology', traits.popular_psychology?.length || 0, traits.popular_psychology, "Widely used for self-reflection; test-retest reliability is weaker than Tier C.", '#f59e0b');
        html += renderTier('Evidence-based psychology', traits.evidence_based?.length || 0, traits.evidence_based, "Backed by peer-reviewed, replicated research.", '#10b981');

        profileTiersContainer.innerHTML = html;

        // Add click listeners to tiles for editing
        // Add click listeners to tiles for editing
        document.querySelectorAll('.trait-tile').forEach(tile => {
            tile.addEventListener('click', (e) => {
                if (e.target.tagName.toLowerCase() === 'input') return;
                const key = e.currentTarget.dataset.key;
                if (key === 'big_five') return; // handled by sliders
                const trait = Object.values(traits).flat().find(t => t.key === key);
                if (trait) promptEditTrait(trait);
            });
        });

        // Add change listener to checkboxes
        document.querySelectorAll('.trait-lock-checkbox').forEach(cb => {
            cb.addEventListener('change', (e) => {
                const key = e.currentTarget.dataset.key;
                const trait = Object.values(traits).flat().find(t => t.key === key);
                if (trait) {
                    trait.locked = e.currentTarget.checked;
                    fetch(apiUrl('profile'), {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ traits: currentProfile.traits })
                    }).then(() => {
                        showToast(trait.locked ? "Trait locked." : "Trait unlocked.");
                        renderProfile();
                    }).catch(err => {
                        showToast("Error updating trait lock: " + err.message, true);
                    });
                }
            });
        });

        // Add listeners to Big Five sliders
        document.querySelectorAll('.big-five-slider').forEach(slider => {
            slider.addEventListener('input', (e) => {
                const k = e.currentTarget.dataset.key;
                document.getElementById(`bf-val-${k}`).textContent = e.currentTarget.value;
            });
            slider.addEventListener('change', (e) => {
                const k = e.currentTarget.dataset.key;
                const v = parseInt(e.currentTarget.value);
                const trait = Object.values(traits).flat().find(t => t.key === 'big_five');
                if (trait && trait.value) {
                    trait.value[k] = v;
                    trait.locked = true;
                    trait.source = 'user_input';
                    fetch(apiUrl('profile'), {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ traits: currentProfile.traits })
                    }).then(() => {
                        showToast("Big Five updated.");
                        renderProfile();
                    }).catch(err => {
                        showToast("Error saving trait: " + err.message, true);
                    });
                }
            });
        });
    }

    function promptEditTrait(trait) {
        // We'll use a simple prompt for now to edit the value
        let currentVal = trait.value;
        if (typeof currentVal === 'object') {
            currentVal = JSON.stringify(currentVal);
        }
        const newVal = prompt(`Edit ${trait.label}:`, currentVal);
        if (newVal !== null && newVal !== currentVal) {
            let parsedVal = newVal;
            if (trait.key === 'big_five') {
                try {
                    parsedVal = JSON.parse(newVal);
                } catch(e) {
                    alert("Big Five must be valid JSON: {openness, conscientiousness, extraversion, agreeableness, neuroticism}");
                    return;
                }
            }
            
            trait.value = parsedVal;
            trait.locked = true;
            trait.source = 'user_input'; // Wait, if it was computed it might not need this, but spec says "Editing an ai_predicted field auto-flips it to locked".

            
            fetch(apiUrl('profile'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ traits: currentProfile.traits })
            }).then(() => {
                showToast("Trait updated and locked.");
                renderProfile();
            }).catch(e => showToast("Error saving trait: " + e.message, true));
        }
    }

    editBioBtn.addEventListener('click', () => {
        const newBio = prompt("Describe yourself (max 100 words):", currentProfile.self_description || "");
        if (newBio !== null) {
            fetch(apiUrl('profile'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ self_description: newBio })
            }).then(() => {
                currentProfile.self_description = newBio;
                renderProfile();
                showToast("Bio updated.");
            }).catch(e => showToast("Error saving bio: " + e.message, true));
        }
    });

    generateBtn.addEventListener('click', () => {
        const btnText = generateBtn.textContent;
        generateBtn.textContent = '✨ Generating...';
        generateBtn.disabled = true;

        fetch(apiUrl('profile/generate'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}) // Let server use existing profile data
        })
        .then(res => res.json())
        .then(data => {
            currentProfile = data;
            renderProfile();
            showToast("Profile generated successfully!");
        })
        .catch(err => {
            showToast("Failed to generate profile: " + err.message, true);
        })
        .finally(() => {
            generateBtn.textContent = btnText;
            generateBtn.disabled = false;
        });
    });

    if (exportBtn) {
        exportBtn.addEventListener('click', () => {
            const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(currentProfile, null, 2));
            const dlAnchorElem = document.createElement('a');
            dlAnchorElem.setAttribute("href", dataStr);
            dlAnchorElem.setAttribute("download", "mre_profile.json");
            dlAnchorElem.click();
        });
    }

    if (importBtn && importInput) {
        importBtn.addEventListener('click', () => {
            importInput.click();
        });

        importInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = (event) => {
                try {
                    const importedProfile = JSON.parse(event.target.result);
                    
                    fetch(apiUrl('profile'), {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            user: importedProfile.user,
                            traits: importedProfile.traits,
                            self_description: importedProfile.self_description
                        })
                    }).then(() => {
                        currentProfile = importedProfile;
                        renderProfile();
                        showToast("Profile imported successfully!");
                    }).catch(e => showToast("Error saving imported profile: " + e.message, true));
                } catch (err) {
                    showToast("Failed to parse profile JSON.", true);
                }
            };
            reader.readAsText(file);
            e.target.value = '';
        });
    }


    const editProfileModal = document.getElementById('edit-profile-modal');
    const closeProfileModalBtn = document.getElementById('close-profile-modal');
    const cancelProfileModalBtn = document.getElementById('cancel-profile-modal-btn');
    const editProfileForm = document.getElementById('edit-profile-form');

    if (closeProfileModalBtn) closeProfileModalBtn.addEventListener('click', () => editProfileModal.classList.add('hidden'));
    if (cancelProfileModalBtn) cancelProfileModalBtn.addEventListener('click', () => editProfileModal.classList.add('hidden'));

    if (editProfileForm) {
        editProfileForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const updatedUser = {
                ...(currentProfile.user || {}),
                name: document.getElementById('profile-edit-name').value,
                birth_date: document.getElementById('profile-edit-dob').value || null,
                birth_time: document.getElementById('profile-edit-time').value || null,
                birth_location: document.getElementById('profile-edit-location').value || null
            };
            
            fetch(apiUrl('profile'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ user: updatedUser })
            }).then(() => {
                currentProfile.user = updatedUser;
                renderProfile();
                showToast("Profile data updated.");
                editProfileModal.classList.add('hidden');
            }).catch(e => showToast("Error saving profile: " + e.message, true));
        });
    }

    // Load on init
    loadProfile();
});
