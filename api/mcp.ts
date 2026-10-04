import { handleMcp } from './_lib/mcp.js';
import {
  authorizationServer,
  authorize,
  isOwner,
  ownerKeyIsSet,
  protectedResource,
  registerClient,
  resourceMetadataUrl,
  token,
} from './_lib/owner-auth.js';

/**
 * The site's MCP server (_lib/mcp.ts) and the OAuth endpoints Claude and
 * ChatGPT connect through (_lib/owner-auth.ts). vercel.json rewrites
 * /api/oauth/:step and the .well-known metadata paths here as `op`s.
 */

async function handle(request: Request): Promise<Response> {
  switch (new URL(request.url).searchParams.get('op')) {
    case 'oauth-resource':
      return protectedResource(request);
    case 'oauth-server':
      return authorizationServer(request);
    case 'oauth-register':
      return registerClient(request);
    case 'oauth-authorize':
      return authorize(request);
    case 'oauth-token':
      return token(request);
  }

  if (!ownerKeyIsSet()) {
    return Response.json(
      { error: 'PERSONAL_SITE_OWNER_KEY is not set' },
      { status: 503 },
    );
  }
  if (!isOwner(request)) {
    return Response.json(
      { error: 'Sign in first' },
      {
        status: 401,
        headers: {
          'WWW-Authenticate': `Bearer resource_metadata="${resourceMetadataUrl(request)}"`,
        },
      },
    );
  }
  return handleMcp(request);
}

export default {
  async fetch(request: Request): Promise<Response> {
    try {
      return await handle(request);
    } catch (error) {
      console.error('MCP request failed:', error);
      return Response.json({ error: 'Something went wrong' }, { status: 500 });
    }
  },
};
