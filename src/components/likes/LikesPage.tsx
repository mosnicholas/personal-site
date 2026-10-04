import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type {
  ImportBatch,
  LikeAttachment,
  LikeInput,
  LikedItem,
  LikesSettings,
} from '../../../shared/likes';

import './likes.css';

type LoadState = 'loading' | 'ready' | 'signed-out' | 'error';

interface LikesResponse {
  items: LikedItem[];
  total: number;
  categories: string[];
  settings: LikesSettings;
}

interface CaptureDraft {
  url: string;
  text: string;
  note: string;
}

interface ProcessStats {
  processed: number;
  failed: number;
  imported: number;
  pending: number;
}

const pendingStatuses = new Set(['pending', 'processing']);
const PAGE_SIZE = 50;
const PROCESS_NEXT_DELAY_MS = 1_000;
const PROCESS_BACKOFF_DELAY_MS = 5 * 60_000;

const requestKey = () =>
  typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const assetUrl = (attachment: LikeAttachment) =>
  `/api/likes?op=asset&id=${encodeURIComponent(attachment.id)}`;

const apiError = async (response: Response) => {
  const data: unknown = await response.json().catch(() => null);
  if (typeof data === 'object' && data !== null && 'error' in data) {
    const error = (data as { error?: unknown }).error;
    if (typeof error === 'string' && error) return error;
  }
  return response.status === 401
    ? 'Please sign in again.'
    : 'Something went wrong.';
};

const itemLabel = (item: LikedItem) =>
  item.title || item.url || item.originalText || 'Untitled';

const displayDate = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

const splitTags = (value: string) => [
  ...new Set(
    value
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean),
  ),
];

const primaryImage = (item: LikedItem) =>
  item.attachments.find((attachment) =>
    attachment.contentType.startsWith('image/'),
  );

const isPending = (item: LikedItem) => pendingStatuses.has(item.status);

const captureFromQuery = (): CaptureDraft => {
  const search = new URLSearchParams(window.location.search);
  return {
    url: search.get('url') ?? '',
    text: search.get('text') ?? '',
    note: search.get('note') ?? '',
  };
};

