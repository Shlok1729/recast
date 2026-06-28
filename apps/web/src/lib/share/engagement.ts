/**
 * Pure engagement helpers for the share page. Most of the share page's
 * engagement code is irreducibly coupled to the player API, the DOM, and shared
 * page-reactive state, so it stays in the component; this is the one piece with
 * real, bug-prone logic worth isolating — the optimistic reaction toggle.
 */

import type { ReactionCount } from "./client";

export interface ReactionState {
	/** Emojis the current viewer has reacted with. */
	myReactions: Set<string>;
	/** Aggregate counts per emoji. */
	reactions: ReactionCount[];
}

/**
 * Optimistic local update for toggling the viewer's reaction to `emoji`:
 * add/remove from `myReactions` and bump/drop the aggregate count (removing the
 * entry entirely when it hits zero, adding a new one at count 1). Returns fresh
 * objects; does not mutate the input.
 */
export function toggleReactionState(
	current: ReactionState,
	emoji: string,
): ReactionState {
	const had = current.myReactions.has(emoji);
	const nextSet = new Set(current.myReactions);
	const next = current.reactions.map((r) => ({ ...r }));
	const idx = next.findIndex((r) => r.emoji === emoji);
	if (had) {
		nextSet.delete(emoji);
		if (idx >= 0) {
			next[idx].count -= 1;
			if (next[idx].count <= 0) next.splice(idx, 1);
		}
	} else {
		nextSet.add(emoji);
		if (idx >= 0) next[idx].count += 1;
		else next.push({ emoji, count: 1 });
	}
	return { myReactions: nextSet, reactions: next };
}
