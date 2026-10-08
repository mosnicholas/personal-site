import { useEffect, useState } from 'react';

import { likeImage, likeTitle, type Like } from '../../../shared/likes';
import { savedDate } from './api';
import { Faces } from './Shelf';
import { pick } from './trail';

interface Step {
  id: string;
  /** The tag (or category) followed to get here */
  via: string | null;
}

/**
 * One like at a time, large; each of its tags is a door to another like with
 * that tag, one I haven't seen on this walk if there is one. The path along
 * the bottom is the way back
 */
const Wander = ({
  likes,
  startId,
  paused,
  onEdit,
  onMove,
  onClose,
}: {
  likes: Like[];
  startId: string;
  /** While the edit panel is open over it, Escape and arrows are the panel's */
  paused: boolean;
  onEdit: (id: string) => void;
  /** Each like it comes to, to keep in the URL */
  onMove: (id: string) => void;
  onClose: () => void;
}) => {
  const [path, setPath] = useState<Step[]>([{ id: startId, via: null }]);
  const [at, setAt] = useState(0);
  const like = likes.find((candidate) => candidate.id === path[at].id);

  useEffect(() => {
    if (paused) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowLeft') setAt((i) => Math.max(0, i - 1));
      if (event.key === 'ArrowRight')
        setAt((i) => Math.min(path.length - 1, i + 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [paused, path.length, onClose]);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  const id = like?.id;
  useEffect(() => {
    if (id) onMove(id);
  }, [id, onMove]);

  // Deleted from the edit panel
  useEffect(() => {
    if (!like) onClose();
  }, [like, onClose]);
  if (!like) return null;

  const step = (next: Like, via: string | null) => {
    setPath([...path.slice(0, at + 1), { id: next.id, via }]);
    setAt(at + 1);
  };

  const seen = new Set(path.map((visited) => visited.id));
  const door = (via: string, pool: Like[], dashed = false) => {
    const unseen = pool.filter((other) => !seen.has(other.id));
    return (
      <button
        className={dashed ? 'likes-door likes-door-category' : 'likes-door'}
        disabled={pool.length === 0}
        key={via}
        onClick={() => step(pick(unseen.length ? unseen : pool), via)}
        type="button"
      >
        <span className="likes-door-name">
          <span>{via}</span>
          <span>{pool.length ? `${pool.length} more` : 'only this'}</span>
        </span>
        <Faces likes={unseen.length ? unseen : pool} max={4} />
      </button>
    );
  };
  const others = likes.filter((other) => other.id !== like.id);
  const image = likeImage(like, 1600);

  return (
    <div aria-label="Wander" className="likes-wander" role="dialog">
      <div className="likes-wander-inner">
        <div className="likes-wander-bar">
          <p className="likes-label">
            {at + 1} of {path.length} · {savedDate(like)}
          </p>
          <div className="likes-actions">
            <button onClick={() => onEdit(like.id)} type="button">
              Edit
            </button>
            <button
              onClick={() => step(pick(others), 'anywhere')}
              type="button"
            >
              Somewhere else
            </button>
            <button onClick={onClose} type="button">
              Back to the shelf
            </button>
          </div>
        </div>

        <div className="likes-wander-main" key={like.id}>
          <div
            className={
              image
                ? 'likes-wander-photo'
                : 'likes-wander-photo likes-wander-photo-empty'
            }
          >
            {image ? (
              <img alt="" referrerPolicy="no-referrer" src={image} />
            ) : (
              likeTitle(like)
            )}
          </div>
          <div className="likes-wander-text">
            <p className="likes-label">
              {[like.category, like.list].filter(Boolean).join(' · ')}
            </p>
            <h2>{likeTitle(like)}</h2>
            {like.description && <p>{like.description}</p>}
            {like.note && <p className="likes-wander-note">{like.note}</p>}
            {like.list === 'been' && like.review && (
              <p className="likes-wander-note">How it was: {like.review}</p>
            )}
            {like.url && (
              <a
                className="likes-link"
                href={like.url}
                rel="noreferrer"
                target="_blank"
              >
                {like.url.replace(/^https?:\/\/(www\.)?/, '')} ↗
              </a>
            )}
          </div>
        </div>

        <div className="likes-wander-head">
          <p className="likes-label">Follow a tag</p>
          <p className="likes-label likes-wander-keys">← back · esc closes</p>
        </div>
        <div className="likes-doors">
          {like.tags.map((tag) =>
            door(
              tag,
              others.filter((other) => other.tags.includes(tag)),
            ),
          )}
          {like.category &&
            door(
              `more ${like.category}`,
              others.filter((other) => other.category === like.category),
              true,
            )}
        </div>

        <p className="likes-label">Your path</p>
        <div className="likes-path">
          {path.map((visited, i) => {
            const stop = likes.find((other) => other.id === visited.id);
            const src = stop && likeImage(stop, 96);
            return (
              <span className="likes-path-stop" key={`${i}-${visited.id}`}>
                {visited.via && (
                  <span className="likes-path-via">—{visited.via}→</span>
                )}
                <button
                  aria-current={i === at ? 'step' : undefined}
                  onClick={() => setAt(i)}
                  type="button"
                >
                  {src ? (
                    <img alt="" referrerPolicy="no-referrer" src={src} />
                  ) : (
                    <i />
                  )}
                  <small>{stop ? likeTitle(stop) : 'Deleted'}</small>
                </button>
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default Wander;