const LikesPage = () => {
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [items, setItems] = useState<LikedItem[]>([]);
  const [total, setTotal] = useState(0);
  const [categories, setCategories] = useState<string[]>([]);
  const [settings, setSettings] = useState<LikesSettings>({
    digestEnabled: false,
    digestCount: 3,
  });
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [offset, setOffset] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [remoteSelected, setRemoteSelected] = useState<LikedItem | null>(null);
  const [loginKey, setLoginKey] = useState('');
  const [loginError, setLoginError] = useState('');
  const [capture, setCapture] = useState<CaptureDraft>(captureFromQuery);
  const [captureFiles, setCaptureFiles] = useState<File[]>([]);
  const [captureError, setCaptureError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [importText, setImportText] = useState('');
  const [importBatch, setImportBatch] = useState<ImportBatch | null>(null);
  const [importError, setImportError] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [processError, setProcessError] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [notice, setNotice] = useState('');
  const [processCycle, setProcessCycle] = useState(0);
  const [reportedPending, setReportedPending] = useState(0);
  const currentRequest = useRef<AbortController | null>(null);
  const processStarted = useRef(false);
  const processTimer = useRef<number | null>(null);
  const requestedItemId = useRef(
    new URLSearchParams(window.location.search).get('item'),
  );
  const importRequestKey = useRef<string | null>(null);
  const captureRequestKey = useRef<string | null>(null);
  const uploadedAttachmentIds = useRef<string[]>([]);

  const selected =
    (remoteSelected?.id === selectedId && remoteSelected) ||
    items.find((item) => item.id === selectedId) ||
    null;
  const hasPending = items.some(isPending);
  const hasPendingImport = Boolean(
    importBatch && pendingStatuses.has(importBatch.status),
  );
  const hasWork = hasPending || hasPendingImport || reportedPending > 0;
  const changeCapture = (patch: Partial<typeof capture>) => {
    // A changed draft is a new capture; do not reuse a prior retry token or upload.
    captureRequestKey.current = null;
    uploadedAttachmentIds.current = [];
    setCapture((current) => ({ ...current, ...patch }));
  };

  const load = useCallback(
    async (signal?: AbortSignal) => {
      const search = new URLSearchParams();
      if (query.trim()) search.set('q', query.trim());
      if (category) search.set('category', category);
      search.set('limit', String(PAGE_SIZE));
      search.set('offset', String(offset));
      const suffix = search.size ? `?${search}` : '';
      const response = await fetch(`/api/likes${suffix}`, { signal });
      if (response.status === 401) {
        setLoadState('signed-out');
        return;
      }
      if (!response.ok) throw new Error(await apiError(response));
      const data = (await response.json()) as LikesResponse;
      setItems(data.items);
      setTotal(data.total);
      setCategories(data.categories);
      setSettings(data.settings);
      setLoadState('ready');
    },
    [category, offset, query],
  );

  useEffect(() => {
    const controller = new AbortController();
    currentRequest.current?.abort();
    currentRequest.current = controller;
    const task = window.setTimeout(() => {
      load(controller.signal).catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setLoadState('error');
        setNotice(
          error instanceof Error ? error.message : 'Could not load likes.',
        );
      });
    }, 0);
    return () => {
      window.clearTimeout(task);
      controller.abort();
    };
  }, [load]);

  const refresh = useCallback(async () => {
    try {
      await load();
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : 'Could not refresh likes.',
      );
    }
  }, [load]);

  const scheduleProcess = useCallback((delay: number) => {
    if (processTimer.current !== null) {
      window.clearTimeout(processTimer.current);
    }
    processTimer.current = window.setTimeout(() => {
      processTimer.current = null;
      processStarted.current = false;
      setProcessCycle((current) => current + 1);
    }, delay);
  }, []);

  useEffect(
    () => () => {
      if (processTimer.current !== null) {
        window.clearTimeout(processTimer.current);
      }
    },
    [],
  );

  const processPending = useCallback(async () => {
    if (processStarted.current || isProcessing || !hasWork) return;
    processStarted.current = true;
    setIsProcessing(true);
    setProcessError('');
    try {
      const response = await fetch('/api/likes?op=process', { method: 'POST' });
      if (response.status === 401) {
        setLoadState('signed-out');
        return;
      }
      if (!response.ok) throw new Error(await apiError(response));
      const stats = (await response.json()) as ProcessStats;
      setReportedPending(stats.pending);
      void refresh();
      if (stats.pending > 0 && (stats.processed > 0 || stats.imported > 0)) {
        scheduleProcess(PROCESS_NEXT_DELAY_MS);
      } else if (stats.pending > 0 && stats.failed > 0) {
        scheduleProcess(PROCESS_BACKOFF_DELAY_MS);
      }
    } catch (error) {
      setProcessError(
        error instanceof Error ? error.message : 'Could not start processing.',
      );
      scheduleProcess(PROCESS_BACKOFF_DELAY_MS);
    } finally {
      setIsProcessing(false);
    }
  }, [hasWork, isProcessing, refresh, scheduleProcess]);

  useEffect(() => {
    if (loadState !== 'ready' || !hasWork) return;
    const kickoff = window.setTimeout(() => void processPending(), 0);
    return () => window.clearTimeout(kickoff);
  }, [hasWork, loadState, processCycle, processPending]);

  useEffect(() => {
    if (loadState !== 'ready' || !hasWork) return;
    const timer = window.setInterval(() => void refresh(), 3_000);
    return () => window.clearInterval(timer);
  }, [hasWork, loadState, refresh]);

  useEffect(() => {
    if (!importBatch || !pendingStatuses.has(importBatch.status)) return;
    const timer = window.setInterval(() => {
      fetch(`/api/likes?op=import&id=${encodeURIComponent(importBatch.id)}`)
        .then(async (response) => {
          if (response.status === 401) {
            setLoadState('signed-out');
            return null;
          }
          if (!response.ok) throw new Error(await apiError(response));
          return (await response.json()) as ImportBatch;
        })
        .then((batch) => {
          if (!batch) return;
          setImportBatch(batch);
          if (!pendingStatuses.has(batch.status)) void refresh();
        })
        .catch((error: unknown) =>
          setImportError(
            error instanceof Error ? error.message : 'Could not check import.',
          ),
        );
    }, 2_000);
    return () => window.clearInterval(timer);
  }, [importBatch, refresh]);

  useEffect(() => {
    if (!hasWork) processStarted.current = false;
  }, [hasWork]);

  useEffect(() => {
    document.title = 'nimo / likes';
  }, []);

  useEffect(() => {
    const id = requestedItemId.current;
    if (!id || loadState !== 'ready') return;
    requestedItemId.current = null;
    const inPage = items.find((item) => item.id === id);
    if (inPage) {
      setRemoteSelected(null);
      setSelectedId(inPage.id);
      return;
    }
    const controller = new AbortController();
    const task = window.setTimeout(() => {
      fetch(`/api/likes?id=${encodeURIComponent(id)}`, {
        signal: controller.signal,
      })
        .then(async (response) => {
          if (response.status === 401) {
            setLoadState('signed-out');
            return null;
          }
          if (!response.ok) throw new Error(await apiError(response));
          return (await response.json()) as { item: LikedItem };
        })
        .then((data) => {
          if (!data) return;
          setRemoteSelected(data.item);
          setSelectedId(data.item.id);
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          setNotice(
            error instanceof Error
              ? error.message
              : 'Could not open this item.',
          );
        });
    }, 0);
    return () => {
      window.clearTimeout(task);
      controller.abort();
    };
  }, [items, loadState]);

  useEffect(() => {
    const search = new URLSearchParams(window.location.search);
    if (!['url', 'text', 'note', 'item'].some((key) => search.has(key))) return;
    search.delete('url');
    search.delete('text');
    search.delete('note');
    search.delete('item');
    const suffix = search.size ? `?${search}` : '';
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}${suffix}`,
    );
  }, []);

  const filteredItems = useMemo(() => items, [items]);

  const login = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!loginKey || isSaving) return;
    setIsSaving(true);
    setLoginError('');
    try {
      const response = await fetch('/api/likes?op=login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: loginKey }),
      });
      if (!response.ok) throw new Error(await apiError(response));
      setLoginKey('');
      processStarted.current = false;
      await refresh();
    } catch (error) {
      setLoginError(
        error instanceof Error ? error.message : 'Could not sign in.',
      );
    } finally {
      setIsSaving(false);
    }
  };

  const uploadFiles = async () => {
    if (uploadedAttachmentIds.current.length)
      return uploadedAttachmentIds.current;
    const attachments: string[] = [];
    for (const file of captureFiles) {
      if (file.size > 4 * 1024 * 1024) {
        throw new Error(`${file.name} is larger than 4 MB.`);
      }
      const body = new FormData();
      body.set('file', file);
      const response = await fetch('/api/likes?op=upload', {
        method: 'POST',
        body,
      });
      if (response.status === 401) {
        setLoadState('signed-out');
        throw new Error('Please sign in again.');
      }
      if (!response.ok) throw new Error(await apiError(response));
      const data = (await response.json()) as { attachment: LikeAttachment };
      attachments.push(data.attachment.id);
    }
    uploadedAttachmentIds.current = attachments;
    return uploadedAttachmentIds.current;
  };

  const saveCapture = async (event: React.FormEvent) => {
    event.preventDefault();
    if (
      isSaving ||
      (!capture.url.trim() && !capture.text.trim() && !captureFiles.length)
    ) {
      setCaptureError('Add a link, a note, or a photo.');
      return;
    }
    setIsSaving(true);
    setCaptureError('');
    try {
      const attachmentIds = await uploadFiles();
      const input: LikeInput = {
        kind: capture.url.trim()
          ? 'link'
          : attachmentIds.length
            ? 'photo'
            : 'note',
        url: capture.url.trim() || undefined,
        text: capture.text.trim() || undefined,
        note: capture.note.trim() || undefined,
        attachmentIds: attachmentIds.length ? attachmentIds : undefined,
      };
      captureRequestKey.current ??= requestKey();
      const response = await fetch('/api/likes', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': captureRequestKey.current,
        },
        body: JSON.stringify({
          input,
          idempotencyKey: captureRequestKey.current,
        }),
      });
      if (response.status === 401) {
        setLoadState('signed-out');
        return;
      }
      if (!response.ok) throw new Error(await apiError(response));
      setCapture({ url: '', text: '', note: '' });
      setCaptureFiles([]);
      captureRequestKey.current = null;
      uploadedAttachmentIds.current = [];
      setNotice('Saved.');
      processStarted.current = false;
      setReportedPending(1);
      setProcessCycle((current) => current + 1);
      await refresh();
    } catch (error) {
      setCaptureError(
        error instanceof Error ? error.message : 'Could not save this yet.',
      );
    } finally {
      setIsSaving(false);
    }
  };

  const startImport = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!importText.trim() || isImporting) return;
    setIsImporting(true);
    setImportError('');
    importRequestKey.current ??= requestKey();
    try {
      const response = await fetch('/api/likes?op=import', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          text: importText,
          idempotencyKey: importRequestKey.current,
        }),
      });
      if (response.status === 401) {
        setLoadState('signed-out');
        return;
      }
      if (!response.ok) throw new Error(await apiError(response));
      setImportBatch((await response.json()) as ImportBatch);
      setImportText('');
      importRequestKey.current = null;
      processStarted.current = false;
      setReportedPending(1);
      setProcessCycle((current) => current + 1);
    } catch (error) {
      setImportError(
        error instanceof Error ? error.message : 'Could not start import.',
      );
    } finally {
      setIsImporting(false);
    }
  };

  const patchItem = async (
    item: LikedItem,
    patch: Partial<
      Pick<
        LikedItem,
        'title' | 'note' | 'category' | 'tags' | 'snoozedUntil' | 'dismissed'
      >
    >,
  ) => {
    const response = await fetch(
      `/api/likes?id=${encodeURIComponent(item.id)}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      },
    );
    if (response.status === 401) {
      setLoadState('signed-out');
      return;
    }
    if (!response.ok) throw new Error(await apiError(response));
    const data = (await response.json()) as { item: LikedItem };
    setItems((current) =>
      current.map((candidate) =>
        candidate.id === item.id ? data.item : candidate,
      ),
    );
    setRemoteSelected((current) =>
      current?.id === item.id ? data.item : current,
    );
    setCategories((current) =>
      [...new Set([...current, data.item.category].filter(Boolean))].sort(
        (a, b) => a.localeCompare(b),
      ),
    );
  };

  const retryItem = async (item: LikedItem) => {
    const response = await fetch(
      `/api/likes?op=retry&id=${encodeURIComponent(item.id)}`,
      {
        method: 'POST',
      },
    );
    if (response.status === 401) {
      setLoadState('signed-out');
      return;
    }
    if (!response.ok) throw new Error(await apiError(response));
    processStarted.current = false;
    setReportedPending(1);
    setProcessCycle((current) => current + 1);
    await refresh();
  };

  const retryImport = async () => {
    if (!importBatch || isImporting) return;
    setIsImporting(true);
    setImportError('');
    try {
      const response = await fetch(
        `/api/likes?op=retry-import&id=${encodeURIComponent(importBatch.id)}`,
        { method: 'POST' },
      );
      if (response.status === 401) {
        setLoadState('signed-out');
        return;
      }
      if (!response.ok) throw new Error(await apiError(response));
      setImportBatch((await response.json()) as ImportBatch);
      processStarted.current = false;
      setReportedPending(1);
      setProcessCycle((current) => current + 1);
      await refresh();
    } finally {
      setIsImporting(false);
    }
  };

  const saveSettings = async (next: LikesSettings) => {
    setSettings(next);
    try {
      const response = await fetch('/api/likes?op=settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(next),
      });
      if (response.status === 401) {
        setLoadState('signed-out');
        return;
      }
      if (!response.ok) throw new Error(await apiError(response));
      const data = (await response.json()) as { settings: LikesSettings };
      setSettings(data.settings);
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : 'Could not save settings.',
      );
      void refresh();
    }
  };

  const logout = async () => {
    await fetch('/api/likes?op=logout', { method: 'POST' }).catch(
      () => undefined,
    );
    currentRequest.current?.abort();
    setItems([]);
    setSelectedId(null);
    setLoadState('signed-out');
  };

  const exportSearch = new URLSearchParams();
  if (query.trim()) exportSearch.set('q', query.trim());
  if (category) exportSearch.set('category', category);
  const exportHref = `/api/likes?op=export${exportSearch.size ? `&${exportSearch}` : ''}`;
  const pageStart = total ? offset + 1 : 0;
  const pageEnd = Math.min(total, offset + items.length);

  if (loadState === 'signed-out') {
    return (
      <main className="likes-login">
        <form className="likes-login-card" onSubmit={login}>
          <a className="likes-wordmark" href="/">
            nimo
          </a>
          <h1>likes</h1>
          <p>Private collection.</p>
          <label>
            Owner key
            <input
              autoComplete="current-password"
              autoFocus
              onChange={(event) => setLoginKey(event.target.value)}
              type="password"
              value={loginKey}
            />
          </label>
          {loginError && <p className="likes-error">{loginError}</p>}
          <button disabled={isSaving || !loginKey} type="submit">
            {isSaving ? 'Signing in…' : 'Enter'}
          </button>
        </form>
      </main>
    );
  }

  return (
    <main className="likes-page">
      <header className="likes-header">
        <h1>
          <a href="/">nimo</a>
          <span>/</span>likes
        </h1>
        <div className="likes-header-actions">
          <a className="likes-text-action" href={exportHref}>
            export
          </a>
          <button
            className="likes-text-action"
            onClick={() => void logout()}
            type="button"
          >
            logout
          </button>
        </div>
      </header>

      {loadState === 'loading' && (
        <p className="likes-state">Loading your collection…</p>
      )}
      {loadState === 'error' && (
        <div className="likes-state">
          <p>{notice || 'Could not load your collection.'}</p>
          <button onClick={() => void refresh()} type="button">
            Try again
          </button>
        </div>
      )}

      {loadState === 'ready' && (
        <>
          <section className="likes-capture" aria-label="Capture a like">
            <form onSubmit={saveCapture}>
              <div className="likes-capture-heading">
                <h2>Save it before you lose it.</h2>
                <p>Links, passing thoughts, and photos all belong here.</p>
              </div>
              <div className="likes-capture-fields">
                <input
                  aria-label="Link"
                  onChange={(event) =>
                    changeCapture({ url: event.target.value })
                  }
                  placeholder="Paste a link"
                  type="url"
                  value={capture.url}
                />
                <textarea
                  aria-label="What is it?"
                  onChange={(event) =>
                    changeCapture({ text: event.target.value })
                  }
                  placeholder="Or write what caught your attention"
                  rows={2}
                  value={capture.text}
                />
                <input
                  aria-label="Why do you like it?"
                  onChange={(event) =>
                    changeCapture({ note: event.target.value })
                  }
                  placeholder="Why? (optional)"
                  value={capture.note}
                />
                <label className="likes-file-input">
                  <span>
                    {captureFiles.length
                      ? `${captureFiles.length} photo${captureFiles.length === 1 ? '' : 's'} selected`
                      : 'Add photo'}
                  </span>
                  <input
                    accept="image/*,.pdf,text/plain"
                    multiple
                    onChange={(event) => {
                      captureRequestKey.current = null;
                      uploadedAttachmentIds.current = [];
                      setCaptureFiles(Array.from(event.target.files ?? []));
                    }}
                    type="file"
                  />
                </label>
                <button disabled={isSaving} type="submit">
                  {isSaving ? 'Saving…' : 'Save'}
                </button>
              </div>
              {captureError && <p className="likes-error">{captureError}</p>}
            </form>
          </section>

          <details className="likes-import">
            <summary>Import a pile of notes</summary>
            <form onSubmit={startImport}>
              <textarea
                onChange={(event) => setImportText(event.target.value)}
                placeholder="Paste old notes, lists, or bookmarks. They will be kept alongside the individual captures."
                rows={5}
                value={importText}
              />
              <button
                disabled={isImporting || !importText.trim()}
                type="submit"
              >
                {isImporting ? 'Starting…' : 'Import notes'}
              </button>
            </form>
            {importBatch && (
              <div className="likes-progress">
                <p>
                  Import {importBatch.status} · {importBatch.created} saved
                  {importBatch.duplicates
                    ? ` · ${importBatch.duplicates} already here`
                    : ''}
                  {importBatch.error ? ` · ${importBatch.error}` : ''}
                </p>
                {importBatch.status === 'failed' && (
                  <button
                    disabled={isImporting}
                    onClick={() =>
                      void retryImport().catch((error: unknown) =>
                        setImportError(
                          error instanceof Error
                            ? error.message
                            : 'Could not retry this import.',
                        ),
                      )
                    }
                    type="button"
                  >
                    Retry import
                  </button>
                )}
              </div>
            )}
            {importError && <p className="likes-error">{importError}</p>}
          </details>

          <section
            className="likes-toolbar"
            aria-label="Search and filter likes"
          >
            <input
              onChange={(event) => {
                setOffset(0);
                setQuery(event.target.value);
              }}
              placeholder="Search"
              type="search"
              value={query}
            />
            <select
              aria-label="Filter by category"
              onChange={(event) => {
                setOffset(0);
                setCategory(event.target.value);
              }}
              value={category}
            >
              <option value="">All categories</option>
              {categories.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
            {hasWork && (
              <span className="likes-processing">
                {isProcessing ? 'Organizing…' : 'Organizing in the background…'}
              </span>
            )}
          </section>
          {processError && <p className="likes-error">{processError}</p>}
          {notice && !processError && <p className="likes-notice">{notice}</p>}

          {filteredItems.length ? (
            <section className="likes-grid" aria-label="Your likes">
              {filteredItems.map((item) => {
                const image = primaryImage(item);
                return (
                  <button
                    className="likes-card"
                    key={item.id}
                    onClick={() => {
                      setRemoteSelected(null);
                      setSelectedId(item.id);
                    }}
                    type="button"
                  >
                    {image ? (
                      <img alt="" loading="lazy" src={assetUrl(image)} />
                    ) : (
                      <div className="likes-card-empty" aria-hidden="true" />
                    )}
                    <div className="likes-card-body">
                      <p className="likes-card-meta">
                        {item.category || item.kind} ·{' '}
                        {displayDate(item.createdAt)}
                      </p>
                      <h2>{itemLabel(item)}</h2>
                      {item.note && <p>{item.note}</p>}
                      <div className="likes-tags">
                        {item.tags.slice(0, 3).map((tag) => (
                          <span key={tag}>{tag}</span>
                        ))}
                      </div>
                      {item.status === 'failed' && (
                        <span className="likes-card-status">
                          Needs another try
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </section>
          ) : (
            <p className="likes-empty">
              Nothing here yet. Save the next thing that makes you pause.
            </p>
          )}

          {total > 0 && (
            <nav className="likes-pagination" aria-label="Likes pages">
              <span>
                {pageStart}–{pageEnd} of {total}
              </span>
              <button
                disabled={offset === 0}
                onClick={() =>
                  setOffset((current) => Math.max(0, current - PAGE_SIZE))
                }
                type="button"
              >
                Newer
              </button>
              <button
                disabled={offset + PAGE_SIZE >= total}
                onClick={() => setOffset((current) => current + PAGE_SIZE)}
                type="button"
              >
                Older
              </button>
            </nav>
          )}

          <section
            className="likes-settings"
            aria-label="Weekly digest settings"
          >
            <div>
              <h2>Weekly digest</h2>
              <p>A small selection from what you have saved.</p>
            </div>
            <label className="likes-toggle">
              <input
                checked={settings.digestEnabled}
                onChange={(event) =>
                  void saveSettings({
                    ...settings,
                    digestEnabled: event.target.checked,
                  })
                }
                type="checkbox"
              />
              <span>{settings.digestEnabled ? 'On' : 'Off'}</span>
            </label>
            <label className="likes-count">
              Items{' '}
              <input
                max="10"
                min="1"
                onChange={(event) =>
                  void saveSettings({
                    ...settings,
                    digestCount: Math.max(1, Number(event.target.value) || 1),
                  })
                }
                type="number"
                value={settings.digestCount}
              />
            </label>
          </section>
        </>
      )}

      {selected && (
        <LikeDetail
          key={`${selected.id}:${selected.updatedAt}`}
          item={selected}
          onClose={() => {
            setRemoteSelected(null);
            setSelectedId(null);
          }}
          onPatch={patchItem}
          onRetry={retryItem}
        />
      )}
    </main>
  );
};

const LikeDetail = ({
  item,
  onClose,
  onPatch,
  onRetry,
}: {
  item: LikedItem;
  onClose: () => void;
  onPatch: (
    item: LikedItem,
    patch: Partial<
      Pick<
        LikedItem,
        'title' | 'note' | 'category' | 'tags' | 'snoozedUntil' | 'dismissed'
      >
    >,
  ) => Promise<void>;
  onRetry: (item: LikedItem) => Promise<void>;
}) => {
  const [title, setTitle] = useState(item.title);
  const [note, setNote] = useState(item.note);
  const [category, setCategory] = useState(item.category);
  const [tags, setTags] = useState(item.tags.join(', '));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      await onPatch(item, { title, note, category, tags: splitTags(tags) });
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Could not save changes.',
      );
    } finally {
      setSaving(false);
    }
  };

  const action = async (run: () => Promise<void>) => {
    setSaving(true);
    setError('');
    try {
      await run();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'Could not update this item.',
      );
    } finally {
      setSaving(false);
    }
  };

  const archive = item.attachments.find(
    (attachment) => attachment.role === 'archive',
  );
  return (
    <div
      className="likes-detail-backdrop"
      onMouseDown={onClose}
      role="presentation"
    >
      <aside
        aria-label="Like details"
        className="likes-detail"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button
          aria-label="Close details"
          className="likes-close"
          onClick={onClose}
          type="button"
        >
          ×
        </button>
        {primaryImage(item) && (
          <img
            alt=""
            className="likes-detail-image"
            src={assetUrl(primaryImage(item)!)}
          />
        )}
        <p className="likes-card-meta">
          {item.kind} · saved {displayDate(item.createdAt)}
        </p>
        <label>
          Title
          <input
            onChange={(event) => setTitle(event.target.value)}
            value={title}
          />
        </label>
        <label>
          Why
          <textarea
            onChange={(event) => setNote(event.target.value)}
            rows={4}
            value={note}
          />
        </label>
        <label>
          Category
          <input
            onChange={(event) => setCategory(event.target.value)}
            value={category}
          />
        </label>
        <label>
          Tags
          <input
            onChange={(event) => setTags(event.target.value)}
            value={tags}
          />
        </label>
        {item.description && (
          <p className="likes-description">{item.description}</p>
        )}
        {item.url && (
          <a
            className="likes-link"
            href={item.url}
            rel="noreferrer"
            target="_blank"
          >
            Open original
          </a>
        )}
        {archive && (
          <a className="likes-link" download href={assetUrl(archive)}>
            Download archive
          </a>
        )}
        {error && <p className="likes-error">{error}</p>}
        <div className="likes-detail-actions">
          <button disabled={saving} onClick={() => void save()} type="button">
            {saving ? 'Saving…' : 'Save changes'}
          </button>
          {item.status === 'failed' && (
            <button
              disabled={saving}
              onClick={() => void action(() => onRetry(item))}
              type="button"
            >
              Retry
            </button>
          )}
          <button
            disabled={saving}
            onClick={() =>
              void action(() =>
                onPatch(item, {
                  snoozedUntil: new Date(
                    Date.now() + 7 * 86_400_000,
                  ).toISOString(),
                }),
              )
            }
            type="button"
          >
            Snooze a week
          </button>
          <button
            disabled={saving}
            onClick={() =>
              void action(() => onPatch(item, { dismissed: !item.dismissed }))
            }
            type="button"
          >
            {item.dismissed ? 'Restore' : 'Dismiss'}
          </button>
        </div>
      </aside>
    </div>
  );
};

export default LikesPage;
