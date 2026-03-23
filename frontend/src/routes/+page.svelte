<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { browser } from '$app/environment';

  // Dynamic imports to avoid SSR issues with Leaflet
  let MapComponent: typeof import('$lib/Map.svelte').default | null = $state(null);
  let ChartsComponent: typeof import('$lib/Charts.svelte').default | null = $state(null);

  // Read API base from env (set PUBLIC_API_BASE in .env or Vercel)
  const API_BASE = (typeof window !== 'undefined' && (window as unknown as Record<string, string>).__API_BASE__)
    || import.meta.env.PUBLIC_API_BASE
    || 'http://localhost:3000';

  // State
  let selectedIcao: string | null = $state(null);
  let mapRef: { showTrack: (i: string, f: number, t: number) => void; clearTrack: () => void } | null = $state(null);
  let chartsRef: { loadAnalytics: () => void; loadAltitudeTrend: (i: string, f: number, t: number) => void } | null = $state(null);

  // Time range — default last 24 h
  const now = () => Math.floor(Date.now() / 1000);
  let fromTs = $state(now() - 86_400);
  let toTs = $state(now());

  // Human-readable dates for inputs
  function tsToDatetimeLocal(ts: number): string {
    const d = new Date(ts * 1000);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function datetimeLocalToTs(val: string): number {
    return Math.floor(new Date(val).getTime() / 1000);
  }

  let fromInput = $state(tsToDatetimeLocal(fromTs));
  let toInput = $state(tsToDatetimeLocal(toTs));

  // Live stats
  interface Stats {
    totalRecords: number | null;
    uniqueAircraft: number | null;
    lastPoll: string;
  }
  let stats: Stats = $state({ totalRecords: null, uniqueAircraft: null, lastPoll: '—' });

  async function fetchStats() {
    try {
      const res = await fetch(`${API_BASE}/api/latest`);
      if (!res.ok) return;
      const json = await res.json() as { count: number; data: { icao24: string }[] };
      stats.uniqueAircraft = json.count;
      stats.lastPoll = new Date().toLocaleTimeString();
    } catch {
      // ignore
    }
  }

  let statsTimer: ReturnType<typeof setInterval>;

  onMount(async () => {
    const [mapMod, chartsMod] = await Promise.all([
      import('$lib/Map.svelte'),
      import('$lib/Charts.svelte'),
    ]);
    MapComponent = mapMod.default;
    ChartsComponent = chartsMod.default;

    fetchStats();
    statsTimer = setInterval(fetchStats, 60_000);
  });

  onDestroy(() => {
    clearInterval(statsTimer);
  });

  function handleAircraftSelect(icao24: string) {
    selectedIcao = icao24;
    mapRef?.showTrack(icao24, fromTs, toTs);
    chartsRef?.loadAltitudeTrend(icao24, fromTs, toTs);
  }

  function handleApplyFilter() {
    fromTs = datetimeLocalToTs(fromInput);
    toTs = datetimeLocalToTs(toInput);
    if (selectedIcao) {
      mapRef?.showTrack(selectedIcao, fromTs, toTs);
      chartsRef?.loadAltitudeTrend(selectedIcao, fromTs, toTs);
    }
    chartsRef?.loadAnalytics();
  }

  function handleClearSelection() {
    selectedIcao = null;
    mapRef?.clearTrack();
  }
</script>

<div class="app">
  <!-- Header -->
  <header class="header">
    <div class="header-left">
      <span class="header-icon">✈</span>
      <div>
        <h1>Perak Aircraft Monitor</h1>
        <p class="subtitle">IoT Data Acquisition System — TFB2093</p>
      </div>
    </div>
    <div class="header-stats">
      <div class="stat-pill">
        <span class="stat-label">Visible Now</span>
        <span class="stat-value">{stats.uniqueAircraft ?? '—'}</span>
      </div>
      <div class="stat-pill">
        <span class="stat-label">Last Poll</span>
        <span class="stat-value">{stats.lastPoll}</span>
      </div>
    </div>
  </header>

  <!-- Filter Bar -->
  <div class="filter-bar">
    <label class="filter-group">
      <span>From</span>
      <input type="datetime-local" bind:value={fromInput} />
    </label>
    <label class="filter-group">
      <span>To</span>
      <input type="datetime-local" bind:value={toInput} />
    </label>
    <button class="btn-primary" onclick={handleApplyFilter}>Apply Filter</button>
    {#if selectedIcao}
      <div class="selected-badge">
        <span>Selected: <strong>{selectedIcao}</strong></span>
        <button class="btn-ghost" onclick={handleClearSelection}>✕ Clear</button>
      </div>
    {/if}
  </div>

  <!-- Main Content -->
  <div class="main-content">
    <!-- Map Panel -->
    <div class="map-panel">
      <div class="panel-header">
        <h2>Live Map — Perak Airspace</h2>
        <span class="badge">Refreshes every 60s</span>
      </div>
      {#if browser && MapComponent}
        <div class="map-wrapper">
          <MapComponent
            bind:this={mapRef}
            apiBase={API_BASE}
            onSelect={handleAircraftSelect}
          />
        </div>
      {:else}
        <div class="placeholder">Loading map…</div>
      {/if}

      {#if selectedIcao}
        <div class="track-info">
          Showing historical track for <strong>{selectedIcao}</strong>
          from {new Date(fromTs * 1000).toLocaleString()} to {new Date(toTs * 1000).toLocaleString()}
        </div>
      {/if}
    </div>

    <!-- Charts Panel -->
    <div class="charts-panel">
      <div class="panel-header">
        <h2>Analytics</h2>
        <span class="badge">{new Date(fromTs * 1000).toLocaleDateString()} — {new Date(toTs * 1000).toLocaleDateString()}</span>
      </div>
      {#if browser && ChartsComponent}
        <ChartsComponent
          bind:this={chartsRef}
          apiBase={API_BASE}
          selectedIcao={selectedIcao}
          fromTs={fromTs}
          toTs={toTs}
        />
      {:else}
        <div class="placeholder">Loading charts…</div>
      {/if}
    </div>
  </div>

  <footer class="footer">
    Perak bounding box: 3.5°N–6.0°N, 99.5°E–102.0°E · Data: OpenSky Network · TFB2093 IoT Project
  </footer>
</div>

<style>
  .app {
    display: flex;
    flex-direction: column;
    min-height: 100vh;
    padding: 0;
  }

  /* Header */
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1rem 1.5rem;
    background: #1e293b;
    border-bottom: 1px solid #334155;
    gap: 1rem;
    flex-wrap: wrap;
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .header-icon {
    font-size: 2rem;
    line-height: 1;
  }

  h1 {
    font-size: 1.25rem;
    font-weight: 700;
    color: #f1f5f9;
  }

  .subtitle {
    font-size: 0.75rem;
    color: #64748b;
  }

  .header-stats {
    display: flex;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .stat-pill {
    background: #0f172a;
    border: 1px solid #334155;
    border-radius: 2rem;
    padding: 0.35rem 0.9rem;
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  .stat-label {
    font-size: 0.65rem;
    color: #64748b;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .stat-value {
    font-size: 1rem;
    font-weight: 700;
    color: #38bdf8;
  }

  /* Filter Bar */
  .filter-bar {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.75rem 1.5rem;
    background: #1e293b;
    border-bottom: 1px solid #334155;
    flex-wrap: wrap;
  }

  .filter-group {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    font-size: 0.75rem;
    color: #94a3b8;
  }

  .filter-group input {
    background: #0f172a;
    border: 1px solid #334155;
    border-radius: 0.375rem;
    color: #e2e8f0;
    padding: 0.35rem 0.6rem;
    font-size: 0.8rem;
    outline: none;
  }

  .filter-group input:focus {
    border-color: #3b82f6;
  }

  .btn-primary {
    background: #3b82f6;
    color: white;
    border: none;
    border-radius: 0.375rem;
    padding: 0.45rem 1rem;
    font-size: 0.85rem;
    font-weight: 600;
    align-self: flex-end;
    transition: background 0.15s;
  }

  .btn-primary:hover {
    background: #2563eb;
  }

  .selected-badge {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    background: rgba(249, 115, 22, 0.15);
    border: 1px solid rgba(249, 115, 22, 0.4);
    border-radius: 0.375rem;
    padding: 0.35rem 0.75rem;
    font-size: 0.8rem;
    color: #fb923c;
    align-self: flex-end;
  }

  .btn-ghost {
    background: none;
    border: none;
    color: #fb923c;
    font-size: 0.8rem;
    padding: 0;
    opacity: 0.7;
  }

  .btn-ghost:hover {
    opacity: 1;
  }

  /* Main Content */
  .main-content {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0;
    flex: 1;
    padding: 1rem 1.5rem;
    gap: 1rem;
  }

  .map-panel,
  .charts-panel {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .panel-header h2 {
    font-size: 1rem;
    font-weight: 600;
    color: #cbd5e1;
  }

  .badge {
    font-size: 0.7rem;
    background: #1e293b;
    border: 1px solid #334155;
    border-radius: 1rem;
    padding: 0.2rem 0.6rem;
    color: #64748b;
  }

  .map-wrapper {
    flex: 1;
    min-height: 450px;
    border-radius: 0.5rem;
    overflow: hidden;
  }

  .track-info {
    font-size: 0.78rem;
    color: #94a3b8;
    background: rgba(249, 115, 22, 0.08);
    border: 1px solid rgba(249, 115, 22, 0.2);
    border-radius: 0.375rem;
    padding: 0.5rem 0.75rem;
  }

  .placeholder {
    background: #1e293b;
    border-radius: 0.5rem;
    min-height: 400px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #64748b;
  }

  .footer {
    text-align: center;
    font-size: 0.7rem;
    color: #475569;
    padding: 0.75rem;
    border-top: 1px solid #1e293b;
  }

  @media (max-width: 900px) {
    .main-content {
      grid-template-columns: 1fr;
    }
  }
</style>
