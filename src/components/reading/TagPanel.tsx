import { useEffect, useRef } from 'react';

import type { ClusterInfo } from './clusters';
import { formatDate, hostOf, plural } from './format';
import type { ReadingTag } from './types';
import useTagDetail from './useTagDetail';

interface TagPanelProps {
  tag: ReadingTag | null;
  cluster: ClusterInfo | undefined;
  onClose: () => void;
}

const TagPanel = ({ tag, cluster, onClose }: TagPanelProps) => {
  const panelRef = useRef<HTMLElement>(null);
  const name = tag?.name ?? null;

  // A new tag starts at the top of the panel, with focus in it for keyboard users
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel || !name) return;
    panel.scrollTop = 0;
    panel.focus({ preventScroll: true });
  }, [name]);

  return (
    <aside
      ref={panelRef}
      className={`reading-panel${tag ? ' is-open' : ''}`}
      aria-label={tag ? `Tag: ${tag.name}` : 'About this page'}
      tabIndex={-1}
    >
      {tag ? (
        <TagDetails
          key={tag.name}
          tag={tag}
          cluster={cluster}
          onClose={onClose}
        />
      ) : (
        <div className="panel-intro">
          <h2 className="reading-heading">about</h2>
          <p>
            Everything I save to Readwise Reader gets summarized and tagged by
            Claude as it arrives. Once a week, Claude tidies the tags, groups
            them into clusters, defines each one, and writes a short brief of
            what the documents under it say.
          </p>
          <p>Pick a tag on the map to read its brief and documents.</p>
        </div>
      )}
    </aside>
  );
};

const TagDetails = ({
  tag,
  cluster,
  onClose,
}: {
  tag: ReadingTag;
  cluster: ClusterInfo | undefined;
  onClose: () => void;
}) => {
  const [state, retry] = useTagDetail(tag.name);
  const detail = state.status === 'ready' ? state.detail : null;
  const definition = detail?.tag.definition ?? tag.definition;
  const documents = detail
    ? [...detail.documents].sort((a, b) => b.saved.localeCompare(a.saved))
    : [];
  const total = detail?.tag.documents ?? tag.documents;

  return (
    <>
      <div className="panel-head">
        {cluster && (
          <p className="panel-cluster">
            <span
              className="reading-swatch"
              style={{ background: cluster.color }}
            />
            {cluster.label}
          </p>
        )}
        <button
          type="button"
          className="panel-close"
          onClick={onClose}
          aria-label="Close"
          title="Close (Esc)"
        >
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
            <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />
          </svg>
        </button>
      </div>
      <h2 className="panel-title">{tag.name}</h2>
      <p className="panel-count">{plural(total, 'document')}</p>
      {definition && <p className="panel-definition">{definition}</p>}

      {state.status === 'loading' && (
        <p className="reading-note is-loading">Loading documents…</p>
      )}
      {state.status === 'error' && (
        <p className="reading-note">
          Couldn't load this tag.{' '}
          <button type="button" className="reading-text-button" onClick={retry}>
            Try again
          </button>
        </p>
      )}
      {detail && (
        <>
          {detail.tag.brief && (
            <section className="panel-section">
              <h3 className="reading-heading">brief</h3>
              <p className="panel-brief">{detail.tag.brief}</p>
            </section>
          )}
          <section className="panel-section">
            <h3 className="reading-heading">documents</h3>
            {documents.length === 0 ? (
              <p className="reading-note">No documents yet.</p>
            ) : (
              <ol className="panel-docs">
                {documents.map((doc, i) => (
                  <li key={`${doc.url}-${i}`}>
                    <a href={doc.url} target="_blank" rel="noopener noreferrer">
                      {doc.title || doc.url}
                    </a>
                    <span className="panel-doc-meta">
                      {[doc.site || hostOf(doc.url), formatDate(doc.saved)]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </li>
                ))}
              </ol>
            )}
            {documents.length > 0 && total > documents.length && (
              <p className="reading-note">
                Showing the {documents.length} newest.
              </p>
            )}
          </section>
        </>
      )}
    </>
  );
};

export default TagPanel;
