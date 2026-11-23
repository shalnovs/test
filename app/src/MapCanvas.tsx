import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import land from './map-data/land.json';
import type { MapPoint } from './placeData';

export function MapCanvas({
  points = [],
  selected = '',
  onSelect,
  onPick,
  center,
}: {
  points?: MapPoint[];
  selected?: string;
  onSelect?: (id: string) => void;
  onPick?: (lat: number, lon: number) => void;
  center?: [number, number];
}) {
  const host = useRef<HTMLDivElement>(null),
    map = useRef<L.Map | null>(null),
    markers = useRef<L.LayerGroup | null>(null);
  const landLayer = useRef<L.GeoJSON | null>(null);
  const fitted = useRef(false);
  const pick = useRef(onPick);
  pick.current = onPick;
  const select = useRef(onSelect);
  select.current = onSelect;
  const [online, setOnline] = useState(false),
    [tileError, setTileError] = useState(false);
  const pointKey = JSON.stringify(points),
    centerKey = JSON.stringify(center);
  useEffect(() => {
    const m = L.map(host.current!, {
      center: [50, 45],
      zoom: 3,
      minZoom: 2,
      maxZoom: 18,
      worldCopyJump: true,
    });
    map.current = m;
    fitted.current = false;
    landLayer.current = L.geoJSON(land as any, {
      style: { color: '#a4b69a', weight: 1, fillColor: '#e4eadb', fillOpacity: 1 },
    }).addTo(m);
    m.attributionControl.addAttribution('Natural Earth · Public domain');
    markers.current = L.layerGroup().addTo(m);
    m.on('click', (e: L.LeafletMouseEvent) =>
      pick.current?.(e.latlng.lat, ((((e.latlng.lng + 180) % 360) + 360) % 360) - 180),
    );
    const observer = new ResizeObserver(() => m.invalidateSize());
    observer.observe(host.current!);
    return () => {
      observer.disconnect();
      m.remove();
      map.current = null;
    };
  }, []);
  useEffect(() => {
    if (!online || !map.current) return;
    setTileError(false);
    landLayer.current?.remove();
    const layer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution:
        '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors',
      referrerPolicy: 'strict-origin-when-cross-origin',
    }).addTo(map.current);
    layer.on('tileerror', () => {
      setTileError(true);
      setOnline(false);
    });
    return () => {
      layer.remove();
      if (map.current) landLayer.current?.addTo(map.current);
    };
  }, [online]);
  useEffect(() => {
    if (!map.current || !markers.current) return;
    markers.current.clearLayers();
    points.forEach((p) => {
      const text = document.createElement('span');
      text.textContent = p.title + (p.approximate ? ' · центр населённого пункта' : '');
      L.circleMarker([p.lat, p.lon], {
        radius: p.id === selected ? 11 : 7,
        color: p.id === selected ? '#ad6e24' : '#315e4e',
        weight: 3,
        fillColor: p.id === selected ? '#efc982' : '#6b9477',
        fillOpacity: 0.95,
      })
        .addTo(markers.current!)
        .bindTooltip(text, { direction: 'top' })
        .on('click', (e) => {
          L.DomEvent.stopPropagation(e.originalEvent);
          select.current?.(p.id);
        });
    });
    if (points.length && !center && (!pick.current || !fitted.current)) {
      const bounds = L.latLngBounds(points.map((p) => [p.lat, p.lon] as [number, number]));
      map.current.fitBounds(bounds, { padding: [40, 40], maxZoom: 7, animate: false });
    }
    fitted.current = true;
  }, [pointKey]);
  useEffect(() => {
    if (center && map.current)
      map.current.setView(center, Math.max(7, map.current.getZoom()), { animate: true });
  }, [centerKey]);
  useEffect(() => {
    if (!map.current || !markers.current) return;
    let i = 0;
    markers.current.eachLayer((layer) => {
      const p = points[i++];
      if (layer instanceof L.CircleMarker) {
        layer.setRadius(p.id === selected ? 11 : 7);
        layer.setStyle({
          color: p.id === selected ? '#ad6e24' : '#315e4e',
          fillColor: p.id === selected ? '#efc982' : '#6b9477',
        });
      }
    });
    const point = points.find((p) => p.id === selected);
    if (point) map.current.panTo([point.lat, point.lon]);
  }, [selected, pointKey]);
  return (
    <div className="map-shell">
      <div ref={host} className="family-map" role="region" aria-label="Карта семейной истории" />
      <div className="map-controls">
        <button
          type="button"
          className={online ? 'active' : ''}
          aria-pressed={online}
          onClick={() => setOnline(!online)}
        >
          {online ? 'Подробная карта включена' : 'Подробная карта · интернет'}
        </button>
        <span>
          {onPick
            ? 'Нажмите на карту, чтобы выбрать точку'
            : 'Нажмите на точку, чтобы увидеть события и фотографии'}
        </span>
      </div>
      {tileError && (
        <p className="muted">Подробная карта недоступна. События и локальная карта остаются доступны.</p>
      )}
    </div>
  );
}
