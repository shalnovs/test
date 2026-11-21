import { useState } from 'react';
import { MediaImage } from './components';
import { PhotoHotspots } from './PhotoHotspots';
import { useArchive } from './context';
import type { Item } from './api';

export function FeaturedPhoto({ media }: { media: Item }) {
  const { archive, photo, person, notify } = useArchive();
  const [ratio, setRatio] = useState(1);
  const [ready, setReady] = useState(false);
  return (
    <article className="featured-photo">
      <div className="featured-photo-frame">
        <div className="featured-photo-stage" style={{ width: `min(100%, ${160 * ratio}px)` }}>
          <button
            className="featured-photo-open"
            aria-label={`Открыть фото: ${media.title}`}
            onClick={() => photo(media.id)}
          >
            <MediaImage
              id={media.id}
              alt={media.title}
              onLoad={(e) => {
                setRatio(e.currentTarget.naturalWidth / e.currentTarget.naturalHeight);
                setReady(true);
              }}
            />
          </button>
          {ready && (
            <PhotoHotspots
              tags={archive.data.tags.filter((t) => t.media_id === media.id)}
              people={archive.data.people}
              onSelect={(t) =>
                t.person_id ? person(t.person_id) : notify(t.label || 'Человек пока неизвестен')
              }
            />
          )}
        </div>
      </div>
      <button className="featured-photo-title" onClick={() => photo(media.id)}>
        <strong>{media.title}</strong>
      </button>
    </article>
  );
}
