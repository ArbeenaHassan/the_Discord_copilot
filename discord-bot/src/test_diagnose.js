require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { createClient } = require('@supabase/supabase-js');
const { Client, GatewayIntentBits } = require('discord.js');

async function testServices() {
    console.log('--- Starting Diagnosis ---');

    // 1. Check Env Vars
    const steps = [
        { name: 'DISCORD_TOKEN', val: process.env.DISCORD_TOKEN },
        { name: 'GEMINI_API_KEY', val: process.env.GEMINI_API_KEY },
        { name: 'SUPABASE_URL', val: process.env.SUPABASE_URL },
        { name: 'SUPABASE_ANON_KEY', val: process.env.SUPABASE_ANON_KEY },
    ];

    let allVarsPresent = true;
    for (const s of steps) {
        if (!s.val) {
            console.error(`❌ Missing ${s.name}`);
            allVarsPresent = false;
        } else {
            console.log(`✅ ${s.name} is present`);
        }
    }

    if (!allVarsPresent) {
        console.error('Stopping diagnosis due to missing env vars.');
        return;
    }

    // 2. Test Discord Token
    console.log('\n--- Testing Discord Token ---');
    try {
        const discordClient = new Client({
            intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
        });
        await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('Discord connection timed out')), 8000);
            discordClient.once('ready', () => {
                clearTimeout(timer);
                console.log(`✅ Discord Connection Successful! Logged in as: ${discordClient.user.tag}`);
                discordClient.destroy();
                resolve();
            });
            discordClient.login(process.env.DISCORD_TOKEN).catch(err => {
                clearTimeout(timer);
                reject(err);
            });
        });
    } catch (e) {
        console.error('❌ Discord Login Failed:', e.message);
    }

    // 3. Test Gemini API
    console.log('\n--- Testing Gemini API ---');
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    try {
        const model = genAI.getGenerativeModel({ model: 'gemini-3.5-flash' });
        const result = await model.generateContent('Hello, are you working?');
        console.log('✅ Gemini API (gemini-3.5-flash) Connection Successful');
        console.log('Response:', result.response.text().trim());
    } catch (e) {
        console.error('❌ Gemini API (gemini-3.5-flash) Failed:', e.message);
    }

    // 4. Test Supabase
    console.log('\n--- Testing Supabase ---');
    try {
        const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
        const { data, error } = await supabase.from('admin_config').select('*').limit(1);

        if (error) {
            console.error('❌ Supabase Query Failed:');
            console.error('   Code:', error.code);
            console.error('   Message:', error.message);
            if (error.hint) console.error('   Hint:', error.hint);
        } else {
            console.log('✅ Supabase Connection Successful! Tables accessible.');
        }
    } catch (e) {
        console.error('❌ Supabase Test Exception:', e.message);
    }
}

testServices();
