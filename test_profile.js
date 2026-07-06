async function runTest() {
    console.log("🚀 Starting Profile System Tests...");
    const API_BASE = 'http://localhost:3000/api/profile';

    try {
        // 1. Set mock user details
        console.log("\n1️⃣ Setting mock user details...");
        const mockUser = {
            name: "Test User",
            birth_date: "1995-10-15",
            birth_time: "14:30",
            birth_location: "New York, USA"
        };
        let res = await fetch(API_BASE, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user: mockUser })
        });
        let data = await res.json();
        console.log("User details saved. Current Name:", data.user?.name);
        if (data.user?.name !== "Test User") throw new Error("User details failed to save!");

        // 2. Click Generate Profile
        console.log("\n2️⃣ Simulating 'Generate Full Profile' click...");
        res = await fetch(`${API_BASE}/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        });
        data = await res.json();
        console.log("Profile generated. Trait count:", Object.keys(data.traits || {}).length);
        
        // Check if user details persisted
        console.log("Checking if user details persisted after generation...");
        if (data.user?.name !== "Test User") {
            throw new Error(`FAIL: User name was reset to ${data.user?.name}`);
        } else {
            console.log("✅ User details persisted successfully!");
        }

        // 3. Test locking a trait
        console.log("\n3️⃣ Simulating 'Lock Trait' checkbox click...");
        let firstTraitKey = null;
        if (data.traits && data.traits.spiritual && data.traits.spiritual.length > 0) {
            firstTraitKey = data.traits.spiritual[0].key;
            data.traits.spiritual[0].locked = true;
            data.traits.spiritual[0].value = "LOCKED_VALUE_TEST";
            
            res = await fetch(API_BASE, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ traits: data.traits })
            });
            data = await res.json();
            console.log(`Trait '${firstTraitKey}' locked.`);
        }

        // 4. Test Big Five sliders update
        console.log("\n4️⃣ Simulating 'Big Five Slider' change...");
        if (data.traits && data.traits.evidence_based) {
            const bigFive = data.traits.evidence_based.find(t => t.key === 'big_five');
            if (bigFive) {
                bigFive.value = { openness: 99, conscientiousness: 88, extraversion: 77, agreeableness: 66, neuroticism: 55 };
                bigFive.locked = true;
                res = await fetch(API_BASE, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ traits: data.traits })
                });
                data = await res.json();
                console.log("Big Five updated via sliders.");
            }
        }

        // 5. Generate again to verify locks hold
        console.log("\n5️⃣ Generating profile again to verify locks...");
        res = await fetch(`${API_BASE}/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        });
        data = await res.json();
        
        // Verify locked trait
        if (firstTraitKey) {
            const t = data.traits.spiritual.find(x => x.key === firstTraitKey);
            if (t && t.value === "LOCKED_VALUE_TEST" && t.locked === true) {
                console.log(`✅ Locked trait '${firstTraitKey}' was correctly preserved by generator!`);
            } else {
                throw new Error(`FAIL: Locked trait '${firstTraitKey}' was overwritten!`);
            }
        }

        // Verify Big Five
        if (data.traits && data.traits.evidence_based) {
            const bf = data.traits.evidence_based.find(t => t.key === 'big_five');
            if (bf && bf.value.openness === 99 && bf.locked === true) {
                console.log("✅ Big Five sliders state correctly preserved by generator!");
            } else {
                throw new Error("FAIL: Big Five was overwritten by generator!");
            }
        }

        console.log("\n🎉 ALL TESTS PASSED!");

    } catch (err) {
        console.error("\n❌ TEST FAILED:", err.message);
    }
}

runTest();
