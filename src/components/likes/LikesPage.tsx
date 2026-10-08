import { type FormEvent, useCallback, useEffect, useState } from 'react';

import { likeTitle, type Like } from '../../../shared/likes';
import {
  api,
  ApiError,
  errorMessage,
  json,
  likeImage,
  addPhotos,
  resizePhoto,
  savedDate,
} from './api';
import LikeDetail from './LikeDetail';
import Shelf from './Shelf';
import { inTrail, pick, type Trail, trailFromUrl, trailUrl } from './trail';
import Wander from './Wander';
import './likes.css';

const matches = (like: Like, query: string) => {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const haystack = [
    like.url,
    like.text,
    like.note,
    like.list,
    like.review,
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
  const [photos, setPhotos] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    setSaving(true);
    setError('');
    try {
      if (photos.length) {
        const [first, ...rest] = photos;
        const body = new FormData();
        body.set('url', url);
        body.set('text', text);
        body.set('note', note);
        body.set('photo', await resizePhoto(first), 'photo.jpg');
        const { like } = await api<{ like: Like }>('', {
          method: 'POST',
          body,
        });
        await addPhotos(like.id, rest);
      } else {
        await api('', json('POST', { url, text, note }));
      }
      form.reset();
      setUrl('');
      setText('');
      setNote('');
      setPhotos([]);
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
        {photos.length > 1
          ? `${photos.length} photos`
          : (photos[0]?.name ?? 'Photos')}
        <input
          accept="image/*"
          multiple
          onChange={(event) => setPhotos([...(event.target.files ?? [])])}
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
          {like.category ?? 'new'}
          {like.list && ` · ${like.list}`} · {savedDate(like)}
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
  const [trail, setTrail] = useState<Trail>(trailFromUrl);
  const [list, setList] = useState('');
  // ?item= opens a like, e.g. from the monthly email or Claude
  const [openId, setOpenId] = useState(() =>
    new URLSearchParams(window.location.search).get('item'),
  );
  // Where Wander started; a new start begins a new path
  const [wander, setWander] = useState<{ id: string; walk: number }>();

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
    window.history.replaceState(null, '', trailUrl(trailFromUrl()));
  }, []);
  const closeWander = useCallback(() => setWander(undefined), []);
  const startWander = (id: string) =>
    setWander((current) => ({ id, walk: (current?.walk ?? 0) + 1 }));

  const moveTo = (next: Trail) => {
    setTrail(next);
    window.history.replaceState(null, '', trailUrl(next));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (signedOut) return <Login onSignedIn={reload} />;

  const lists = [...new Set(likes?.flatMap((like) => like.list ?? []))].sort();
  const shown = likes?.filter(
    (like) =>
      inTrail(like, trail) &&
      (!list || like.list === list) &&
      matches(like, query),
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
        {lists.length > 0 && (
          <select
            onChange={(event) => setList(event.target.value)}
            value={list}
          >
            <option value="">All lists</option>
            {lists.map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
        )}
        <button
          className="likes-wander-button"
          disabled={!shown?.length}
          onClick={() => shown?.length && startWander(pick(shown).id)}
          type="button"
        >
          Wander ↝
        </button>
      </div>

      {likes && shown && (
        <Shelf likes={likes} onChange={moveTo} shown={shown} trail={trail} />
      )}

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
            onOpen={() => startWander(like.id)}
          />
        ))}
      </section>

      {likes && wander && (
        <Wander
          key={wander.walk}
          likes={likes}
          onClose={closeWander}
          onEdit={setOpenId}
          paused={!!openLike}
          startId={wander.id}
        />
      )}

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
