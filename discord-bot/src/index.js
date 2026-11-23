require('dotenv').config(); // Load env from current directory
const { Client, GatewayIntentBits, Events, ActivityType } = require('discord.js');
const messageCreate = require('./events/messageCreate');

// Validate Environment Variables
if (!process.env.DISCORD_TOKEN) {
    console.error('❌ DISCORD_TOKEN is missing! Please add it to your .env file.');
    process.exit(1);
}

// Create Discord Client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages
    ]
});

// Register Event Handlers
client.once(Events.ClientReady, () => {
    console.log(`✅ Logged in as ${client.user.tag}`);
    client.user.setActivity('for @mentions & replies', { type: ActivityType.Listening });
    console.log('🚀 Discord Copilot is ready!');
});

client.on(messageCreate.name, (...args) => messageCreate.execute(...args));

// Graceful Shutdown to prevent zombie processes and duplicate responses
const handleShutdown = (signal) => {
    console.log(`\n🛑 Received ${signal}. Shutting down Discord Copilot gracefully...`);
    client.destroy();
    process.exit(0);
};

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));

// Prevent uncaught errors from crashing the bot silently
process.on('unhandledRejection', (reason, promise) => {
    console.error('⚠️ Unhandled Rejection at:', promise, 'reason:', reason);
});

// Login
client.login(process.env.DISCORD_TOKEN);
