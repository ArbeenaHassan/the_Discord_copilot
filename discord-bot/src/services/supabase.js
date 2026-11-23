const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Supabase URL or Key is missing!');
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Cache variables to reduce database overhead
let cachedAllowedChannels = null;
let lastAllowedChannelsFetch = 0;
const CHANNELS_CACHE_TTL_MS = 30 * 1000; // 30 seconds

let cachedSystemInstructions = null;
let lastSystemInstructionsFetch = 0;
const INSTRUCTIONS_CACHE_TTL_MS = 60 * 1000; // 60 seconds

function invalidateCache() {
    cachedAllowedChannels = null;
    lastAllowedChannelsFetch = 0;
    cachedSystemInstructions = null;
    lastSystemInstructionsFetch = 0;
}

// Search for relevant content using vector similarity
async function searchKnowledge(queryEmbedding) {
    try {
        const { data, error } = await supabase.rpc('search_knowledge', {
            query_embedding: queryEmbedding,
            match_threshold: 0.6,
            match_count: 5
        });

        if (error) {
            console.error('Error searching knowledge:', error);
            return [];
        }

        return data;
    } catch (error) {
        console.error('Unexpected error in searchKnowledge:', error);
        return [];
    }
}

// Get system instructions from admin config (with in-memory TTL cache)
async function getSystemInstructions(forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && cachedSystemInstructions && (now - lastSystemInstructionsFetch < INSTRUCTIONS_CACHE_TTL_MS)) {
        return cachedSystemInstructions;
    }

    try {
        const { data, error } = await supabase
            .from('admin_config')
            .select('system_instructions')
            .limit(1)
            .single();

        if (error) {
            console.error('Error fetching system instructions:', error);
            return cachedSystemInstructions || 'You are a helpful assistant.';
        }

        cachedSystemInstructions = data?.system_instructions || 'You are a helpful assistant.';
        lastSystemInstructionsFetch = now;
        return cachedSystemInstructions;
    } catch (error) {
        return cachedSystemInstructions || 'You are a helpful assistant.';
    }
}

// Get allowed channels (with in-memory TTL cache)
async function getAllowedChannels(forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && cachedAllowedChannels && (now - lastAllowedChannelsFetch < CHANNELS_CACHE_TTL_MS)) {
        return cachedAllowedChannels;
    }

    try {
        const { data, error } = await supabase
            .from('allowed_channels')
            .select('channel_id');

        if (error) {
            console.error('Error fetching allowed channels:', error);
            return cachedAllowedChannels || [];
        }

        cachedAllowedChannels = data.map(ch => ch.channel_id);
        lastAllowedChannelsFetch = now;
        return cachedAllowedChannels;
    } catch (error) {
        console.error('Unexpected error in getAllowedChannels:', error);
        return cachedAllowedChannels || [];
    }
}

// Get conversation memory for a channel
async function getConversationMemory(channelId) {
    try {
        const { data, error } = await supabase
            .from('conversation_memory')
            .select('*')
            .eq('channel_id', channelId)
            .single();

        if (error && error.code !== 'PGRST116') { // PGRST116 is "no rows found"
            console.error('Error fetching conversation memory:', error);
            return null;
        }

        return data;
    } catch (error) {
        console.error('Unexpected error in getConversationMemory:', error);
        return null;
    }
}

// Update or create conversation memory
async function updateConversationMemory(channelId, summary, messageCount) {
    try {
        const { error } = await supabase
            .from('conversation_memory')
            .upsert({
                channel_id: channelId,
                summary: summary,
                message_count: messageCount,
                last_updated: new Date().toISOString()
            }, {
                onConflict: 'channel_id'
            });

        if (error) {
            console.error('Error updating conversation memory:', error);
            return false;
        }

        return true;
    } catch (error) {
        console.error('Unexpected error in updateConversationMemory:', error);
        return false;
    }
}

module.exports = {
    supabase,
    searchKnowledge,
    getSystemInstructions,
    getAllowedChannels,
    getConversationMemory,
    updateConversationMemory,
    invalidateCache
};
