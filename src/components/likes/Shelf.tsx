import { useState } from 'react';

import { likeImage, likeTitle, type Like } from '../../../shared/likes';
import type { Trail } from './trail';

// Pixels wide: the faces show at about 24px, the tiles about 300px
const FACE_WIDTH = 96;
const TILE_WIDTH = 600;

/** A few small pictures of what's behind a chip or a door */
export const Faces = ({ likes, max }: { likes: Like[]; max: number }) => (
  <span className="likes-faces">
    {likes
      .flatMap((like) => likeImage(like, FACE_WIDTH) ?? [])
      .slice(0, max)
      .map((src) => (
        <img
          alt=""
          decoding="async"
          key={src}
          loading="lazy"
          referrerPolicy="no-referrer"
          src={src}
        />
      ))}
  </span>
);

/**
 * The trail, then either the categories as photo tiles (with the most used
 * tags to start from) or the tags that narrow what's shown. Only tags that
 * still match something are offered, so it never runs into an empty page
 */
const Shelf = ({
  likes,
  shown,
  trail,
  onChange,
}: {
  likes: Like[];
  shown: Like[];
  trail: Trail;
  onChange: (trail: Trail) => void;
}) => {
  const [allTags, setAllTags] = useState(false);
  const go = (next: Trail) => {
    setAllTags(false);
    onChange(next);
  };
  const atTop = !trail.category && trail.tags.length === 0;

  const steps = [
    { name: 'all likes', trail: { category: null, tags: [] } },
    ...(trail.category
      ? [
          {
            name: trail.category,
            trail: { category: trail.category, tags: [] },
          },
        ]
      : []),
    ...trail.tags.map((tag, i) => ({
      name: tag,
      trail: { category: trail.category, tags: trail.tags.slice(0, i + 1) },
    })),
  ];

  // With a search or a list picked, the tiles count (and show) only what
  // matches, and categories with nothing left drop out
  const totals = new Map<string, number>();
  for (const like of likes) {
    if (like.category) {
      totals.set(like.category, (totals.get(like.category) ?? 0) + 1);
    }
  }
  const categories = new Map<string, Like[]>();
  for (const like of shown) {
    if (!like.category) continue;
    categories.set(like.category, [
      ...(categories.get(like.category) ?? []),
      like,
    ]);
  }

  const byTag = new Map<string, Like[]>();
  for (const like of shown) {
    for (const tag of like.tags) {
      if (trail.tags.includes(tag)) continue;
      byTag.set(tag, [...(byTag.get(tag) ?? []), like]);
    }
  }
  // A tag on everything shown wouldn't narrow it
  const chips = [...byTag]
    .filter(([, tagged]) => tagged.length < shown.length)
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  const limit = allTags ? chips.length : atTop ? 24 : 18;

  return (
    <section className="likes-shelf">
      <nav aria-label="Where you are" className="likes-trail">
        {steps.map((step, i) => (
          <span key={step.name}>
            {i > 0 && <span className="likes-trail-sep">›</span>}
            <button
              aria-current={i === steps.length - 1 ? 'step' : undefined}
              onClick={() => go(step.trail)}
              type="button"
            >
              {step.name}
            </button>
          </span>
        ))}
        <span className="likes-trail-count">
          {shown.length} {shown.length === 1 ? 'like' : 'likes'}
        </span>
      </nav>

      {atTop && (
        <div className="likes-categories">
          {[...categories]
            .sort(
              (a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]),
            )
            .map(([name, inCategory]) => {
              const cover = inCategory.flatMap(
                (like) => likeImage(like, TILE_WIDTH) ?? [],
              )[0];
              return (
                <button
                  className="likes-category"
                  key={name}
                  onClick={() => go({ category: name, tags: [] })}
                  type="button"
                >
                  {cover && (
                    <img
                      alt=""
                      decoding="async"
                      loading="lazy"
                      referrerPolicy="no-referrer"
                      src={cover}
                    />
                  )}
                  <span>
                    {name}
                    <small>
                      {inCategory.length}
                      {inCategory.length < (totals.get(name) ?? 0) &&
                        ` of ${totals.get(name)}`}
                    </small>
                  </span>
                </button>
              );
            })}
        </div>
      )}

      {chips.length > 0 && (
        <div className="likes-chips-wrap">
          <p className="likes-label">
            {atTop ? 'Or start from a tag' : 'Narrow by'}
          </p>
          <div className="likes-chips">
            {chips.slice(0, limit).map(([tag, tagged]) => (
              <button
                className="likes-chip"
                key={tag}
                onClick={() => go({ ...trail, tags: [...trail.tags, tag] })}
                title={tagged.slice(0, 6).map(likeTitle).join('\n')}
                type="button"
              >
                <Faces likes={tagged} max={3} />
                {tag}
                <b>{tagged.length}</b>
              </button>
            ))}
            {chips.length > limit && (
              <button
                className="likes-text-button likes-more"
                onClick={() => setAllTags(true)}
                type="button"
              >
                {chips.length - limit} more
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
};

export default Shelf;
