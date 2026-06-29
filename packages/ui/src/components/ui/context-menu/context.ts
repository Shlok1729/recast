import { getContext, setContext } from "svelte";
import { tv, type VariantProps } from "tailwind-variants";

const SIZE_KEY = Symbol.for("recast-ui.context-menu.size");

export type ContextMenuSize = "sm" | "default" | "lg";

export function setContextMenuSize(size: ContextMenuSize) {
	setContext<ContextMenuSize>(SIZE_KEY, size);
}

export function getContextMenuSize(): ContextMenuSize {
	return getContext<ContextMenuSize>(SIZE_KEY) ?? "default";
}

/** Padding / min-width applied to <Content>. */
export const contextMenuContentSizeVariants = tv({
	base: "",
	variants: {
		size: {
			sm: "min-w-28 p-0.5 text-[11px]",
			default: "min-w-32 p-1",
			lg: "min-w-40 p-1.5 text-[14px]",
		},
	},
	defaultVariants: { size: "default" },
});

/** Row sizing applied to <Item>, <CheckboxItem>, <RadioItem>, <SubTrigger>. */
export const contextMenuItemSizeVariants = tv({
	base: "",
	variants: {
		size: {
			sm: "h-7 gap-1.5 px-2 text-[11px] [&_svg:not([class*='size-'])]:size-3",
			default: "gap-1.5 px-1.5 py-1 text-sm [&_svg:not([class*='size-'])]:size-4",
			lg: "gap-2 px-2 py-1.5 text-[14px] [&_svg:not([class*='size-'])]:size-4",
		},
	},
	defaultVariants: { size: "default" },
});

export type ContextMenuContentSizeVariant = VariantProps<
	typeof contextMenuContentSizeVariants
>["size"];
