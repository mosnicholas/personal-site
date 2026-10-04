export class RequestSizeError extends Error {}

/** Bound bytes before decoding JSON/forms or allocating a parsed upload. */
export async function readBoundedBytes(
  request: Request,
  limit: number,
): Promise<Buffer> {
  const oversized = () => new RequestSizeError('Request is too large');
  if (Number(request.headers.get('content-length') ?? 0) > limit) {
    await request.body?.cancel().catch(() => {});
    throw oversized();
  }
  const reader = request.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) {
        await reader.cancel().catch(() => {});
        throw oversized();
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks, bytes);
  } finally {
    reader.releaseLock();
  }
}

export async function readBoundedText(
  request: Request,
  limit: number,
): Promise<string> {
  return (await readBoundedBytes(request, limit)).toString('utf8');
}
