import assert from 'node:assert/strict';
import test from 'node:test';
import Anthropic from '@anthropic-ai/sdk';

import { LikeWebSearchError, researchLikeOnWeb } from './likes-web-search.js';

function response(
  content: Anthropic.Message['content'],
  stopReason: Anthropic.Message['stop_reason'] = 'end_turn',
) {
  return { content, stop_reason: stopReason } as Anthropic.Message;
}

function successfulSearch(
  url = 'https://maker.example/product',
  title = 'Maker Product',
) {
  return response([
    {
      type: 'server_tool_use',
      id: 'search-1',
      name: 'web_search',
      input: { query: 'Maker product' },
    },
    {
      type: 'web_search_tool_result',
      tool_use_id: 'search-1',
      caller: { type: 'direct' },
      content: [
        {
          type: 'web_search_result',
          url,
          title,
          page_age: null,
          encrypted_content: 'encrypted-result',
        },
      ],
    },
    {
      type: 'text',
      text: `${title} is a product.`,
      citations: [
        {
          type: 'web_search_result_location',
          url,
          title,
          cited_text: 'A manufacturer description of the product.',
          encrypted_index: 'citation-index',
        },
      ],
    },
  ] as unknown as Anthropic.Message['content']);
}

function clientFor(
  responses: Anthropic.Message[],
  requests: Anthropic.MessageCreateParamsNonStreaming[] = [],
  options: unknown[] = [],
) {
  return {
    client: {
      messages: {
        create: async (
          request: Anthropic.MessageCreateParamsNonStreaming,
          requestOptions: unknown,
        ) => {
          requests.push(request);
          options.push(requestOptions);
          const next = responses.shift();
          if (!next) throw new Error('unexpected web-search request');
          return next;
        },
      },
    } as unknown as Pick<Anthropic, 'messages'>,
    requests,
    options,
  };
}

test('forces native search and derives sources only from cited tool results', async () => {
  const { client, requests, options } = clientFor([successfulSearch()]);
  const signal = AbortSignal.timeout(10_000);
  const result = await researchLikeOnWeb({
    client,
    subjectId: 'like-1',
    content: '{"visibleLabel":"Maker Product"}',
    signal,
  });
  assert.deepEqual(requests[0]?.tool_choice, {
    type: 'tool',
    name: 'web_search',
  });
  assert.deepEqual(requests[0]?.tools, [
    { type: 'web_search_20250305', name: 'web_search', max_uses: 3 },
  ]);
  assert.equal(requests[0]?.output_config, undefined);
  assert.equal((options[0] as { signal?: AbortSignal }).signal?.aborted, false);
  assert.deepEqual(result.sources, [
    {
      url: 'https://maker.example/product',
      title: 'Maker Product',
      excerpt: 'A manufacturer description of the product.',
    },
  ]);
});

test('accepts empty successful results as a valid no-evidence research result', async () => {
  const { client } = clientFor([
    response([
      {
        type: 'web_search_tool_result',
        tool_use_id: 'search-1',
        caller: { type: 'direct' },
        content: [],
      },
      { type: 'text', text: 'No product match was found.' },
    ] as unknown as Anthropic.Message['content']),
  ]);
  const result = await researchLikeOnWeb({
    client,
    subjectId: 'like-empty',
    content: 'generic note',
  });
  assert.deepEqual(result.sources, []);
  assert.match(result.researchText, /No product match/);
});

test('rejects 200 tool errors and responses without successful search', async () => {
  const toolError = clientFor([
    response([
      {
        type: 'web_search_tool_result',
        tool_use_id: 'search-1',
        caller: { type: 'direct' },
        content: {
          type: 'web_search_tool_result_error',
          error_code: 'unavailable',
        },
      },
    ] as unknown as Anthropic.Message['content']),
  ]);
  await assert.rejects(
    () =>
      researchLikeOnWeb({
        client: toolError.client,
        subjectId: 'error',
        content: 'x',
      }),
    (error: unknown) =>
      error instanceof LikeWebSearchError && /unavailable/.test(error.message),
  );
  const absent = clientFor([
    Object.assign(
      response([
        { type: 'text', text: 'I did not search.' },
      ] as unknown as Anthropic.Message['content']),
      { usage: { server_tool_use: { web_search_requests: 1 } } },
    ),
  ]);
  await assert.rejects(
    () =>
      researchLikeOnWeb({
        client: absent.client,
        subjectId: 'absent',
        content: 'x',
      }),
    /did not run/,
  );
});

