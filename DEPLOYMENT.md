# NAR Bot - Deployment Guide

This guide will help you deploy your NAR Slack bot to Render.com and configure it properly.

## Prerequisites

- GitHub account
- Render.com account (free tier works)
- Slack workspace with admin access
- Monday.com account with API access

---

## Part 1: Push Code to GitHub

### Step 1: Initialize Git Repository

```bash
cd c:\Users\ym221\NAR
git init
git add .
git commit -m "Initial commit"
```

### Step 2: Create GitHub Repository

1. Go to https://github.com/new
2. Create a new repository (name it `nar-bot` or similar)
3. **DO NOT** initialize with README, .gitignore, or license (you already have these)

### Step 3: Push to GitHub

Replace `YOUR_USERNAME` with your GitHub username:

```bash
git remote add origin https://github.com/YOUR_USERNAME/nar-bot.git
git branch -M main
git push -u origin main
```

---

## Part 2: Deploy to Render

### Step 1: Create New Web Service

1. Go to https://render.com/dashboard
2. Click **"New +"** → **"Web Service"**
3. Connect your GitHub account (if not already connected)
4. Select your `nar-bot` repository
5. Click **"Connect"**

### Step 2: Configure Web Service

Fill in the following settings:

| Setting | Value |
|---------|-------|
| **Name** | `nar-bot` (or your preferred name) |
| **Region** | Choose closest to you |
| **Branch** | `main` |
| **Root Directory** | Leave empty |
| **Runtime** | `Node` |
| **Build Command** | `npm install` |
| **Start Command** | `npm start` |
| **Instance Type** | `Free` |

### Step 3: Add Environment Variables

Click on **"Advanced"** and add the following environment variables:

| Key | Value | Notes |
|-----|-------|-------|
| `SLACK_BOT_TOKEN` | `xoxb-your-token` | Get from Slack API |
| `SLACK_SIGNING_SECRET` | `your-signing-secret` | Get from Slack API |
| `NAR_CHANNEL_ID` | `C09HD216ALV` | Your Slack channel ID |
| `MONDAY_API_TOKEN` | `your-monday-token` | Get from Monday.com |
| `MONDAY_BOARD_ID` | `7824591632` | Your Monday board ID |
| `MONDAY_WEBHOOK_SECRET` | `nar-monday-secret-123` | Custom secret |

**Note:** Do NOT add `PORT` or `RENDER_EXTERNAL_URL` - Render sets these automatically!

### Step 4: Deploy

1. Click **"Create Web Service"**
2. Wait for deployment to complete (2-5 minutes)
3. Once deployed, you'll see a green "Live" status
4. Copy your service URL (e.g., `https://nar-bot-abc123.onrender.com`)

---

## Part 3: Configure Slack

### Step 1: Update Event Subscriptions

1. Go to https://api.slack.com/apps
2. Select your NAR bot app
3. Click **"Event Subscriptions"** in left sidebar
4. Enable Events: **ON**
5. Set **Request URL** to: `https://nar-bot-abc123.onrender.com/slack/events`
   - Replace `nar-bot-abc123` with your actual Render URL
   - Wait for green checkmark "Verified ✓"
6. Under **"Subscribe to bot events"**, add:
   - `message.channels`
   - `message.groups` (if using private channels)
7. Click **"Save Changes"**
8. If prompted, click **"Reinstall App"**

### Step 2: Verify Bot Permissions

Go to **"OAuth & Permissions"** and ensure these scopes are enabled:

- `chat:write`
- `channels:history`
- `channels:read`
- `app_mentions:read` (optional)

### Step 3: Invite Bot to Channel

In your Slack NAR channel, type:
```
/invite @NAR
```
(Replace `@NAR` with your bot's actual name)

---

## Part 4: Verify Deployment

### Step 1: Check Render Logs

1. In Render dashboard, click on your service
2. Click **"Logs"** tab
3. You should see:
   ```
   ✅ Configuration validated
   ✅ NAR Bot started on port 10000
   🌐 Public URL: https://nar-bot-abc123.onrender.com
   ✅ Item Creation webhook created
   ✅ Updates/Comments webhook created
   ```

### Step 2: Test Slack Integration

1. Go to your Slack NAR channel
2. Type: `ping`
3. Bot should respond: "✅ NAR bot is alive and healthy!"

### Step 3: Test Monday Integration

1. Go to your Monday.com board
2. Create a new item
3. Check your Slack channel - you should see a message about the new item
4. Add a comment to the item in Monday
5. Check the Slack thread - you should see the comment

---

## Troubleshooting

### Bot Not Responding in Slack

1. Check Render logs for errors
2. Verify Slack Event Subscriptions URL is correct
3. Ensure bot is invited to the channel
4. Check that environment variables are set correctly

### Monday Webhooks Not Working

1. Check Render logs - should show webhook creation
2. Verify `MONDAY_API_TOKEN` has write permissions
3. Check Monday.com board integrations for active webhooks
4. Ensure `MONDAY_BOARD_ID` is correct

### Render Service Not Starting

1. Check build logs for errors
2. Verify `package.json` has `"start": "node index.js"`
3. Ensure all required environment variables are set
4. Check that `PORT` is NOT set (Render sets it automatically)

---

## Updating Your Bot

When you make code changes:

```bash
git add .
git commit -m "Update bot functionality"
git push
```

Render will automatically detect the push and redeploy your bot!

---

## Important Notes

### Free Tier Limitations

- Render free tier services **spin down after 15 minutes of inactivity**
- First request after spin-down may take 30-60 seconds
- Consider upgrading to paid tier for production use

### Environment Variables

- Never commit `.env` file to GitHub
- `.gitignore` is already configured to exclude it
- Always use Render's Environment Variables section for secrets

### Monday Webhooks

- Webhooks are automatically created/updated on bot startup
- If you change your Render URL, webhooks will auto-update on restart
- Old duplicate webhooks are automatically cleaned up

---

## Need Help?

Check the logs:
- **Render Logs**: https://dashboard.render.com → Your Service → Logs
- **Slack API**: https://api.slack.com/apps → Your App → Event Subscriptions
- **Monday Webhooks**: https://monday.com → Your Board → Integrations

For code issues, check [index.js](index.js) for detailed comments.
