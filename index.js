require('dotenv').config();
const { App, ExpressReceiver, LogLevel } = require('@slack/bolt');
const axios = require('axios');

// ============== CONFIG (USE ENVIRONMENT VARIABLES) ==============
const CONFIG = {
  PORT: process.env.PORT || 3000,
  SLACK_BOT_TOKEN: process.env.SLACK_BOT_TOKEN,
  SLACK_SIGNING_SECRET: process.env.SLACK_SIGNING_SECRET,
  NAR_CHANNEL_ID: process.env.NAR_CHANNEL_ID,
  MONDAY_API_TOKEN: process.env.MONDAY_API_TOKEN,
  MONDAY_BOARD_ID: parseInt(process.env.MONDAY_BOARD_ID),
  MONDAY_WEBHOOK_SECRET: process.env.MONDAY_WEBHOOK_SECRET || 'nar-monday-secret-123',
  PUBLIC_URL: process.env.RENDER_EXTERNAL_URL || process.env.PUBLIC_URL || process.env.NGROK_URL,
  ALLOW_ONLY_THIS_CHANNEL: true,
};

// ======= VALIDATION =======
function validateConfig() {
  const required = [
    'SLACK_BOT_TOKEN',
    'SLACK_SIGNING_SECRET',
    'NAR_CHANNEL_ID',
    'MONDAY_API_TOKEN',
    'MONDAY_BOARD_ID'
  ];
  
  const missing = required.filter(key => !CONFIG[key]);
  
  if (missing.length > 0) {
    console.error('❌ Missing required environment variables:', missing.join(', '));
    console.error('💡 Create a .env file with these variables.');
    process.exit(1);
  }
  
  if (!CONFIG.SLACK_BOT_TOKEN.includes('xoxb-')) {
    console.error('❌ Invalid SLACK_BOT_TOKEN format');
    process.exit(1);
  }
  
  console.log('✅ Configuration validated');
}

validateConfig();

// ======= 1) Create ExpressReceiver =======
const receiver = new ExpressReceiver({
  signingSecret: CONFIG.SLACK_SIGNING_SECRET,
  processBeforeResponse: true,
});

// CRITICAL: Add body parser BEFORE defining routes
// This must come before the webhook route or req.body will be undefined
const express = require('express');
receiver.app.use(express.json());
receiver.app.use(express.urlencoded({ extended: true }));

// ======= 2) Create Slack app =======
const app = new App({
  token: CONFIG.SLACK_BOT_TOKEN,
  receiver,
  logLevel: LogLevel.INFO,
});

// ======= IN-MEMORY MAP: Monday item -> Slack thread =======
const itemThreadMap = {};

// ======= SLACK HANDLERS =======

// Health check
app.message(/ping/i, async ({ message, client }) => {
  if (CONFIG.ALLOW_ONLY_THIS_CHANNEL && message.channel !== CONFIG.NAR_CHANNEL_ID) return;
  const thread = message.thread_ts || message.ts;
  await client.chat.postMessage({
    channel: message.channel,
    thread_ts: thread,
    text: '✅ NAR bot is alive and healthy!',
  });
});

// Listen to messages in NAR channel
app.event('message', async ({ event, client, logger }) => {
  try {
    // Ignore bot messages and non-relevant subtypes
    if (event.subtype && event.subtype !== 'thread_broadcast') return;
    if (event.bot_id) return;
    if (CONFIG.ALLOW_ONLY_THIS_CHANNEL && event.channel !== CONFIG.NAR_CHANNEL_ID) return;

    logger.info({
      from: 'slack',
      channel: event.channel,
      ts: event.ts,
      thread_ts: event.thread_ts || null,
      text: event.text?.substring(0, 100), // Log first 100 chars
    });

    const thread = event.thread_ts || event.ts;
    
    // Only respond to new threads, not replies
    if (!event.thread_ts) {
      await client.chat.postMessage({
        channel: event.channel,
        thread_ts: thread,
        text: `👀 Message received: "${event.text?.substring(0, 100)}..."`,
      });
    }

    // TODO: Add Slack -> Monday integration (create update)
  } catch (err) {
    console.error('❌ Slack handler error:', err);
  }
});

