import { useState } from 'react';
import { MapPin } from 'lucide-react';
import type { Item } from './api';
import { Field } from './components';
import { MapCanvas, PlaceSearch } from './FamilyMap';
import { eventPoint } from './placeData';

export function LocationEditor({ value, onChange }: { value: Item; onChange: (value: Item) => void }) {
  const [open, setOpen] = useState(false),
    [center, setCenter] = useState<[number, number]>();
  const point = eventPoint(value);
  return (
    <div className="full media-location-editor">
      <Field label="Место съёмки или документа" wide>
        <input
          value={value.place || ''}
          placeholder="Город, адрес, название места…"
          onChange={(e) =>
            onChange({
              ...value,
              place: e.target.value,
              latitude: null,
              longitude: null,
              location_precision: '',
            })
          }
        />
      </Field>
      <PlaceSearch
        onChoose={(p) => {
          onChange({
            ...value,
            place: [p.name, p.district, p.region, p.id ? p.country : ''].filter(Boolean).join(', '),
            latitude: p.lat,
            longitude: p.lon,
            location_precision: 'settlement',
          });
          setCenter([p.lat, p.lon]);
        }}
      />
      <div className="location-status">
        <span>
          {point
            ? point.approximate
              ? 'На карте: центр населённого пункта'
              : 'Место отмечено на карте'
            : 'Выберите город, село или деревню из поиска либо укажите точку на карте'}
        </span>
        <button type="button" onClick={() => setOpen(!open)}>
          <MapPin size={16} />
          {open ? 'Свернуть карту' : 'Указать на карте'}
        </button>
      </div>
      {open && (
        <div className="event-location-editor">
          <MapCanvas
            points={point ? [point] : []}
            center={center}
            onPick={(lat, lon) =>
              onChange({
                ...value,
                latitude: +lat.toFixed(6),
                longitude: +lon.toFixed(6),
                location_precision: 'point',
              })
            }
          />
          <div className="coordinate-fields">
            {(
              [
                ['latitude', 'Широта', 90],
                ['longitude', 'Долгота', 180],
              ] as const
            ).map(([key, label, limit]) => (
              <Field key={key} label={label}>
                <input
                  type="number"
                  step="any"
                  min={-limit}
                  max={limit}
                  value={value[key] ?? ''}
                  onChange={(e) =>
                    onChange({
                      ...value,
                      [key]: e.target.value === '' ? null : Number(e.target.value),
                      location_precision: 'point',
                    })
                  }
                />
              </Field>
            ))}
          </div>
          <button
            type="button"
            onClick={() => onChange({ ...value, latitude: null, longitude: null, location_precision: '' })}
          >
            Убрать заданную точку
          </button>
        </div>
      )}
    </div>
  );
}
