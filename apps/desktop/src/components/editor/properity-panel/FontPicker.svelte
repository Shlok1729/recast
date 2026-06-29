<script lang="ts">
  // Searchable font combobox (system + Google Fonts), shared by the caption and
  // annotation panels. Selecting a Google font fetches + registers it on demand.
  import {
    ensureFontLoaded,
    fontLabel,
    GOOGLE_FONT_OPTIONS,
    SYSTEM_FONTS,
  } from "$lib/fonts/font-options";
  import { Check, ChevronsUpDown } from "@lucide/svelte";
  import * as Command from "@recast/ui/command";
  import * as Popover from "@recast/ui/popover";
  import { cn } from "@recast/ui/utils";

  let {
    value,
    weight = 400,
    onChange,
  }: {
    value: string;
    /** Weight to fetch for Google fonts. */
    weight?: number;
    onChange: (value: string) => void;
  } = $props();

  let open = $state(false);

  function pick(v: string) {
    onChange(v);
    ensureFontLoaded(v, weight);
    open = false;
  }
</script>

<Popover.Root {open} onOpenChange={(o) => (open = o)}>
  <Popover.Trigger>
    {#snippet child({ props })}
      <button
        {...props}
        class="flex h-7 w-36 items-center gap-1.5 rounded-md border border-border/60 bg-card/60 px-2 text-left text-[11px] transition-colors hover:border-border hover:bg-card"
      >
        <span class="min-w-0 flex-1 truncate" style="font-family: {value}">
          {fontLabel(value)}
        </span>
        <ChevronsUpDown size={12} class="shrink-0 text-muted-foreground" />
      </button>
    {/snippet}
  </Popover.Trigger>
  <Popover.Content align="end" sideOffset={6} class="w-56 p-0">
    <Command.Root>
      <Command.Input placeholder="Search fonts…" class="h-9 text-[12px]" />
      <Command.List class="max-h-72 scrollbar-transparent">
        <Command.Empty class="py-6 text-center text-[11px] text-muted-foreground">
          No fonts found
        </Command.Empty>
        <Command.Group heading="System">
          {#each SYSTEM_FONTS as f (f.value)}
            <Command.Item value={f.label} onSelect={() => pick(f.value)} class="gap-2">
              <span class="flex size-4 shrink-0 items-center justify-center">
                {#if f.value === value}<Check size={13} class="text-primary" />{/if}
              </span>
              <span class="truncate" style="font-family: {f.value}">{f.label}</span>
            </Command.Item>
          {/each}
        </Command.Group>
        <Command.Group heading="Google Fonts">
          {#each GOOGLE_FONT_OPTIONS as f (f.value)}
            <Command.Item value={f.label} onSelect={() => pick(f.value)} class="gap-2">
              <span class="flex size-4 shrink-0 items-center justify-center">
                {#if f.value === value}<Check size={13} class="text-primary" />{/if}
              </span>
              <span class="truncate" style="font-family: {f.value}">{f.label}</span>
            </Command.Item>
          {/each}
        </Command.Group>
      </Command.List>
    </Command.Root>
  </Popover.Content>
</Popover.Root>