// ======= MONDAY GRAPHQL HELPER =======
async function mondayGraphQL(query, variables = {}) {
  try {
    const res = await axios.post(
      'https://api.monday.com/v2',
      { query, variables },
      {
        headers: {
          Authorization: CONFIG.MONDAY_API_TOKEN,
          'Content-Type': 'application/json',
          'API-Version': '2024-10',
        },
      }
    );
    
    if (res.data.errors) {
      console.error('❌ Monday API errors:', JSON.stringify(res.data.errors, null, 2));
    }
    
    return res.data;
  } catch (err) {
    console.error('❌ Monday API request failed:', err?.response?.data || err.message);
    throw err;
  }
}

// ======= GET EXISTING WEBHOOKS =======
async function getExistingWebhooks() {
  const query = `query { webhooks (board_id: ${CONFIG.MONDAY_BOARD_ID}) { id event config } }`;

  try {
    const result = await mondayGraphQL(query);
    return result.data?.webhooks || [];
  } catch (err) {
    console.error('⚠️  Could not fetch existing webhooks (might not have permissions)');
    return [];
  }
}

// ======= DELETE WEBHOOK =======
async function deleteWebhook(webhookId) {
  const query = `
    mutation {
      delete_webhook(id: ${webhookId}) {
        id
      }
    }
  `;
  
  try {
    await mondayGraphQL(query);
    console.log(`🗑️  Deleted webhook ${webhookId}`);
  } catch (err) {
    console.error(`❌ Failed to delete webhook ${webhookId}:`, err);
  }
}

// ======= MONDAY WEBHOOK ENDPOINT =======
receiver.app.post('/monday/webhook', async (req, res) => {
  console.log('📥 Monday webhook hit!');
  console.log('   Query params:', req.query);
  console.log('   Body:', JSON.stringify(req.body, null, 2));

  // Verify webhook secret
  if (req.query.sig !== CONFIG.MONDAY_WEBHOOK_SECRET) {
    console.log('❌ Monday webhook: Invalid signature');
    return res.status(403).send('Forbidden');
  }

  // Handle Monday's challenge verification
  if (req.body?.challenge) {
    console.log('✅ Monday webhook challenge received:', req.body.challenge);
    return res.status(200).json({ challenge: req.body.challenge });
  }

  const event = req.body?.event;
  if (!event) {
    console.error('❌ Missing event in webhook payload');
    return res.status(400).send('No event found');
  }

  try {
    // Handle item creation
    if (event.type === 'create_item' || event.type === 'create_pulse') {
      const itemId = event.pulseId;
      const itemName = event.pulseName || event.pulse_name || req.body.pulseName || 'New NAR item';

      // Check if we already processed this item (prevent duplicates)
      if (itemThreadMap[itemId]) {
        console.log(`⚠️  Item ${itemId} already processed, skipping duplicate`);
        return res.status(200).send('ok');
      }

      console.log(`🆕 Monday item created: ${itemId} - ${itemName}`);

      const slackRes = await app.client.chat.postMessage({
        channel: CONFIG.NAR_CHANNEL_ID,
        text: `🟢 *New NAR Created in Monday*\n• *Name:* ${itemName}\n• *Item ID:* ${itemId}\n• <https://new-age1.monday.com/boards/${CONFIG.MONDAY_BOARD_ID}/pulses/${itemId}|Open in Monday>`,
      });

      // Map item to Slack thread
      itemThreadMap[itemId] = slackRes.ts;
      console.log(`🔗 Mapped item ${itemId} -> thread ${slackRes.ts}`);
    }

    // Handle updates/comments
    if (event.type === 'create_update') {
      const itemId = event.pulseId;
      const updateBody = event.textBody || event.body || '(no text)';
      console.log(`💬 Monday update on item ${itemId}: ${updateBody}`);

      const threadTs = itemThreadMap[itemId];
      if (!threadTs) {
        console.log('⚠️  No Slack thread found for item', itemId);
      } else {
        await app.client.chat.postMessage({
          channel: CONFIG.NAR_CHANNEL_ID,
          thread_ts: threadTs,
          text: `📝 *Update from Monday:*\n${updateBody}`,
        });
      }
    }

    return res.status(200).send('ok');
  } catch (err) {
    console.error('❌ Error processing Monday webhook:', err?.data || err.message);
    return res.status(500).send('Internal error');
  }
});

