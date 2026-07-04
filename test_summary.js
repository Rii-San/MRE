const { generateTasteSummary } = require('./server/services/preprocessor');

async function test() {
    try {
        const summary = await generateTasteSummary();
        console.log("=== BEGIN SUMMARY ===");
        console.log(summary);
        console.log("=== END SUMMARY ===");
    } catch(e) {
        console.error("Error:", e);
    }
}
test();
