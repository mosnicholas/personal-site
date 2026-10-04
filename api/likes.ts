import { handleLikesRequest } from './_lib/likes-http.js';
import { handleLikesMcpRequest } from './_lib/likes-mcp.js';
import { handleLikesOAuthRequest } from './_lib/likes-oauth.js';

const OAUTH_OPERATIONS = new Set([
  'oauth-resource',
  'oauth-server',
  'oauth-register',
  'oauth-authorize',
  'oauth-token',
]);

/** The one deployed Likes endpoint; rewrites route OAuth discovery to query operations. */
export default {
  async fetch(request: Request): Promise<Response> {
    const operation = new URL(request.url).searchParams.get('op') ?? '';
    if (operation === 'mcp') return handleLikesMcpRequest(request);
    if (OAUTH_OPERATIONS.has(operation))
      return handleLikesOAuthRequest(request, operation);
    return handleLikesRequest(request);
  },
};
