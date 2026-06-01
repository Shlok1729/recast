/**
 * `use:focusOnMount` — focus an element when it mounts. Used for inline
 * create/rename inputs so the cursor lands there immediately, without the
 * `autofocus` attribute (which Svelte flags for a11y and which doesn't
 * re-fire when the same node is reused).
 */
export function focusOnMount(node: HTMLElement) {
	node.focus();
	if (node instanceof HTMLInputElement) node.select();
}
