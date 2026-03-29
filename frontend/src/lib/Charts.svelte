<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';
  import Chart from 'chart.js/auto';

  export let apiBase: string;
  export let selectedIcao: string | null = null;
  export let fromTs: number;
  export let toTs: number;
  export let latestAircraft: { altitude: number | null; on_ground: number | null; velocity: number | null }[] = [];

  interface AnalyticsData {
    flightsPerHour: { hour: string; count: number }[];
    altitudeStatus: { status: string; count: number }[];
    topIcao: { icao24: string; sightings: number }[];
  }

  interface HistoryPoint {
    ts: number;
    altitude: number | null;
    on_ground: number | null;
  }

  let flightsCanvas: HTMLCanvasElement;
  let altTrendCanvas: HTMLCanvasElement;
  let topIcaoCanvas: HTMLCanvasElement;

  let flightsChart: Chart | null = null;
  let altTrendChart: Chart | null = null;
  let topIcaoChart: Chart | null = null;

  let analyticsData: AnalyticsData | null = null;
  let loading = true;
  let error = '';

  let noFlightsData = false;
  let noTopIcaoData = false;
  let altTrendState: 'idle' | 'loading' | 'no-data' | 'on-ground' | 'ready' = 'idle';

  const C = {
    primary:       '#aac7ff',
    primary20:     'rgba(170, 199, 255, 0.20)',
    primary40:     'rgba(170, 199, 255, 0.40)',
    primary70:     'rgba(170, 199, 255, 0.70)',
    secondary:     '#66dd8b',
    tertiary:      '#fbbc00',
    scLow:         '#181c21',
    scHighest:     '#31353a',
    outlineVar:    '#414754',
    outlineVar15:  'rgba(65, 71, 84, 0.15)',
    outlineVar30:  'rgba(65, 71, 84, 0.30)',
    slate400:      '#94a3b8',
    slate500:      '#64748b',
    slate600:      '#475569',
    onSurface:     '#e0e2e9',
    onSurfaceVar:  '#c0c6d6',
  };

  onMount(() => { loadAnalytics(); });

  onDestroy(() => {
    flightsChart?.destroy();
    altTrendChart?.destroy();
    topIcaoChart?.destroy();
  });

  function formatHourLabel(raw: string): string {
    const [datePart, timePart] = raw.split(' ');
    if (!datePart || !timePart) return raw;
    const d = new Date(`${datePart}T${timePart}:00`);
    if (isNaN(d.getTime())) return raw;
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  }

  export async function loadAnalytics() {
    loading = true;
    error = '';
    try {
      const res = await fetch(`${apiBase}/api/analytics?from=${fromTs}&to=${toTs}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      analyticsData = await res.json() as AnalyticsData;
      loading = false;
      await tick();
      if (flightsCanvas) renderFlightsChart(analyticsData!.flightsPerHour);
      if (topIcaoCanvas)  renderTopIcaoChart(analyticsData!.topIcao);
    } catch (e) {
      error = (e as Error).message;
      loading = false;
    }
  }

  export async function loadAltitudeTrend(icao24: string, from: number, to: number) {
    altTrendState = 'loading';
    try {
      const res = await fetch(`${apiBase}/api/history?icao24=${icao24}&from=${from}&to=${to}`);
      if (!res.ok) { altTrendState = 'no-data'; return; }
      const json = await res.json() as { data: HistoryPoint[] };
      const all = json.data ?? [];
      const airborne = all.filter((p) => p.altitude != null && p.altitude > 50 && !p.on_ground);
      if (airborne.length === 0) {
        const onGround = all.some((p) => p.on_ground === 1 || (p.altitude != null && p.altitude <= 50));
        altTrendState = onGround ? 'on-ground' : 'no-data';
        altTrendChart?.destroy();
        altTrendChart = null;
        return;
      }
      altTrendState = 'ready';
      await tick();
      renderAltTrendChart(airborne, icao24);
    } catch {
      altTrendState = 'no-data';
    }
  }

  function renderFlightsChart(data: { hour: string; count: number }[]) {
    noFlightsData = data.length === 0;
    if (noFlightsData) { flightsChart?.destroy(); flightsChart = null; return; }
    const display = data.slice(-6);
    flightsChart?.destroy();
    flightsChart = new Chart(flightsCanvas, {
      type: 'bar',
      data: {
        labels: display.map((d) => formatHourLabel(d.hour)),
        datasets: [{
          label: 'Unique Aircraft',
          data: display.map((d) => d.count),
          backgroundColor: C.primary40,
          borderColor: C.primary,
          borderWidth: 1,
          borderRadius: 2,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          title: {
            display: true,
            text: 'AIRCRAFT / HOUR  (LAST 6H)',
            color: C.slate400,
            font: { size: 12, family: 'Inter, sans-serif', weight: '700' },
            padding: { bottom: 10 },
          },
          tooltip: { callbacks: { label: (i) => `${i.raw} aircraft` } },
        },
        scales: {
          x: {
            ticks: { maxRotation: 0, color: C.slate500, font: { size: 11 } },
            grid:   { color: C.outlineVar15 },
            border: { color: C.outlineVar30 },
          },
          y: {
            beginAtZero: true,
            ticks:  { precision: 0, color: C.slate500, font: { size: 11 } },
            grid:   { color: C.outlineVar15 },
            border: { color: C.outlineVar30 },
          },
        },
      },
    });
  }

  function renderTopIcaoChart(data: { icao24: string; sightings: number }[]) {
    noTopIcaoData = data.length === 0;
    if (noTopIcaoData) { topIcaoChart?.destroy(); topIcaoChart = null; return; }
    const display = data.slice(0, 5);
    topIcaoChart?.destroy();
    topIcaoChart = new Chart(topIcaoCanvas, {
      type: 'bar',
      data: {
        labels: display.map((d) => d.icao24.toUpperCase()),
        datasets: [{
          label: 'Sightings',
          data: display.map((d) => d.sightings),
          backgroundColor: C.primary40,
          borderColor: C.primary70,
          borderWidth: 0,
          borderRadius: 2,
        }],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          title: {
            display: true,
            text: 'TOP ICAO24 TRAFFIC',
            color: C.slate400,
            font: { size: 12, family: 'Inter, sans-serif', weight: '700' },
            padding: { bottom: 10 },
          },
          tooltip: { callbacks: { label: (i) => `${i.raw} records` } },
        },
        scales: {
          x: {
            beginAtZero: true,
            ticks:  { precision: 0, color: C.slate500, font: { size: 11 } },
            grid:   { color: C.outlineVar15 },
            border: { color: C.outlineVar30 },
          },
          y: {
            ticks:  { color: C.primary, font: { family: 'Roboto Mono, monospace', size: 11 } },
            grid:   { display: false },
            border: { color: C.outlineVar30 },
          },
        },
      },
    });
  }

  function renderAltTrendChart(points: HistoryPoint[], icao24: string) {
    const labels = points.map((p) =>
      new Date(p.ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
    );
    const alts   = points.map((p) => Math.round(p.altitude! * 3.28084 / 100));
    const minAlt = Math.min(...alts);
    const maxAlt = Math.max(...alts);

    altTrendChart?.destroy();
    altTrendChart = new Chart(altTrendCanvas, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Altitude (FL)',
          data: alts,
          borderColor: C.primary,
          backgroundColor: 'rgba(170, 199, 255, 0.08)',
          borderWidth: 2,
          fill: true,
          tension: 0.4,
          pointRadius: 0,
          pointHoverRadius: 5,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          title: {
            display: true,
            text: `ALTITUDE TREND (FL) — ${icao24.toUpperCase()}`,
            color: C.slate400,
            font: { size: 12, family: 'Inter, sans-serif', weight: '700' },
            padding: { bottom: 10 },
          },
          tooltip: { callbacks: { label: (i) => `FL ${i.raw}` } },
        },
        scales: {
          y: {
            min: Math.max(0, minAlt - 20),
            suggestedMax: maxAlt + 20,
            ticks:  { color: C.slate500, font: { size: 11 }, callback: (v) => `FL${v}` },
            grid:   { color: C.outlineVar15 },
            border: { color: C.outlineVar30 },
          },
          x: {
            ticks:  { maxTicksLimit: 8, color: C.slate500, font: { size: 11 } },
            grid:   { color: C.outlineVar15 },
            border: { color: C.outlineVar30 },
          },
        },
      },
    });
  }
</script>

<div class="charts-grid">

  <div class="chart-card">
    {#if loading}
      <div class="empty"><span class="spinner"></span></div>
    {:else if noFlightsData}
      <div class="empty">
        <p>No flight data</p>
        <small>Awaiting collection cycle</small>
      </div>
    {:else}
      <canvas bind:this={flightsCanvas}></canvas>
    {/if}
  </div>

  <div class="chart-card snapshot-card">
    <span class="card-label">Live Snapshot</span>
    {#if latestAircraft.length === 0}
      <div class="empty">
        <p>No aircraft data</p>
        <small>Awaiting first poll</small>
      </div>
    {:else}
      {@const airborne = latestAircraft.filter(a => a.on_ground !== 1 && a.altitude != null && a.altitude > 50)}
      {@const onGround = latestAircraft.filter(a => a.on_ground === 1 || (a.altitude != null && a.altitude <= 50))}
      {@const avgAltM  = airborne.length > 0 ? airborne.reduce((s, a) => s + a.altitude!, 0) / airborne.length : null}
      {@const avgAltFt = avgAltM != null ? Math.round(avgAltM * 3.28084 / 100) * 100 : null}
      {@const avgSpd   = airborne.filter(a => a.velocity != null)}
      {@const avgKts   = avgSpd.length > 0 ? Math.round(avgSpd.reduce((s, a) => s + a.velocity! * 1.94384, 0) / avgSpd.length) : null}
      <div class="snap-grid">
        <div class="snap-stat">
          <span class="snap-val snap-primary">{latestAircraft.length}</span>
          <span class="snap-label">In View</span>
        </div>
        <div class="snap-stat">
          <span class="snap-val snap-secondary">{airborne.length}</span>
          <span class="snap-label">Airborne</span>
        </div>
        <div class="snap-stat">
          <span class="snap-val snap-tertiary">{onGround.length}</span>
          <span class="snap-label">On Ground</span>
        </div>
        <div class="snap-stat">
          <span class="snap-val snap-primary">{avgAltFt != null ? avgAltFt.toLocaleString() + ' FT' : '—'}</span>
          <span class="snap-label">Avg Altitude</span>
        </div>
        <div class="snap-stat snap-wide">
          <span class="snap-val snap-primary">{avgKts != null ? avgKts + ' KTS' : '—'}</span>
          <span class="snap-label">Avg Speed (Airborne)</span>
        </div>
      </div>
    {/if}
  </div>

  <div class="chart-card">
    {#if loading}
      <div class="empty"><span class="spinner"></span></div>
    {:else if noTopIcaoData}
      <div class="empty">
        <p>No aircraft data</p>
        <small>Awaiting collection</small>
      </div>
    {:else}
      <canvas bind:this={topIcaoCanvas}></canvas>
    {/if}
  </div>

  <div class="chart-card">
    {#if !selectedIcao}
      <div class="empty">
        <p>No aircraft selected</p>
        <small>Click a map marker to view altitude trend</small>
      </div>
    {:else if altTrendState === 'loading'}
      <div class="empty"><span class="spinner"></span><p>Loading…</p></div>
    {:else if altTrendState === 'on-ground'}
      <div class="empty">
        <p>{selectedIcao.toUpperCase()} — On ground</p>
        <small>No airborne data in selected range</small>
      </div>
    {:else if altTrendState === 'no-data'}
      <div class="empty">
        <p>No altitude data</p>
        <small>{selectedIcao.toUpperCase()}</small>
      </div>
    {:else}
      <canvas bind:this={altTrendCanvas}></canvas>
    {/if}
  </div>

</div>

<style>
  .charts-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1rem;
  }

  /* shared card base */
  .chart-card {
    background: #181c21;
    border: 1px solid rgba(65, 71, 84, 0.1);
    border-radius: 4px;
    padding: 1rem;
    height: 240px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .chart-card canvas {
    width: 100% !important;
    flex: 1;
    min-height: 0;
  }

  /* live snapshot card */
  .snapshot-card { justify-content: flex-start; }

  .card-label {
    font-size: 0.65rem;
    font-weight: 700;
    color: #94a3b8;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    display: block;
    margin-bottom: 0.85rem;
    flex-shrink: 0;
  }

  .snap-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.65rem;
    flex: 1;
  }

  .snap-stat {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    background: #101418;
    border: 1px solid rgba(65, 71, 84, 0.12);
    border-radius: 4px;
    padding: 0.6rem 0.75rem;
  }

  .snap-wide {
    grid-column: 1 / -1;
  }

  .snap-val {
    font-family: 'Roboto Mono', monospace;
    font-size: 1.1rem;
    font-weight: 700;
    line-height: 1;
  }

  .snap-primary  { color: #aac7ff; }
  .snap-secondary { color: #66dd8b; }
  .snap-tertiary  { color: #fbbc00; }

  .snap-label {
    font-size: 0.62rem;
    color: #64748b;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  /* empty & loading states */
  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.35rem;
    flex: 1;
    height: 100%;
    text-align: center;
    padding: 0.5rem;
  }

  .empty p {
    font-size: 0.82rem;
    color: #64748b;
    margin: 0;
  }
  .empty small {
    font-size: 0.72rem;
    color: #475569;
  }

  .spinner {
    display: inline-block;
    width: 18px;
    height: 18px;
    border: 2px solid #262a2f;
    border-top-color: #aac7ff;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  @media (max-width: 600px) {
    .charts-grid { grid-template-columns: 1fr; }
    .chart-card  { height: 210px; }
  }
</style>
