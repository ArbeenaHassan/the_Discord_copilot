require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');

async function testCandidateModels() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        console.error('❌ GEMINI_API_KEY not found in .env');
        process.exit(1);
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const candidateModels = ['gemini-2.5-flash', 'gemini-1.5-flash'];

    console.log('🔍 Testing Gemini models with your API key...\n');

    for (const modelName of candidateModels) {
        try {
            process.stdout.write(`Testing ${modelName}... `);
            const model = genAI.getGenerativeModel({ model: modelName });
            const result = await model.generateContent('Say "Ready" in one word.');
            const text = result.response.text().trim();
            console.log(`✅ Success: "${text}"`);
        } catch (error) {
            console.log(`❌ Failed: ${error.message}`);
        }
    }
}

testCandidateModels();
