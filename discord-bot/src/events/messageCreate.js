const { Events } = require('discord.js');
const { generateResponse, generateEmbedding, generateSummary } = require('../services/ai');
const { searchKnowledge, getSystemInstructions, getAllowedChannels, getConversationMemory, updateConversationMemory } = require('../services/supabase');

/**
 * Splits text into Discord-safe chunks (<2000 chars) preserving natural boundaries.
 */
function splitMessage(text, maxLength = 1900) {
    if (text.length <= maxLength) {
        return [text];
    }

    const chunks = [];
    let remaining = text;

    while (remaining.length > 0) {
        if (remaining.length <= maxLength) {
            chunks.push(remaining);
            break;
        }

        const candidate = remaining.slice(0, maxLength);
        const paragraphBreak = candidate.lastIndexOf('\n\n');
        const newlineBreak = candidate.lastIndexOf('\n');
        const sentenceBreak = candidate.lastIndexOf('. ');
        const spaceBreak = candidate.lastIndexOf(' ');

        let splitIndex = maxLength;
        if (paragraphBreak > maxLength * 0.5) {
            splitIndex = paragraphBreak + 2;
        } else if (newlineBreak > maxLength * 0.5) {
            splitIndex = newlineBreak + 1;
        } else if (sentenceBreak > maxLength * 0.5) {
            splitIndex = sentenceBreak + 2;
        } else if (spaceBreak > maxLength * 0.4) {
            splitIndex = spaceBreak + 1;
        }

        chunks.push(remaining.slice(0, splitIndex).trim());
        remaining = remaining.slice(splitIndex).trim();
    }

    return chunks.filter(c => c.length > 0);
}

module.exports = {
    name: Events.MessageCreate,
    async execute(message) {
        // Ignore messages from bots
        if (message.author.bot) {
            return;
        }

        console.log(`\n📩 [Message Received] in #${message.channel.name || 'DM'} (${message.channel.id})`);
        console.log(`   From: ${message.author.tag}`);
        console.log(`   Content: "${message.content}"`);

        // Check if channel is allowed
        const allowedChannels = await getAllowedChannels();
        const isAllowedChannel = allowedChannels.includes(message.channel.id);

        // 1. Check direct user mention (@Bot)
        const isUserMentioned = message.mentions.users.has(message.client.user.id);

        // 2. Check role mention (@Role assigned to bot)
        const botMember = message.guild?.members.me;
        const isRoleMentioned = message.mentions.roles.some(role => botMember?.roles.cache.has(role.id));

        // 3. Check if user is replying to a previous message from the bot
        let isReplyingToBot = false;
        if (message.reference?.messageId) {
            try {
                const referencedMessage = await message.channel.messages.fetch(message.reference.messageId);
                if (referencedMessage?.author?.id === message.client.user.id) {
                    isReplyingToBot = true;
                }
            } catch (err) {
                // Referenced message might be deleted or inaccessible
            }
        }

        const isDirectlyAddressed = isUserMentioned || isRoleMentioned || isReplyingToBot;
        console.log(`   Allowed Channel: ${isAllowedChannel} | Mentioned: ${isUserMentioned} | Role Mentioned: ${isRoleMentioned} | Replying: ${isReplyingToBot}`);

        // Logic:
        // 1. In allowed channel -> Respond to all messages
        // 2. In unlisted channel -> Respond ONLY if mentioned (user or role) or replying to bot
        if (!isAllowedChannel && !isDirectlyAddressed) {
            console.log('   ⏭️ Ignored: Channel is not allow-listed and bot was not addressed.');
            return;
        }

        // Clean query: strip user (<@...>, <@!...>) and role (<@&...>) mention tags
        let userQuery = message.content.replace(/<@[!&]?[0-9]+>/g, '').trim();

        // Built-in status / ping utility
        if (/^(ping|status)$/i.test(userQuery)) {
            const uptimeMinutes = Math.floor(process.uptime() / 60);
            const pingMs = Math.round(message.client.ws.ping);
            const statusMsg = `🏓 **Pong!**\n- **Uptime:** ${uptimeMinutes} minute(s)\n- **Discord Latency:** ${pingMs}ms\n- **Current Channel:** ${isAllowedChannel ? '✅ Allow-listed' : '🔒 Mention/Reply Only'}`;
            await message.reply(statusMsg);
            return;
        }

        if (!userQuery) {
            userQuery = 'Hello!';
        }

        // Start typing indicator and keep it alive while AI responds
        await message.channel.sendTyping().catch(() => {});
        const typingInterval = setInterval(() => {
            message.channel.sendTyping().catch(() => {});
        }, 8000);

        try {
            // 1. Generate embedding for the query
            const embedding = await generateEmbedding(userQuery);

            // 2. Search for relevant context from knowledge base
            let context = '';
            if (embedding) {
                const relevantDocs = await searchKnowledge(embedding);
                if (relevantDocs && relevantDocs.length > 0) {
                    context = "RELEVANT KNOWLEDGE BASE INFO:\n" +
                        relevantDocs.map(doc => `- ${doc.content}`).join('\n') +
                        "\n\n";
                }
            }

            // 3. Get system instructions and conversation memory
            const systemInstructions = await getSystemInstructions();
            const memory = await getConversationMemory(message.channel.id);
            const memorySummary = memory?.summary || 'No previous context available.';

            console.log('   - System Instructions Fetched:', systemInstructions ? 'Yes' : 'No');
            console.log('   - Memory Fetched:', memory ? `Yes (${memory.message_count} msgs)` : 'No');

            // 4. Combine instructions + memory + context
            const fullContext = `SYSTEM INSTRUCTIONS: ${systemInstructions}\n\nCONVERSATION SUMMARY: ${memorySummary}\n\n${context}`;

            // 5. Generate AI response
            let response;
            try {
                response = await generateResponse(fullContext, userQuery);
            } catch (aiError) {
                console.error('❌ AI Response Generation Failed:', aiError.message);
                await message.reply('I am having trouble processing that right now. Please try again in a moment.');
                return;
            }

            // 6. Send response using clean smart chunking
            const chunks = splitMessage(response, 1900);
            for (const chunk of chunks) {
                await message.reply(chunk).catch(console.error);
            }

            // 7. Update Conversation Memory
            try {
                const newMessageCount = (memory?.message_count || 0) + 1;
                let finalSummary = memorySummary;

                // Update summary every 5 messages or if it's the first message
                if (newMessageCount % 5 === 0 || !memory) {
                    console.log('   - Updating conversation summary...');
                    const recentHistory = `User: ${userQuery}\nBot: ${response}`;
                    const combinedContext = memory ? `Previous Summary: ${memory.summary}\nRecent Interaction: ${recentHistory}` : recentHistory;

                    try {
                        const newSummary = await generateSummary(combinedContext);
                        if (newSummary) finalSummary = newSummary;
                    } catch (sumError) {
                        console.error('   ⚠️ Summary generation failed (using old summary):', sumError.message);
                    }
                }

                await updateConversationMemory(message.channel.id, finalSummary, newMessageCount);
                console.log('   ✅ Memory Synced to Supabase');
            } catch (memError) {
                console.error('   ❌ Failed to sync memory to Supabase:', memError.message);
            }

        } catch (error) {
            console.error('Error processing message:', error);
            await message.reply('Sorry, I encountered an error while processing your request.');
        } finally {
            clearInterval(typingInterval);
        }
    },
};
