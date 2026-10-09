import { useEffect, useState } from 'react';

import {
  likeImage,
  sizedPicture,
  type Like,
  type LikePatch,
} from '../../../shared/likes';
import { addPhotos, api, errorMessage, json, savedDate } from './api';

interface Draft {
  title: string;
  note: string;
  list: string;
  review: string;
  description: string;
  category: string;
  tags: string;
}

const draftOf = (like: Like): Draft => ({
  title: like.title,
  note: like.note,
  list: like.list ?? '',
  review: like.review,
  description: like.description,
  category: like.category ?? '',
  tags: like.tags.join(', '),
});

/** One like, to edit, retry or delete */
const LikeDetail = ({
  like,
  onChange,
  onClose,
}: {
  like: Like;
  onChange: () => void;
  onClose: () => void;
}) => {
  const [draft, setDraft] = useState(() => draftOf(like));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await action();
      onChange();
      return true;
    } catch (reason) {
      setError(errorMessage(reason));
      return false;
    } finally {
      setBusy(false);
    }
  };

  // Only what I changed, so details filled in while this was open survive
  const changes = () => {
    const before = draftOf(like);
    const patch: LikePatch = {};
    for (const field of [
      'title',
      'note',
      'list',
      'review',
      'description',
      'category',
    ] as const) {
      if (draft[field] !== before[field]) patch[field] = draft[field];
    }
    if (draft.tags !== before.tags) {
      patch.tags = draft.tags
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean);
    }
    return patch;
  };

  // Saves my note first: it's what steers Haiku toward the version I like
  const organizeAgain = async () => {
    if (draft.note !== like.note) {
      await api(`?id=${like.id}`, json('PATCH', { note: draft.note }));
    }
    await api(`?op=redo&id=${like.id}`, { method: 'POST' });
  };

  const removePhoto = (n: number) => {
    if (!window.confirm('Remove this photo?')) return;
    void run(() => api(`?op=photo&id=${like.id}&n=${n}`, { method: 'DELETE' }));
  };

  const field = (name: keyof Draft, label: string, rows = 0) => (
    <label className="likes-field">
      {label}
      {rows ? (
        <textarea
          onChange={(event) =>
            setDraft({ ...draft, [name]: event.target.value })
          }
          rows={rows}
          value={draft[name]}
        />
      ) : (
        <input
          onChange={(event) =>
            setDraft({ ...draft, [name]: event.target.value })
          }
          value={draft[name]}
        />
      )}
    </label>
  );

  const image = likeImage(like, 'large');

  return (
    <div className="likes-detail-backdrop" onMouseDown={onClose}>
      <aside
        aria-label="Like"
        className="likes-detail"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button
          aria-label="Close"
          className="likes-close"
          onClick={onClose}
          type="button"
        >
          ×
        </button>
        {like.photoUrls.length > 0 ? (
          <div className="likes-detail-photos">
            {like.photoUrls.map((photoUrl, n) => (
              <figure className="likes-detail-photo" key={photoUrl}>
                <img
                  alt=""
                  className="likes-detail-image"
                  src={sizedPicture(photoUrl, 'large')}
                />
                <button
                  aria-label="Remove photo"
                  className="likes-photo-remove"
                  disabled={busy}
                  onClick={() => removePhoto(n)}
                  type="button"
                >
                  ×
                </button>
              </figure>
            ))}
          </div>
        ) : (
          image && (
            <img
              alt=""
              className="likes-detail-image"
              referrerPolicy="no-referrer"
              src={image}
            />
          )
        )}
        <p className="likes-meta">
          {like.category ?? 'uncategorized'} · saved {savedDate(like)} from{' '}
          {like.source}
        </p>
        {like.status === 'pending' && (
          <p className="likes-status">Organizing…</p>
        )}
        {like.status === 'failed' && (
          <p className="likes-status likes-status-failed">
            Couldn’t organize this: {like.error}
          </p>
        )}
        {like.text && <p className="likes-text">{like.text}</p>}
        {like.url && (
          <a
            className="likes-link"
            href={like.url}
            rel="noreferrer"
            target="_blank"
          >
            {like.url}
          </a>
        )}

        {field('title', 'Title')}
        {field('note', 'Why I like it, or who recommended it', 3)}
        <label className="likes-field">
          List
          <input
            list="likes-lists"
            onChange={(event) =>
              setDraft({ ...draft, list: event.target.value })
            }
            placeholder="want to try, been…"
            value={draft.list}
          />
          <datalist id="likes-lists">
            <option value="want to try" />
            <option value="been" />
          </datalist>
        </label>
        {(draft.list.trim().toLowerCase() === 'been' || draft.review) &&
          field('review', 'How it was', 3)}
        {field('description', 'Description', 3)}
        {field('category', 'Category')}
        {field('tags', 'Tags')}

        {like.sources.length > 0 && (
          <div className="likes-sources">
            <p>Identified from</p>
            {like.sources.map((source) => (
              <a
                href={source.url}
                key={source.url}
                rel="noreferrer"
                target="_blank"
              >
                {source.title || source.url}
              </a>
            ))}
          </div>
        )}

        {error && <p className="likes-error">{error}</p>}
        <div className="likes-actions">
          <button
            disabled={busy}
            onClick={() =>
              void run(() => api(`?id=${like.id}`, json('PATCH', changes())))
            }
            type="button"
          >
            Save
          </button>
          <button
            disabled={busy}
            onClick={() => void run(organizeAgain)}
            title="Rewrites the title, description, category and tags, going by your note and photos"
            type="button"
          >
            {like.status === 'ready' ? 'Organize again' : 'Retry'}
          </button>
          <label className="likes-button">
            Add photos
            <input
              accept="image/*"
              disabled={busy}
              multiple
              onChange={(event) => {
                const files = [...(event.target.files ?? [])];
                event.target.value = '';
                if (files.length) void run(() => addPhotos(like.id, files));
              }}
              type="file"
            />
          </label>
          <button
            disabled={busy}
            onClick={() => {
              if (!window.confirm('Delete this like?')) return;
              void run(() => api(`?id=${like.id}`, { method: 'DELETE' })).then(
                (deleted) => deleted && onClose(),
              );
            }}
            type="button"
          >
            Delete
          </button>
        </div>
      </aside>
    </div>
  );
};

export default LikeDetail;
