import { CalendarDays, Images, MapPin, FileText } from 'lucide-react';
import { useArchive } from './context';
import { Empty, MediaImage, Modal } from './components';
import { dateLabel } from './api';
import { mediaDateLabel, selectMaterials, selectionTitle, type MaterialSelection } from './materials';

export function RelatedMaterials({
  selection,
  onClose,
}: {
  selection: MaterialSelection;
  onClose: () => void;
}) {
  const { archive, event, photo } = useArchive();
  const { events, photos, documents, linked } = selectMaterials(archive.data, selection);
  return (
    <Modal title={selectionTitle(selection)} onClose={onClose} wide>
      <div className="related-materials">
        <p className="related-summary">
          {selection.kind === 'date' ? <CalendarDays size={20} /> : <MapPin size={20} />} {events.length}{' '}
          событий · {photos.length} фотографий · {documents.length} документов
        </p>
        {!!events.length && (
          <section>
            <h3>События</h3>
            <div className="related-events">
              {events.map((e) => (
                <button
                  key={e.id}
                  onClick={() => {
                    onClose();
                    event?.(e.id);
                  }}
                >
                  {e.cover_media_id || e.media_ids?.[0] ? (
                    <MediaImage id={e.cover_media_id || e.media_ids[0]} alt={e.title} />
                  ) : (
                    <CalendarDays size={28} />
                  )}
                  <span>
                    <strong>{e.title}</strong>
                    <small>
                      {dateLabel(e.start_date || e.date_text || '')}
                      {e.end_date ? ' — ' + dateLabel(e.end_date) : ''}
                    </small>
                    {e.place && <small>{e.place}</small>}
                    {e.description && <small className="material-description">{e.description}</small>}
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}
        {!!photos.length && (
          <section>
            <h3>Фотографии</h3>
            <div className="related-photos">
              {photos.map((m) => (
                <button
                  key={m.id}
                  onClick={() => {
                    onClose();
                    photo(m.id);
                  }}
                >
                  <MediaImage id={m.id} alt={m.title} />
                  <span>
                    <strong>{m.title}</strong>
                    <small>
                      {mediaDateLabel(m)}
                      {m.place ? ' · ' + m.place : ''}
                    </small>
                    {linked.has(m.id) && (
                      <small>
                        <Images size={13} /> Фотография события
                      </small>
                    )}
                    {m.description && <small className="material-description">{m.description}</small>}
                    {m.comment && <small className="material-description">{m.comment}</small>}
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}
        {!!documents.length && (
          <section>
            <h3>Документы</h3>
            <div className="related-photos">
              {documents.map((m) => (
                <button
                  key={m.id}
                  onClick={() => {
                    onClose();
                    photo(m.id);
                  }}
                >
                  {m.mime?.startsWith('image/') ? (
                    <MediaImage id={m.id} alt={m.title} />
                  ) : (
                    <div className="related-file-cover">
                      <FileText size={44} />
                      <small>{m.filename}</small>
                    </div>
                  )}
                  <span>
                    <strong>{m.title}</strong>
                    <small>
                      {mediaDateLabel(m)}
                      {m.place ? ' · ' + m.place : ''}
                    </small>
                    {m.description && <small className="material-description">{m.description}</small>}
                    {m.comment && <small className="material-description">{m.comment}</small>}
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}
        {!events.length && !photos.length && !documents.length && (
          <Empty>
            К этому {selection.kind === 'date' ? 'периоду' : 'месту'} пока не привязаны события и фотографии.
          </Empty>
        )}
      </div>
    </Modal>
  );
}
