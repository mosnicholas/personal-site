import { type FormEvent, useCallback, useEffect, useState } from 'react';

import { likeTitle, type Like } from '../../../shared/likes';
import { api, ApiError, errorMessage, json, likeImage, savedDate } from './api';
import LikeDetail from './LikeDetail';
import './likes.css';

/**
 * Photos go up as JPEGs at most 2048px on the long side: small enough for
 * Vercel's 4.5 MB request limit, and plenty for Haiku to read
 */
async function resizePhoto(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error('Couldn’t read that photo')),
      'image/jpeg',
      0.85,
    ),
  );
}

const matches = (like: Like, query: string) => {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const haystack = [
    like.url,
    like.text,
    like.note,
    like.title,
    like.description,
    like.category,
    ...like.tags,
  ]
    .join(' ')
    .toLowerCase();
  return words.every((word) => haystack.includes(word));
};

const Login = ({ onSignedIn }: { onSignedIn: () => void }) => {
  const [key, setKey] = useState('');
  const [error, setError] = useState('');

  const signIn = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await api('?op=login', json('POST', { key }));
      onSignedIn();
    } catch (reason) {
      setError(errorMessage(reason));
    }
  };

  return (
    <main className="likes-login">
      <form onSubmit={(event) => void signIn(event)}>
        <h1>likes</h1>
        <input
          autoComplete="current-password"
          autoFocus
          onChange={(event) => setKey(event.target.value)}
          placeholder="Owner key"
          type="password"
          value={key}
        />
        {error && <p className="likes-error">{error}</p>}
        <button disabled={!key} type="submit">
          Sign in
        </button>
      </form>
    </main>
  );
};

/** Save a link, a note, a photo, or any mix; ?url= and ?text= prefill it */
const Capture = ({ onSaved }: { onSaved: () => void }) => {
  const [url, setUrl] = useState(
    () => new URLSearchParams(window.location.search).get('url') ?? '',
  );
  const [text, setText] = useState(
    () => new URLSearchParams(window.location.search).get('text') ?? '',
  );
  const [note, setNote] = useState('');
  const [photo, setPhoto] = useState<File>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    setSaving(true);
    setError('');
    try {
      if (photo) {
        const body = new FormData();
        body.set('url', url);
        body.set('text', text);
        body.set('note', note);
        body.set('photo', await resizePhoto(photo), 'photo.jpg');
        await api('', { method: 'POST', body });
      } else {
        await api('', json('POST', { url, text, note }));
      }
      form.reset();
      setUrl('');
      setText('');
      setNote('');
      setPhoto(undefined);
      onSaved();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="likes-capture" onSubmit={(event) => void save(event)}>
      <input
        onChange={(event) => setUrl(event.target.value)}
        placeholder="Link"
        type="url"
        value={url}
      />
      <textarea
        onChange={(event) => setText(event.target.value)}
        placeholder="Or what it is"
        rows={1}
        value={text}
      />
      <input
        onChange={(event) => setNote(event.target.value)}
        placeholder="Why (optional)"
        value={note}
      />
      <label className="likes-file">
        {photo ? photo.name : 'Photo'}
        <input
          accept="image/*"
          onChange={(event) => setPhoto(event.target.files?.[0])}
          type="file"
        />
      </label>
      <button disabled={saving} type="submit">
        {saving ? 'Saving…' : 'Save'}
      </button>
      {error && <p className="likes-error">{error}</p>}
    </form>
  );
};

/** Paste a pile of old notes; they're split into separate likes */
const Import = ({ onImported }: { onImported: () => void }) => {
  const [text, setText] = useState('');
  const [importing, setImporting] = useState(false);
  const [status, setStatus] = useState('');

  const run = async (event: FormEvent) => {
    event.preventDefault();
    setImporting(true);
    setStatus('');
    try {
      const { likes } = await api<{ likes: Like[] }>(
        '?op=import',
        json('POST', { text }),
      );
      setText('');
      setStatus(`Imported ${likes.length} likes`);
      onImported();
    } catch (reason) {
      setStatus(errorMessage(reason));
    } finally {
      setImporting(false);
    }
  };

  return (
    <details className="likes-import">
      <summary>Import notes</summary>
      <form onSubmit={(event) => void run(event)}>
        <textarea
          onChange={(event) => setText(event.target.value)}
          placeholder="Paste old notes, lists or bookmarks"
          rows={6}
          value={text}
        />
        <button disabled={importing || !text.trim()} type="submit">
          {importing ? 'Importing…' : 'Import'}
        </button>
      </form>
      {status && <p className="likes-muted">{status}</p>}
    </details>
  );
};