// ======= CREATE MONDAY WEBHOOKS =======
async function ensureMondayWebhooks(publicBaseUrl) {
  if (!publicBaseUrl) {
    console.error('❌ No public URL provided. Set PUBLIC_URL or RENDER_EXTERNAL_URL environment variable.');
    return;
  }

  const webhookUrl = `${publicBaseUrl}/monday/webhook?sig=${CONFIG.MONDAY_WEBHOOK_SECRET}`;
  console.log('📨 Setting up Monday webhooks...');
  console.log('🔗 Webhook URL:', webhookUrl);

  // Check for existing webhooks
  const existing = await getExistingWebhooks();
  console.log(`📋 Found ${existing.length} existing webhooks`);

  // Delete ALL existing webhooks for this board (clean slate)
  if (existing.length > 0) {
    console.log(`🧹 Deleting ALL ${existing.length} existing webhooks for clean setup...`);
    let deletedCount = 0;

    for (const webhook of existing) {
      try {
        await deleteWebhook(webhook.id);
        deletedCount++;
        console.log(`🗑️  Deleted webhook ID ${webhook.id}: ${webhook.event}`);
      } catch (err) {
        console.error(`⚠️  Could not delete webhook ${webhook.id}`);
      }
    }
    console.log(`✅ Deleted ${deletedCount} webhooks`);
  }

  // Create fresh webhooks
  const events = [
    { name: 'create_item', description: 'Item Creation' },
    { name: 'create_update', description: 'Updates/Comments' }
  ];

  console.log('🔧 Creating new webhooks...');
  for (const event of events) {
    const escapedUrl = webhookUrl.replace(/"/g, '\\"');
    const query = `mutation { create_webhook (board_id: ${CONFIG.MONDAY_BOARD_ID}, url: "${escapedUrl}", event: ${event.name}) { id board_id event } }`;

    try {
      const result = await mondayGraphQL(query);

      if (result.data?.create_webhook) {
        console.log(`✅ ${event.description} webhook created:`, result.data.create_webhook.id);
      } else {
        console.error(`❌ Failed to create ${event.description} webhook`);
      }
    } catch (err) {
      console.error(`❌ Error creating ${event.description} webhook:`, err.message);
    }
  }
}

// ======= START APP =======
(async () => {
  try {
    await app.start(CONFIG.PORT);
    console.log('\n🚀 ========================================');
    console.log(`✅ NAR Bot started on port ${CONFIG.PORT}`);
    console.log('🚀 ========================================\n');

    if (CONFIG.PUBLIC_URL) {
      console.log('🌐 Public URL:', CONFIG.PUBLIC_URL);
      console.log('🔗 Endpoints:');
      console.log(`   Slack Events: ${CONFIG.PUBLIC_URL}/slack/events`);
      console.log(`   Monday Webhook: ${CONFIG.PUBLIC_URL}/monday/webhook?sig=${CONFIG.MONDAY_WEBHOOK_SECRET}\n`);

      await ensureMondayWebhooks(CONFIG.PUBLIC_URL);
    } else {
      console.log('⚠️  No PUBLIC_URL set - webhooks not configured');
      console.log('💡 For local development: Set PUBLIC_URL or NGROK_URL in .env');
      console.log('💡 For Render: RENDER_EXTERNAL_URL is set automatically\n');
    }
  } catch (err) {
    console.error('❌ Failed to start app:', err);
    process.exit(1);
  }
})();