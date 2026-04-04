<script lang="ts">
  import AppSidebar from "$components/layout/app-sidebar.svelte";
  import { Separator } from "$components/ui/separator";
  import * as Sidebar from "$components/ui/sidebar";
  import { config } from "$constants/app";
  let { children } = $props();

  
</script>

<Sidebar.Provider>
  <AppSidebar />
  <Sidebar.Inset class="@container/layout">
    <header class="flex h-16 shrink-0 items-center gap-2">
      <div class="flex items-center gap-2 px-4">
        <Sidebar.Trigger class="-ms-1" />
        <Separator orientation="vertical" class="me-2 data-[orientation=vertical]:h-4" />
        <div class="flex items-center gap-2 font-sans font-semibold">
            {config.appName}
        </div>
      </div>
    </header>
    {@render children()}
  </Sidebar.Inset>
</Sidebar.Provider>
