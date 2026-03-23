<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import type { Map as LeafletMap, Marker, Polyline, Icon } from 'leaflet';

  export let apiBase: string;
  export let onSelect: (icao24: string) => void = () => {};

  interface Aircraft {
    icao24: string;
    callsign: string | null;
    latitude: number;
    longitude: number;
    altitude: number | null;
    velocity: number | null;
    heading: number | null;
    on_ground: number | null;
    ts: number;
  }

  let mapEl: HTMLDivElement;
  let map: LeafletMap;
  let markers: Map<string, Marker> = new Map();
  let trackLine: Polyline | null = null;
  let L: typeof import('leaflet');
  let planeIcon: Icon;
  let selectedIcon: Icon;
  let pollTimer: ReturnType<typeof setInterval>;

  const PERAK_CENTER: [number, number] = [4.8, 100.7];

  onMount(async () => {
    L = (await import('leaflet')).default;

    // Leaflet CSS — inject at runtime (SSR-safe)
    if (!document.getElementById('leaflet-css')) {
      const link = document.createElement('link');
      link.id = 'leaflet-css';
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(link);
    }

    map = L.map(mapEl).setView(PERAK_CENTER, 8);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 18,
    }).addTo(map);

    // Draw Perak bounding box for reference
    L.rectangle([[3.5, 99.5], [6.0, 102.0]], {
      color: '#3b82f6',
      weight: 1.5,
      fillOpacity: 0.04,
    }).addTo(map);

    planeIcon = L.divIcon({
      className: 'plane-marker-wrap',
      html: `<div class="plane-marker"><span class="plane-symbol">✈</span></div>`,
      iconSize: [36, 36],
      iconAnchor: [18, 18],
    });

    selectedIcon = L.divIcon({
      className: 'plane-marker-wrap selected-wrap',
      html: `<div class="plane-marker selected"><span class="plane-symbol">✈</span></div>`,
      iconSize: [44, 44],
      iconAnchor: [22, 22],
    });

    await fetchLatest();
    pollTimer = setInterval(fetchLatest, 60_000);
  });

  onDestroy(() => {
    clearInterval(pollTimer);
    map?.remove();
  });

  async function fetchLatest() {
    try {
      const res = await fetch(`${apiBase}/api/latest`);
      if (!res.ok) return;
      const json = await res.json() as { data: Aircraft[] };
      updateMarkers(json.data ?? []);
    } catch {
      // silently ignore network errors on poll
    }
  }

  function updateMarkers(aircraft: Aircraft[]) {
    const seen = new Set<string>();

    for (const ac of aircraft) {
      seen.add(ac.icao24);
      const label = `
        <b>${ac.callsign ?? ac.icao24}</b><br/>
        Alt: ${ac.altitude != null ? Math.round(ac.altitude) + ' m' : 'N/A'}<br/>
        Speed: ${ac.velocity != null ? Math.round(ac.velocity) + ' m/s' : 'N/A'}<br/>
        ${ac.on_ground ? '🟡 On Ground' : '🟢 Airborne'}
      `;

      if (markers.has(ac.icao24)) {
        markers.get(ac.icao24)!.setLatLng([ac.latitude, ac.longitude]).setPopupContent(label);
      } else {
        const m = L.marker([ac.latitude, ac.longitude], { icon: planeIcon })
          .bindPopup(label)
          .on('click', () => {
            onSelect(ac.icao24);
          })
          .addTo(map);
        markers.set(ac.icao24, m);
      }
    }

    // Remove stale markers
    for (const [icao24, marker] of markers) {
      if (!seen.has(icao24)) {
        marker.remove();
        markers.delete(icao24);
      }
    }
  }

  export async function showTrack(icao24: string, from: number, to: number) {
    try {
      const res = await fetch(`${apiBase}/api/history?icao24=${icao24}&from=${from}&to=${to}`);
      if (!res.ok) return;
      const json = await res.json() as { data: Aircraft[] };
      const points = json.data ?? [];

      trackLine?.remove();
      if (points.length < 2) return;

      const latlngs = points.map((p) => [p.latitude, p.longitude] as [number, number]);
      trackLine = L.polyline(latlngs, { color: '#f97316', weight: 2.5 }).addTo(map);
      map.fitBounds(trackLine.getBounds(), { padding: [30, 30] });

      // Highlight selected marker
      for (const [id, m] of markers) {
        m.setIcon(id === icao24 ? selectedIcon : planeIcon);
      }
    } catch {
      // ignore
    }
  }

  export function clearTrack() {
    trackLine?.remove();
    trackLine = null;
    for (const m of markers.values()) m.setIcon(planeIcon);
  }
</script>

<div bind:this={mapEl} class="map-container"></div>

<style>
  .map-container {
    width: 100%;
    height: 100%;
    min-height: 400px;
    border-radius: 0.5rem;
    overflow: hidden;
  }

  :global(.plane-marker-wrap) {
    display: flex;
    align-items: center;
    justify-content: center;
  }

  :global(.plane-marker) {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    background: #fff;
    border: 2px solid #1e293b;
    border-radius: 50%;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
    cursor: pointer;
    user-select: none;
    transition: transform 0.2s, box-shadow 0.2s;
  }

  :global(.plane-marker:hover) {
    transform: scale(1.1);
    box-shadow: 0 3px 12px rgba(0, 0, 0, 0.5);
  }

  :global(.plane-marker .plane-symbol) {
    font-size: 20px;
    line-height: 1;
    color: #1e293b;
    filter: drop-shadow(0 0 1px rgba(255, 255, 255, 0.8));
  }

  :global(.plane-marker.selected) {
    width: 44px;
    height: 44px;
    border-width: 3px;
    border-color: #f97316;
    box-shadow: 0 0 0 2px #fff, 0 2px 12px rgba(249, 115, 22, 0.6);
  }

  :global(.plane-marker.selected .plane-symbol) {
    font-size: 24px;
  }

  :global(.plane-marker-wrap.selected-wrap .plane-marker) {
    width: 44px;
    height: 44px;
  }
</style>
