<script lang="ts">
	import * as Tooltip from "$components/ui/tooltip";
	import { CircleHelp } from "@lucide/svelte";

	interface Props {
		content: string;
	}

	let { content }: Props = $props();
</script>

<Tooltip.Root>
	<Tooltip.Trigger>
		<button
			type="button"
			class="inline-flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground/70 transition-colors hover:bg-muted hover:text-foreground"
			aria-label="More information"
		>
			<CircleHelp size={13} />
		</button>
	</Tooltip.Trigger>
	<Tooltip.Content class="max-w-56 text-xs leading-5">
		{content}
	</Tooltip.Content>
</Tooltip.Root>
