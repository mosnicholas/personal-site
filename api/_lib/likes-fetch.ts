import { lookup as dnsLookup } from 'node:dns/promises';
import net from 'node:net';

import { Agent, request } from 'undici';

const MAX_REDIRECTS = 3;
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 8_000;

export class SafeFetchError extends Error {
  constructor(
    message:
      | 'The URL is not safe to fetch'
      | 'The remote page could not be fetched'
      | 'The remote page is too large',
  ) {
    super(message);
    this.name = 'SafeFetchError';
  }
}

export interface FetchedRemote {
  url: string;
  contentType: string;
  body: Uint8Array;
}

export interface FetchRemoteOptions {
  maxBytes?: number;
  accept?: (contentType: string) => boolean;
  signal?: AbortSignal;
}

const isPrivateIpv4 = (address: string) => {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part)))
    return true;
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 2) ||
    (a === 198 && (b === 18 || b === 19 || b === 51)) ||
    (a === 203 && b === 0)
  );
};

const isPrivateIpv6 = (address: string) => {
  const normalized = address.toLowerCase();
  // Only global unicast 2000::/3. This also rejects all IPv4-mapped forms,
  // NAT64, multicast, and expanded loopback representations.
  const first = Number.parseInt(normalized.split(':')[0] ?? '', 16);
  if (!(first >= 0x2000 && first < 0x4000)) return true;
  if (
    /^2001:(?:db8|0|10|20):/i.test(normalized) ||
    normalized.startsWith('2001::') ||
    normalized.startsWith('2002:')
  )
    return true;
  const mappedIpv4 = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  return (
    normalized === '::' ||
    normalized === '::1' ||
    (mappedIpv4 !== undefined && isPrivateIpv4(mappedIpv4)) ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe8') ||
    normalized.startsWith('fe9') ||
    normalized.startsWith('fea') ||
    normalized.startsWith('feb')
  );
};

export function isPublicIp(address: string): boolean {
  const family = net.isIP(address);
  if (family === 4) return !isPrivateIpv4(address);
  if (family === 6) return !isPrivateIpv6(address);
  return false;
}

function parseSafeUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new SafeFetchError('The URL is not safe to fetch');
  }
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.username ||
    url.password ||
    (url.port && url.port !== '80' && url.port !== '443')
  ) {
    throw new SafeFetchError('The URL is not safe to fetch');
  }
  return url;
}

async function pinnedAgent(url: URL, signal: AbortSignal): Promise<Agent> {
  signal.throwIfAborted();
  const answers = await new Promise<{ address: string; family: number }[]>(
    (resolve, reject) => {
      const aborted = () => reject(signal.reason);
      signal.addEventListener('abort', aborted, { once: true });
      dnsLookup(url.hostname, { all: true, verbatim: true }).then(
        (value) => {
          signal.removeEventListener('abort', aborted);
          resolve(value);
        },
        (error) => {
          signal.removeEventListener('abort', aborted);
          reject(error);
        },
      );
    },
  ).catch(() => {
    throw new SafeFetchError('The remote page could not be fetched');
  });
  signal.throwIfAborted();
  const valid = answers.filter((answer) => isPublicIp(answer.address));
  if (valid.length === 0 || valid.length !== answers.length) {
    throw new SafeFetchError('The URL is not safe to fetch');
  }
  let next = 0;
  return new Agent({
    connect: {
      lookup(_hostname, options, callback) {
        const address = valid[next++ % valid.length]!;
        if (options.all) {
          callback(
            null,
            valid.map(({ address: host, family }) => ({
              address: host,
              family,
            })),
          );
          return;
        }
        callback(null, address.address, address.family);
      },
    },
  });
}

async function readBoundedBody(
  body: AsyncIterable<Uint8Array>,
  maxBytes: number,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of body) {
    size += chunk.byteLength;
    if (size > maxBytes)
      throw new SafeFetchError('The remote page is too large');
    chunks.push(chunk);
  }
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

/**
 * Fetch a public web resource while pinning the DNS result used for each hop.
 * Every redirect is parsed and resolved again, so an otherwise public URL cannot
 * bounce this worker into a private address space.
 */
export async function fetchPublicUrl(
  input: string,
  { maxBytes = DEFAULT_MAX_BYTES, accept, signal }: FetchRemoteOptions = {},
): Promise<FetchedRemote> {
  let url = parseSafeUrl(input);
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    const hopSignal = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(FETCH_TIMEOUT_MS)])
      : AbortSignal.timeout(FETCH_TIMEOUT_MS);
    const agent = await pinnedAgent(url, hopSignal);
    try {
      const response = await request(url, {
        dispatcher: agent,
        headersTimeout: FETCH_TIMEOUT_MS,
        bodyTimeout: FETCH_TIMEOUT_MS,
        signal: hopSignal,
        headers: {
          accept:
            'text/html,application/xhtml+xml,image/*,text/css;q=0.9,*/*;q=0.1',
        },
      });
      if (response.statusCode >= 300 && response.statusCode < 400) {
        const location = response.headers.location;
        if (typeof location !== 'string' || redirects === MAX_REDIRECTS) {
          throw new SafeFetchError('The remote page could not be fetched');
        }
        url = parseSafeUrl(new URL(location, url).toString());
        continue;
      }
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw new SafeFetchError('The remote page could not be fetched');
      }
      const contentType = String(response.headers['content-type'] ?? '')
        .split(';', 1)[0]!
        .trim()
        .toLowerCase();
      if (!contentType || (accept && !accept(contentType))) {
        throw new SafeFetchError('The remote page could not be fetched');
      }
      const contentLength = Number(response.headers['content-length']);
      if (Number.isFinite(contentLength) && contentLength > maxBytes) {
        throw new SafeFetchError('The remote page is too large');
      }
      return {
        url: url.toString(),
        contentType,
        body: await readBoundedBody(response.body, maxBytes),
      };
    } catch (error) {
      if (error instanceof SafeFetchError) throw error;
      throw new SafeFetchError('The remote page could not be fetched');
    } finally {
      await agent.destroy().catch(() => undefined);
    }
  }
  throw new SafeFetchError('The remote page could not be fetched');
}

export const isHtml = (contentType: string) =>
  contentType === 'text/html' || contentType === 'application/xhtml+xml';

export const isImage = (contentType: string) =>
  contentType.startsWith('image/');
