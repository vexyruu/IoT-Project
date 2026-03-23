<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';
  import Chart from 'chart.js/auto';

  export let apiBase: string;
  export let selectedIcao: string | null = null;
  export let fromTs: number;
  export let toTs: number;

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
  let altStatusCanvas: HTMLCanvasElement;
  let altTrendCanvas: HTMLCanvasElement;
  let topIcaoCanvas: HTMLCanvasElement;

  let flightsChart: Chart | null = null;
  let altStatusChart: Chart | null = null;
  let altTrendChart: Chart | null = null;
  let topIcaoChart: Chart | null = null;

  let analyticsData: AnalyticsData | null = null;
  let loading = true;
  let error = '';

  // Per-chart no-data states
  let noFlightsData = false;
  let noTopIcaoData = false;
  let altTrendState: 'idle' | 'loading' | 'no-data' | 'on-ground' | 'ready' = 'idle';

  onMount(() => {
    loadAnalytics();
  });

  onDestroy(() => {
    flightsChart?.destroy();
    altStatusChart?.destroy();
    altTrendChart?.destroy();
    topIcaoChart?.destroy();
  });

  // Format "2026-03-07 05:00" → "Mar 7, 05:00"
  function formatHourLabel(raw: string): string {
    // raw is like "2026-03-07 05:00"
    const [datePart, timePart] = raw.split(' ');
    if (!datePart || !timePart) return raw;
    const d = new Date(`${datePart}T${timePart}:00`);
    if (isNaN(d.getTime())) return raw;
    return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
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
      if (altStatusCanvas) renderAltStatusChart(analyticsData!.altitudeStatus);
      if (topIcaoCanvas) renderTopIcaoChart(analyticsData!.topIcao);
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

      // Separate airborne points with valid altitude
      const airborne = all.filter((p) => p.altitude != null && p.altitude > 50 && !p.on_ground);

      if (airborne.length === 0) {
        // Check if aircraft was on the ground
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

    const labels = data.map((d) => formatHourLabel(d.hour));
    const counts = data.map((d) => d.count);

    flightsChart?.destroy();
    flightsChart = new Chart(flightsCanvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Unique Aircraft',
          data: counts,
          backgroundColor: 'rgba(59, 130, 246, 0.7)',
          borderColor: 'rgba(59, 130, 246, 1)',
          borderWidth: 1,
          borderRadius: 4,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: {
          legend: { display: false },
          title: { display: true, text: 'Aircraft Sightings per Hour', color: '#cbd5e1', font: { size: 13 } },
          tooltip: { callbacks: { title: (items) => items[0].label, label: (item) => `${item.raw} aircraft` } },
        },
        scales: {
          x: { ticks: { maxRotation: 40, color: '#94a3b8', font: { size: 11 } }, grid: { color: 'rgba(255,255,255,0.05)' } },
          y: {
            beginAtZero: true,
            ticks: { precision: 0, color: '#94a3b8' },
            title: { display: true, text: 'Unique Aircraft', color: '#64748b' },
            grid: { color: 'rgba(255,255,255,0.05)' },
          },
        },
      },
    });
  }

  function renderAltStatusChart(data: { status: string; count: number }[]) {
    const statusOrder = ['Ascending', 'Level', 'Descending'];
    const colorMap: Record<string, string> = {
      Ascending: 'rgba(34, 197, 94, 0.8)',
      Level: 'rgba(234, 179, 8, 0.8)',
      Descending: 'rgba(239, 68, 68, 0.8)',
    };

    const sorted = statusOrder.map((s) => data.find((d) => d.status === s) ?? { status: s, count: 0 });
    const total = sorted.reduce((sum, d) => sum + d.count, 0);

    altStatusChart?.destroy();
    altStatusChart = new Chart(altStatusCanvas, {
      type: 'bar',
      data: {
        labels: sorted.map((d) => d.status),
        datasets: [{
          label: 'Transitions',
          data: sorted.map((d) => d.count),
          backgroundColor: sorted.map((d) => colorMap[d.status] ?? 'rgba(99, 102, 241, 0.7)'),
          borderWidth: 0,
          borderRadius: 4,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: {
          legend: { display: false },
          title: { display: true, text: 'Altitude Change Status', color: '#cbd5e1', font: { size: 13 } },
          subtitle: {
            display: total === 0,
            text: 'No altitude transitions yet — collecting data…',
            color: '#64748b',
            font: { size: 11 },
            padding: { bottom: 8 },
          },
          tooltip: {
            callbacks: {
              label: (item) => {
                const pct = total > 0 ? ((Number(item.raw) / total) * 100).toFixed(1) : '0';
                return `${item.raw} samples (${pct}%)`;
              },
            },
          },
        },
        scales: {
          x: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255,255,255,0.05)' } },
          y: {
            beginAtZero: true,
            ticks: { precision: 0, color: '#94a3b8' },
            title: { display: true, text: 'Transitions', color: '#64748b' },
            grid: { color: 'rgba(255,255,255,0.05)' },
            suggestedMax: Math.max(...sorted.map((d) => d.count), 5),
          },
        },
      },
    });
  }

  function renderTopIcaoChart(data: { icao24: string; sightings: number }[]) {
    noTopIcaoData = data.length === 0;
    if (noTopIcaoData) { topIcaoChart?.destroy(); topIcaoChart = null; return; }

    topIcaoChart?.destroy();
    topIcaoChart = new Chart(topIcaoCanvas, {
      type: 'bar',
      data: {
        labels: data.map((d) => d.icao24.toUpperCase()),
        datasets: [{
          label: 'Sightings',
          data: data.map((d) => d.sightings),
          backgroundColor: 'rgba(139, 92, 246, 0.7)',
          borderColor: 'rgba(139, 92, 246, 1)',
          borderWidth: 0,
          borderRadius: 4,
        }],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: true,
        plugins: {
          legend: { display: false },
          title: { display: true, text: 'Top Aircraft by Sightings', color: '#cbd5e1', font: { size: 13 } },
          tooltip: { callbacks: { label: (item) => `${item.raw} records` } },
        },
        scales: {
          x: {
            beginAtZero: true,
            ticks: { precision: 0, color: '#94a3b8' },
            title: { display: true, text: 'Records collected', color: '#64748b' },
            grid: { color: 'rgba(255,255,255,0.05)' },
          },
          y: { ticks: { color: '#94a3b8', font: { family: 'monospace' } }, grid: { display: false } },
        },
      },
    });
  }

  function renderAltTrendChart(points: HistoryPoint[], icao24: string) {
    const labels = points.map((p) =>
      new Date(p.ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
    );
    const alts = points.map((p) => Math.round(p.altitude!));
    const minAlt = Math.min(...alts);
    const maxAlt = Math.max(...alts);

    altTrendChart?.destroy();
    altTrendChart = new Chart(altTrendCanvas, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: `Altitude (m)`,
          data: alts,
          borderColor: 'rgba(249, 115, 22, 0.9)',
          backgroundColor: 'rgba(249, 115, 22, 0.1)',
          borderWidth: 2,
          fill: true,
          tension: 0.3,
          pointRadius: 3,
          pointHoverRadius: 5,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: {
          legend: { display: false },
          title: { display: true, text: `Altitude Trend — ${icao24.toUpperCase()}`, color: '#cbd5e1', font: { size: 13 } },
          tooltip: { callbacks: { label: (item) => `${item.raw} m` } },
        },
        scales: {
          y: {
            min: Math.max(0, minAlt - 500),
            suggestedMax: maxAlt + 500,
            ticks: { color: '#94a3b8', callback: (v) => `${v} m` },
            title: { display: true, text: 'Altitude (m)', color: '#64748b' },
            grid: { color: 'rgba(255,255,255,0.05)' },
          },
          x: {
            ticks: { maxTicksLimit: 10, color: '#94a3b8' },
            grid: { color: 'rgba(255,255,255,0.05)' },
          },
        },
      },
    });
  }
