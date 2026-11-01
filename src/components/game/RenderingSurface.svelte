<script lang="ts">
  import { onMount } from 'svelte';
  import { GameCanvas } from '../../game/GameCanvas';
  let host: HTMLDivElement;
  let status = $state('Initializing renderer…');
  onMount(() => {
    const canvas = new GameCanvas();
    let active = true;
    void canvas
      .mount(host)
      .then(() => {
        if (active) status = 'Renderer ready';
      })
      .catch(() => {
        canvas.destroy();
        if (active)
          status = 'Renderer unavailable. Try a browser with WebGL support.';
      });
    return () => {
      active = false;
      canvas.destroy();
    };
  });
</script>

<div class="surface" bind:this={host}></div>
<p class="renderer-status" role="status">{status}</p>
