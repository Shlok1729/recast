<script lang="ts">
  // Logo component configuration
  import { onMount } from "svelte";
  import { safeStorage } from "@recast/ui/persisted-state";
  type Theme = "light" | "dark" | "system";

  let currentTheme = $state<Theme>("system");
  onMount(() => {
    // Read-only — mode-watcher owns this key.
    currentTheme = safeStorage.get<Theme>("mode-watcher-mode", currentTheme);
  });

  let {
    color = currentTheme === "light" ? "white" : "black",
    fill = currentTheme === "light" ? "black" : "white",
    size = "512",
    ...rest
  } = $props();
</script>

<svg
  viewBox="0 0 512 512"
  xmlns="http://www.w3.org/2000/svg"
  {...rest}
  {fill}
  width={size}
  height={size}
>
  <rect width="512" height="512" rx="256" {fill} />
  <rect x="230" y="166" width="60" height="180" rx="30" fill={color} />
  <rect x="111" y="166" width="60" height="180" rx="30" fill={color} />
  <rect x="349" y="166" width="60" height="180" rx="30" fill={color} />
</svg>