</script>

<div class="charts-grid">
  {#if loading}
    <div class="full-col status-card">
      <span class="spinner"></span>
      <p>Loading analytics…</p>
    </div>
  {:else if error}
    <div class="full-col status-card error">
      <p>⚠ Failed to load analytics: {error}</p>
      <button onclick={() => loadAnalytics()}>Retry</button>
    </div>
  {:else}
    <!-- Flights per hour -->
    <div class="chart-card">
      {#if noFlightsData}
        <div class="no-data">
          <span class="no-data-icon">📊</span>
          <p>No flights recorded yet</p>
          <small>Data will appear after the first collection cycle</small>
        </div>
      {:else}
        <canvas bind:this={flightsCanvas}></canvas>
      {/if}
    </div>

    <!-- Altitude change status -->
    <div class="chart-card">
      <canvas bind:this={altStatusCanvas}></canvas>
    </div>

    <!-- Top ICAO24 -->
    <div class="chart-card">
      {#if noTopIcaoData}
        <div class="no-data">
          <span class="no-data-icon">✈</span>
          <p>No aircraft recorded yet</p>
          <small>Data will appear after the first collection cycle</small>
        </div>
      {:else}
        <canvas bind:this={topIcaoCanvas}></canvas>
      {/if}
    </div>
  {/if}

  <!-- Altitude trend — always in DOM so canvas ref is always bound -->
  <div class="chart-card">
    {#if !selectedIcao}
      <div class="no-data">
        <span class="no-data-icon">🛫</span>
        <p>No aircraft selected</p>
        <small>Click a marker on the map to see its altitude trend</small>
      </div>
    {:else if altTrendState === 'loading'}
      <div class="no-data">
        <span class="spinner"></span>
        <p>Loading altitude data…</p>
      </div>
    {:else if altTrendState === 'on-ground'}
      <div class="no-data">
        <span class="no-data-icon">🛬</span>
        <p>{selectedIcao.toUpperCase()} — On the ground</p>
        <small>No airborne altitude data in this time range</small>
      </div>
    {:else if altTrendState === 'no-data'}
      <div class="no-data">
        <span class="no-data-icon">📡</span>
        <p>No altitude data for {selectedIcao.toUpperCase()}</p>
        <small>Altitude may not have been reported by this aircraft</small>
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

  .chart-card {
    background: #1e293b;
    border-radius: 0.5rem;
    padding: 1rem;
    position: relative;
    min-height: 220px;
    display: flex;
    flex-direction: column;
    justify-content: center;
  }

  .chart-card canvas {
    width: 100% !important;
  }

  .full-col {
    grid-column: 1 / -1;
  }

  .status-card {
    background: #1e293b;
    border-radius: 0.5rem;
    padding: 2rem;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    color: #94a3b8;
    min-height: 100px;
  }

  .status-card.error {
    color: #f87171;
  }

  .status-card button {
    margin-top: 0.5rem;
    background: #334155;
    border: none;
    border-radius: 0.375rem;
    color: #e2e8f0;
    padding: 0.35rem 0.9rem;
    font-size: 0.8rem;
    cursor: pointer;
  }

  .no-data {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    text-align: center;
    height: 100%;
    min-height: 180px;
    padding: 1rem;
    color: #64748b;
  }

  .no-data-icon {
    font-size: 2rem;
    line-height: 1;
    margin-bottom: 0.25rem;
    filter: grayscale(0.3);
  }

  .no-data p {
    font-size: 0.9rem;
    color: #94a3b8;
    margin: 0;
  }

  .no-data small {
    font-size: 0.75rem;
    color: #475569;
  }

  .spinner {
    display: inline-block;
    width: 20px;
    height: 20px;
    border: 2px solid #334155;
    border-top-color: #38bdf8;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  @media (max-width: 700px) {
    .charts-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
