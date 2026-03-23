<script lang="ts">
  let { children } = $props();
</script>

<svelte:head>
  <title>Perak Aircraft Monitor</title>
  <meta name="description" content="IoT Aircraft Monitoring System over Perak, Malaysia" />
</svelte:head>

{@render children()}

<style>
  :global(*) {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  :global(body) {
    font-family: 'Inter', system-ui, sans-serif;
    background: #0f172a;
    color: #e2e8f0;
    min-height: 100vh;
  }

  :global(button) {
    cursor: pointer;
  }
</style>