const LikeCard = ({ like, onOpen }: { like: Like; onOpen: () => void }) => {
  const image = likeImage(like);
  return (
    <button className="likes-card" onClick={onOpen} type="button">
      {image ? (
        <img alt="" loading="lazy" referrerPolicy="no-referrer" src={image} />
      ) : (
        <div className="likes-card-empty" />
      )}
      <div className="likes-card-body">
        <p className="likes-meta">
          {like.category ?? 'new'} · {savedDate(like)}
        </p>
        <h2>{likeTitle(like)}</h2>
        {like.note && <p>{like.note}</p>}
        {like.status === 'pending' && (
          <p className="likes-status">Organizing…</p>
        )}
        {like.status === 'failed' && (
          <p className="likes-status likes-status-failed">Couldn’t organize</p>
        )}
      </div>
    </button>
  );
};

const LikesPage = () => {
  const [likes, setLikes] = useState<Like[]>();
  const [signedOut, setSignedOut] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  // ?item= opens a like, e.g. from the monthly email or Claude
  const [openId, setOpenId] = useState(() =>
    new URLSearchParams(window.location.search).get('item'),
  );

  useEffect(() => {
    document.title = 'nimo / likes';
  }, []);

  // Bumped to fetch the likes again, after a change and while Haiku works
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((current) => current + 1), []);

  useEffect(() => {
    let current = true;
    api<{ likes: Like[] }>().then(
      ({ likes }) => {
        if (!current) return;
        setLikes(likes);
        setSignedOut(false);
        setError('');
      },
      (reason: unknown) => {
        if (!current) return;
        if (reason instanceof ApiError && reason.status === 401) {
          setSignedOut(true);
        } else {
          setError(errorMessage(reason));
        }
      },
    );
    return () => {
      current = false;
    };
  }, [version]);

  // Haiku organizes new likes within a minute or so; check back until done
  const organizing = likes?.some((like) => like.status === 'pending');
  useEffect(() => {
    if (!organizing) return;
    const timer = window.setInterval(reload, 5000);
    return () => window.clearInterval(timer);
  }, [organizing, reload]);

  const close = useCallback(() => {
    setOpenId(null);
    window.history.replaceState(null, '', '/likes');
  }, []);

  if (signedOut) return <Login onSignedIn={reload} />;

  const categories = [
    ...new Set(likes?.flatMap((like) => like.category ?? [])),
  ].sort();
  const shown = likes?.filter(
    (like) => (!category || like.category === category) && matches(like, query),
  );
  const openLike = likes?.find((like) => like.id === openId);

  return (
    <main className="likes-page">
      <header className="likes-header">
        <h1>
          <a href="/">nimo</a> / likes
        </h1>
        <button
          className="likes-text-button"
          onClick={() =>
            void api('?op=logout', { method: 'POST' }).then(() =>
              setSignedOut(true),
            )
          }
          type="button"
        >
          sign out
        </button>
      </header>

      <Capture onSaved={reload} />
      <Import onImported={reload} />

      <div className="likes-filters">
        <input
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search"
          type="search"
          value={query}
        />
        <select
          onChange={(event) => setCategory(event.target.value)}
          value={category}
        >
          <option value="">All categories</option>
          {categories.map((name) => (
            <option key={name}>{name}</option>
          ))}
        </select>
      </div>

      {error && <p className="likes-error">{error}</p>}
      {shown && shown.length === 0 && (
        <p className="likes-muted">
          {likes?.length ? 'Nothing matches.' : 'Nothing saved yet.'}
        </p>
      )}
      <section className="likes-grid">
        {shown?.map((like) => (
          <LikeCard
            key={like.id}
            like={like}
            onOpen={() => setOpenId(like.id)}
          />
        ))}
      </section>

      {openLike && (
        <LikeDetail
          // A fresh form once Haiku fills in the details
          key={`${openLike.id}-${openLike.status}`}
          like={openLike}
          onChange={reload}
          onClose={close}
        />
      )}
    </main>
  );
};

export default LikesPage;
