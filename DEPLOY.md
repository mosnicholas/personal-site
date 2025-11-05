# Deployment Guide

This site can be deployed to Vercel with the terminal chat feature fully working via serverless functions.

## Deploying to Vercel

### 1. Push to GitHub
```bash
git push origin main
```

### 2. Import to Vercel
1. Go to [vercel.com](https://vercel.com)
2. Click "Add New Project"
3. Import your `personal-site` repository
4. Vercel will auto-detect it's a Create React App

### 3. Set Environment Variables
In Vercel project settings, add:
- **Key**: `ANTHROPIC_API_KEY`
- **Value**: Your Anthropic API key from https://console.anthropic.com/

Set this for all environments (Production, Preview, Development).

### 4. Deploy
Click "Deploy" - Vercel will:
- Build the React app
- Deploy the serverless function at `/api/chat`
- Configure everything automatically

### 5. Test Terminal Mode
Visit: `https://your-site.vercel.app?mode=terminal`

The chat should work immediately!

## How It Works

- **Frontend**: React app served as static files
- **Backend**: `/api/chat.ts` runs as a Vercel Serverless Function
- **API Key**: Stored securely in Vercel environment variables
- **Requests**: Frontend calls `/api/chat` → Vercel routes to serverless function

## Local Development

### Use Vercel Dev Server
```bash
# Install Vercel CLI globally (if you haven't already)
npm i -g vercel

# Run local dev server with serverless functions
vercel dev
```

This runs the React app AND the serverless function locally, exactly like production.

**Environment Variables for Local Dev:**
- Create a `.env` file in the root directory
- Add: `ANTHROPIC_API_KEY=your_key_here`
- Vercel Dev will automatically load it

Visit: `http://localhost:3000?mode=terminal`

## Architecture

```
personal-site/
├── api/
│   └── chat.ts              # Vercel Serverless Function (TypeScript)
├── src/                     # React app
├── vercel.json              # Vercel configuration
└── package.json             # Dependencies
```

## Environment Variables

### For Vercel (Production)
Set in Vercel dashboard:
- `ANTHROPIC_API_KEY`

### For Local Development (Vercel Dev)
Create `.env` in project root:
```
ANTHROPIC_API_KEY=your_key_here
```

## Troubleshooting

### Chat shows "ERROR: Backend not running"
- **On Vercel**: Check environment variables are set in Vercel dashboard
- **Locally**: Make sure you're running `vercel dev`, not `yarn start`
- **Locally**: Verify `.env` file exists in root with `ANTHROPIC_API_KEY`

### API Key errors
- Verify the key is set in Vercel environment variables
- For local dev, check `.env` file in project root
- Redeploy after adding/changing environment variables

### Serverless function not found
- Check `api/chat.ts` exists
- Verify `vercel.json` is present
- Redeploy the project

## Cost Considerations

- **Vercel**: Free tier includes serverless functions
- **Anthropic**: Claude Haiku is $0.25 per million input tokens, $1.25 per million output tokens
- Each chat message costs ~$0.001 (very affordable!)

## Further Customization

### Change the AI Model
Edit `api/chat.ts`, line:
```typescript
model: 'claude-3-5-haiku-20241022',
```

Available models:
- `claude-3-5-haiku-20241022` (fastest, cheapest)
- `claude-3-5-sonnet-20241022` (balanced)
- `claude-3-opus-20240229` (most powerful)

### Adjust Response Length
Edit `api/chat.ts`, line:
```typescript
max_tokens: 200,
```

### Customize System Prompt
Edit the `SYSTEM_PROMPT` constant in `api/chat.ts`.