test('continues two pause_turns with every provider block unchanged and cross-turn sources', async () => {
  const first = successfulSearch();
  first.stop_reason = 'pause_turn';
  const second = response(
    [
      { type: 'text', text: 'Continuing the web research.' },
    ] as unknown as Anthropic.Message['content'],
    'pause_turn',
  );
  const final = response([
    {
      type: 'text',
      text: 'Maker Product has a verified product page.',
      citations: [
        {
          type: 'web_search_result_location',
          url: 'https://maker.example/product',
          title: 'Maker Product',
          cited_text: 'The official Maker Product page.',
          encrypted_index: 'cross-turn-citation',
        },
      ],
    },
  ] as unknown as Anthropic.Message['content']);
  const { client, requests } = clientFor([first, second, final]);
  const research = await researchLikeOnWeb({
    client,
    subjectId: 'paused',
    content: 'Maker Product',
  });
  assert.equal(requests.length, 3);
  assert.deepEqual(requests[1]?.tool_choice, { type: 'auto' });
  assert.equal(
    (requests[1]?.tools?.[0] as Anthropic.WebSearchTool20250305 | undefined)
      ?.max_uses,
    2,
  );
  assert.equal(requests[1]?.messages[1]?.content, first.content);
  assert.equal(requests[2]?.messages[2]?.content, second.content);
  assert.equal(research.sources[0]?.url, 'https://maker.example/product');
});

test('drops private and mismatched citation URLs even when a provider response is well formed', async () => {
  const search = successfulSearch();
  const text = search.content.find(
    (block) => block.type === 'text',
  ) as Anthropic.TextBlock;
  text.citations = [
    {
      type: 'web_search_result_location',
      url: 'https://127.0.0.1/internal',
      title: 'Private',
      cited_text: 'private content',
      encrypted_index: 'private',
    },
    {
      type: 'web_search_result_location',
      url: 'https://other.example/variant',
      title: 'Wrong variant',
      cited_text: 'different item',
      encrypted_index: 'mismatch',
    },
  ] as unknown as Anthropic.TextBlock['citations'];
  const { client } = clientFor([search]);
  const result = await researchLikeOnWeb({
    client,
    subjectId: 'bad-cites',
    content: 'x',
  });
  assert.deepEqual(result.sources, []);
});

test('rejects refusal, exhausted pauses, and an expired shared deadline', async () => {
  const refused = clientFor([response([], 'refusal')]);
  await assert.rejects(
    () =>
      researchLikeOnWeb({
        client: refused.client,
        subjectId: 'refusal',
        content: 'x',
      }),
    /did not finish/,
  );
  const paused = response(
    [
      {
        type: 'web_search_tool_result',
        tool_use_id: 'search-1',
        caller: { type: 'direct' },
        content: [],
      },
    ] as unknown as Anthropic.Message['content'],
    'pause_turn',
  );
  const exhausted = clientFor([paused, paused, paused]);
  await assert.rejects(
    () =>
      researchLikeOnWeb({
        client: exhausted.client,
        subjectId: 'paused-out',
        content: 'x',
      }),
    /did not finish/,
  );
  const deadline = clientFor([successfulSearch()]);
  await assert.rejects(
    () =>
      researchLikeOnWeb({
        client: deadline.client,
        subjectId: 'late',
        content: 'x',
        deadline: Date.now() - 1,
      }),
    /timed out/,
  );
});

test('stage abort stops an SDK response body that stalls after headers', async () => {
  let transportSignal: AbortSignal | undefined;
  const client = new Anthropic({
    apiKey: 'test-key',
    fetch: (async (_input, init) => {
      transportSignal = (init as RequestInit).signal ?? undefined;
      assert.ok(transportSignal);
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          const abort = () => controller.error(transportSignal!.reason);
          if (transportSignal!.aborted) abort();
          else
            transportSignal!.addEventListener('abort', abort, { once: true });
        },
      });
      return new Response(body, {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch,
  });
  const started = Date.now();
  // AbortSignal.timeout uses an unref'd timer. Keep this offline body test's
  // event loop alive long enough to prove the stage signal cancels the read.
  const keepAlive = setTimeout(() => undefined, 1_000);
  try {
    await assert.rejects(() =>
      researchLikeOnWeb({
        client,
        subjectId: 'stalled-sdk-body',
        content: 'Maker Product',
        deadline: started + 25,
      }),
    );
    assert.equal(transportSignal?.aborted, true);
    assert.ok(Date.now() - started < 1_000);
  } finally {
    clearTimeout(keepAlive);
  }
});
