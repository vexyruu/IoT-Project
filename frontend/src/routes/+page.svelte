<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { browser } from '$app/environment';
  import { PUBLIC_API_BASE } from '$env/static/public';

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

  interface TelemetryEntry {
    kind: 'ok' | 'error';
    action: string;
    detail: string;
    time: string;
  }

  let MapComponent: typeof import('$lib/Map.svelte').default | null = $state(null);
  let ChartsComponent: typeof import('$lib/Charts.svelte').default | null = $state(null);

  const API_BASE = PUBLIC_API_BASE || 'http://localhost:3000';

  let selectedIcao: string | null = $state(null);
  let selectedAircraft: Aircraft | null = $state(null);
  let latestAircraftList: Aircraft[] = $state([]);
  let telemetryLog: TelemetryEntry[] = $state([]);

  let chartsRef: { loadAnalytics: () => void; loadAltitudeTrend: (i: string, f: number, t: number) => void } | null = $state(null);

  const now = () => Math.floor(Date.now() / 1000);
  const fromTs = now() - 86_400;
  const toTs   = now();

  interface Stats { uniqueAircraft: number | null; lastPoll: string; }
  let stats: Stats = $state({ uniqueAircraft: null, lastPoll: '—' });

  function metersToFeet(m: number | null): string {
    if (m == null) return '—';
    return `${Math.round(m * 3.28084).toLocaleString()} FT`;
  }
  function msToKnots(ms: number | null): string {
    if (ms == null) return '—';
    return `${Math.round(ms * 1.94384)} KTS`;
  }
  function headingToCompass(h: number | null): string {
    if (h == null) return '—';
    const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
    return `${Math.round(h)}° ${dirs[Math.round(h / 22.5) % 16]}`;
  }
  function utcTime(): string {
    return new Date().toLocaleTimeString('en-GB', { hour12: false, timeZone: 'UTC' });
  }
  function metersToFeetShort(m: number | null): string {
    if (m == null) return 'N/A';
    const ft = Math.round(m * 3.28084);
    return ft >= 1000 ? `${Math.round(ft / 1000)}K` : `${ft}`;
  }
  function systemStatus(): 'RUNNING' | 'STANDBY' | 'NO DATA' {
    if (stats.uniqueAircraft === null) return 'STANDBY';
    if (stats.uniqueAircraft === 0)    return 'NO DATA';
    return 'RUNNING';
  }
  function statusColor(): string {
    const s = systemStatus();
    if (s === 'RUNNING')  return 'var(--secondary)';
    if (s === 'STANDBY')  return 'var(--tertiary)';
    return 'var(--error)';
  }

  async function fetchStats() {
    const t = utcTime();
    try {
      const res = await fetch(`${API_BASE}/api/latest`);
      if (!res.ok) {
        const err: TelemetryEntry = { kind: 'error', action: 'DROP: API', detail: `HTTP ${res.status}`, time: t };
        telemetryLog = [err, ...telemetryLog].slice(0, 8);
        return;
      }
      const json = await res.json() as { count: number; data: Aircraft[] };
      stats.uniqueAircraft = json.count;
      stats.lastPoll = utcTime() + ' UTC';
      latestAircraftList = json.data ?? [];
      const entries: TelemetryEntry[] = latestAircraftList.slice(0, 3).map((ac) => {
        const id = (ac.callsign?.trim() || ac.icao24).toUpperCase();
        return {
          kind: 'ok',
          action: `RCV: ${id}`,
          detail: `ALT: ${metersToFeetShort(ac.altitude)}`,
          time: t,
        };
      });
      telemetryLog = [...entries, ...telemetryLog].slice(0, 8);
    } catch {
      const err: TelemetryEntry = { kind: 'error', action: 'DROP: SVC', detail: 'NET FAIL', time: t };
      telemetryLog = [err, ...telemetryLog].slice(0, 8);
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

  onDestroy(() => clearInterval(statsTimer));

  function handleAircraftSelect(aircraft: Aircraft) {
    selectedIcao = aircraft.icao24;
    selectedAircraft = aircraft;
    chartsRef?.loadAltitudeTrend(aircraft.icao24, fromTs, toTs);
  }
  function handleClearSelection() {
    selectedIcao = null;
    selectedAircraft = null;
  }
</script>

<div class="app">

  <header class="header">
    <div class="header-left">
      <span class="header-title">Perak Aircraft Monitor</span>
      <div class="header-divider"></div>
      <div class="header-meta">
        <span class="header-sub">IoT Data Acquisition System — TFB2093</span>
        <span class="header-status" style="color:{statusColor()}">
          System Status: {systemStatus()}
        </span>
      </div>
    </div>
    <div class="header-right">
      <div class="last-poll-pill">
        <span class="material-symbols-outlined lp-icon">schedule</span>
        <span class="lp-text">Last Poll: {stats.lastPoll}</span>
      </div>
      {#if selectedIcao}
        <div class="selected-badge">
          <span>Selected: ICAO24 ({(selectedAircraft?.callsign?.trim() || selectedIcao).toUpperCase()})</span>
          <button class="btn-dismiss" onclick={handleClearSelection}>
            <span class="material-symbols-outlined" style="font-size:14px;line-height:1;">close</span>
          </button>
        </div>
      {/if}
    </div>
  </header>

  <div class="content">

    <div class="panel map-panel">
      <div class="panel-header">
        <div>
          <h2 class="panel-title">Live Map — Perak Airspace</h2>
          <p class="panel-sub">Refreshes every 60s</p>
        </div>
        <div class="live-feed">
          <span class="live-dot"></span>
          <span class="live-text">LIVE FEED</span>
        </div>
      </div>

      <div class="map-wrapper">
        {#if browser && MapComponent}
          <MapComponent
            apiBase={API_BASE}
            selectedIcao={selectedIcao}
            onSelect={handleAircraftSelect}
          />
          {#if selectedAircraft}
            <div class="track-overlay">
              <div class="to-header">
                <span class="to-label">Selected Track</span>
                <span class="to-icao">{(selectedAircraft.callsign?.trim() || selectedAircraft.icao24).toUpperCase()}</span>
              </div>
              <div class="to-row">
                <span class="to-key">ALTITUDE</span>
                <span class="to-val">{metersToFeet(selectedAircraft.altitude)}</span>
              </div>
              <div class="to-row">
                <span class="to-key">VELOCITY</span>
                <span class="to-val">{msToKnots(selectedAircraft.velocity)}</span>
              </div>
              <div class="to-row">
                <span class="to-key">HEADING</span>
                <span class="to-val">{headingToCompass(selectedAircraft.heading)}</span>
              </div>
            </div>
          {/if}
        {:else}
          <div class="map-placeholder">Initialising map…</div>
        {/if}
      </div>
    </div>

    <div class="analytics-outer">
      <div class="panel analytics-panel">
        <div class="analytics-header">
          <h2 class="panel-title">Analytics Engine</h2>
        </div>

        <div class="analytics-body">
          <div class="charts-wrapper">
            {#if browser && ChartsComponent}
              <ChartsComponent
                bind:this={chartsRef}
                apiBase={API_BASE}
                selectedIcao={selectedIcao}
                fromTs={fromTs}
                toTs={toTs}
                latestAircraft={latestAircraftList}
              />
            {:else}
              <div class="placeholder">Loading analytics…</div>
            {/if}
          </div>

          <div class="telem-section">
            <div class="telem-header">
              <span class="material-symbols-outlined telem-icon">list_alt</span>
              <span class="telem-title">Recent Telemetry Packets</span>
            </div>
            <div class="telem-list">
              {#if telemetryLog.length === 0}
                <div class="telem-empty">Awaiting first poll…</div>
              {:else}
                {#each telemetryLog as entry}
                  <div class="telem-row">
                    <span class="telem-badge" class:telem-ok={entry.kind === 'ok'} class:telem-err={entry.kind === 'error'}>
                      {entry.kind === 'ok' ? '[OK]' : '[ERR]'}
                    </span>
                    <span class="telem-action">{entry.action}</span>
                    <span class="telem-detail">{entry.detail}</span>
                    <span class="telem-time">{entry.time}</span>
                  </div>
                {/each}
              {/if}
            </div>
          </div>
        </div>
      </div>
    </div>

  </div>

  <footer class="footer">
    <div class="footer-left">
      <span class="footer-key">Bounding Box:</span>
      <span class="footer-val">[3.5, 99.5, 6.0, 102.0]</span>
      <span class="footer-key">Data:</span>
      <span class="footer-link">OpenSky Network</span>
    </div>
    <div class="footer-right">
    </div>
  </footer>

</div>

<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@100..900&family=Roboto+Mono:wght@400;500;700&display=swap');
  @import url('https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap');

  /* colors & vars */
  :global(:root) {
    --bg:           #101418;
    --sc-lowest:    #0a0f13;
    --sc-low:       #181c21;
    --sc:           #1c2025;
    --sc-high:      #262a2f;
    --sc-highest:   #31353a;
    --on-surface:   #e0e2e9;
    --on-surface-v: #c0c6d6;
    --primary:      #aac7ff;
    --primary-c:    #3e90ff;
    --on-primary-c: #002957;
    --secondary:    #66dd8b;
    --tertiary:     #fbbc00;
    --outline:      #8b91a0;
    --outline-v:    #414754;
    --error:        #ffb4ab;
    --slate-400:    #94a3b8;
    --slate-500:    #64748b;
    --slate-600:    #475569;
  }

  :global(*, *::before, *::after) { box-sizing: border-box; margin: 0; padding: 0; }
  :global(html, body) {
    height: 100%;
    overflow: hidden;
    background: var(--bg);
    font-family: 'Inter', system-ui, sans-serif;
    color: var(--on-surface);
  }
  :global(button) { cursor: pointer; }
  :global(.material-symbols-outlined) {
    font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24;
    font-family: 'Material Symbols Outlined';
    font-style: normal;
    display: inline-block;
    line-height: 1;
    letter-spacing: normal;
    word-wrap: normal;
    white-space: nowrap;
    direction: ltr;
  }
  :global(::-webkit-scrollbar) { width: 4px; }
  :global(::-webkit-scrollbar-track) { background: #101418; }
  :global(::-webkit-scrollbar-thumb) { background: #31353a; border-radius: 2px; }

  /* app shell */
  .app {
    display: flex;
    flex-direction: column;
    height: 100vh;
    overflow: hidden;
    background: var(--bg);
  }

  /* header */
  .header {
    flex-shrink: 0;
    height: 56px;
    background: var(--bg);
    border-bottom: 1px solid rgba(65, 71, 84, 0.2);
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 1.5rem;
    gap: 1rem;
    z-index: 50;
  }
  .header-left  { display: flex; align-items: center; gap: 1rem; }
  .header-right { display: flex; align-items: center; gap: 0.75rem; flex-shrink: 0; }

  .header-title {
    font-size: 1.1rem;
    font-weight: 700;
    letter-spacing: -0.02em;
    color: var(--primary);
    text-transform: uppercase;
    white-space: nowrap;
  }
  .header-divider {
    width: 1px;
    height: 16px;
    background: rgba(65, 71, 84, 0.3);
    flex-shrink: 0;
  }
  .header-meta {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .header-sub {
    font-size: 0.72rem;
    font-weight: 500;
    color: var(--slate-400);
    letter-spacing: -0.01em;
  }
  .header-status {
    font-family: 'Roboto Mono', monospace;
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  .last-poll-pill {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.25rem 0.75rem;
    background: var(--sc-low);
    border-radius: 4px;
  }
  .lp-icon {
    font-size: 14px !important;
    color: var(--tertiary);
  }
  .lp-text {
    font-family: 'Roboto Mono', monospace;
    font-size: 0.68rem;
    color: var(--on-surface-v);
    white-space: nowrap;
  }

  .selected-badge {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    background: rgba(170, 199, 255, 0.1);
    border: 1px solid rgba(170, 199, 255, 0.3);
    border-radius: 12px;
    padding: 0.25rem 0.75rem;
    font-family: 'Roboto Mono', monospace;
    font-size: 0.7rem;
    font-weight: 700;
    color: var(--primary);
  }
  .btn-dismiss {
    background: none;
    border: none;
    color: var(--primary);
    padding: 0;
    display: flex;
    align-items: center;
    opacity: 0.8;
    transition: opacity 0.1s, color 0.1s;
  }
  .btn-dismiss:hover { opacity: 1; color: white; }

  /* main grid */
  .content {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: 3fr 2fr;
    gap: 1.5rem;
    padding: 1.5rem;
    background: var(--sc-low);
    overflow: hidden;
  }

  /* shared panel styles */
  .panel {
    background: var(--sc);
    border-radius: 4px;
    border: 1px solid rgba(65, 71, 84, 0.05);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    min-height: 0;
  }

  .panel-header {
    flex-shrink: 0;
    padding: 1rem;
    border-bottom: 1px solid rgba(65, 71, 84, 0.1);
    background: rgba(38, 42, 47, 0.5);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
  }
  .panel-title {
    font-size: 0.85rem;
    font-weight: 700;
    letter-spacing: 0.02em;
    text-transform: uppercase;
    color: var(--on-surface);
  }
  .panel-sub {
    font-size: 0.68rem;
    color: var(--slate-500);
    margin-top: 0.15rem;
  }

  .live-feed {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    flex-shrink: 0;
  }
  .live-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--secondary);
    animation: pulse 2s ease infinite;
  }
  .live-text {
    font-family: 'Roboto Mono', monospace;
    font-size: 0.68rem;
    color: var(--secondary);
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50%       { opacity: 0.4; }
  }

  /* map */
  .map-wrapper {
    flex: 1;
    min-height: 0;
    position: relative;
    background: var(--sc-lowest);
  }

  /* floating info box over the map when an aircraft is selected */
  .track-overlay {
    position: absolute;
    top: 16px;
    left: 16px;
    z-index: 1000;
    background: rgba(49, 53, 58, 0.6);
    backdrop-filter: blur(20px);
    border: 1px solid rgba(65, 71, 84, 0.2);
    border-radius: 8px;
    padding: 0.75rem;
    width: 192px;
  }
  .to-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 0.5rem;
  }
  .to-label {
    font-size: 0.65rem;
    font-weight: 700;
    color: var(--primary);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .to-icao {
    font-family: 'Roboto Mono', monospace;
    font-size: 0.6rem;
    color: var(--tertiary);
  }
  .to-row {
    display: flex;
    justify-content: space-between;
    margin-top: 0.3rem;
  }
  .to-key {
    font-size: 0.65rem;
    color: var(--slate-400);
  }
  .to-val {
    font-family: 'Roboto Mono', monospace;
    font-size: 0.65rem;
    color: var(--on-surface);
  }

  /* analytics panel */
  .analytics-outer {
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow: hidden;
  }
  .analytics-panel {
    flex: 1;
    overflow: hidden;
  }
  .analytics-header {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1.25rem 1.25rem 1rem;
    gap: 0.5rem;
  }
  .analytics-body {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    padding: 0 1.25rem 1.25rem;
  }

  .charts-wrapper {
    flex-shrink: 0;
    padding-bottom: 0;
  }

  /* telemetry log */
  .telem-section {
    flex: 1;
    min-height: 0;
    margin-top: 1.5rem;
    background: var(--sc-lowest);
    border-radius: 4px;
    border: 1px solid rgba(65, 71, 84, 0.1);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .telem-header {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.6rem 1rem;
    border-bottom: 1px solid rgba(65, 71, 84, 0.1);
    background: rgba(38, 42, 47, 0.35);
  }
  .telem-icon {
    font-size: 16px !important;
    color: var(--slate-500);
  }
  .telem-title {
    font-size: 0.65rem;
    font-weight: 700;
    color: var(--slate-400);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .telem-list {
    flex: 1;
    overflow-y: auto;
    scrollbar-width: thin;
    scrollbar-color: var(--sc-highest) var(--bg);
  }
  .telem-list::-webkit-scrollbar { width: 4px; }
  .telem-list::-webkit-scrollbar-thumb { background: var(--sc-highest); border-radius: 2px; }

  .telem-empty {
    padding: 1rem;
    font-family: 'Roboto Mono', monospace;
    font-size: 0.68rem;
    color: var(--slate-600);
    text-align: center;
  }

  .telem-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.4rem 1rem;
    border-bottom: 1px solid rgba(65, 71, 84, 0.05);
    font-family: 'Roboto Mono', monospace;
    font-size: 0.68rem;
  }
  .telem-row:last-child { border-bottom: none; }

  .telem-badge { font-weight: 700; flex-shrink: 0; }
  .telem-ok  { color: var(--secondary); }
  .telem-err { color: var(--tertiary); }
  .telem-action { color: var(--slate-400); flex: 1; }
  .telem-detail { color: var(--on-surface-v); }
  .telem-time   { color: var(--slate-500); flex-shrink: 0; }

  /* loading states */
  .map-placeholder, .placeholder {
    width: 100%;
    height: 100%;
    min-height: 200px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: 'Roboto Mono', monospace;
    font-size: 0.72rem;
    color: var(--slate-600);
    letter-spacing: 0.06em;
  }

  /* footer */
  .footer {
    flex-shrink: 0;
    height: 40px;
    background: var(--bg);
    border-top: 1px solid rgba(65, 71, 84, 0.05);
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 1.5rem;
    z-index: 40;
  }
  .footer-left, .footer-right {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }
  .footer-key {
    font-size: 0.65rem;
    font-weight: 700;
    color: var(--slate-600);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .footer-val {
    font-family: 'Roboto Mono', monospace;
    font-size: 0.65rem;
    color: var(--primary);
  }
  .footer-link {
    font-family: 'Roboto Mono', monospace;
    font-size: 0.65rem;
    color: var(--slate-400);
  }

  /* mobile */
  @media (max-width: 900px) {
    .content { grid-template-columns: 1fr; overflow-y: auto; }
    .header-meta { display: none; }
  }
</style>
