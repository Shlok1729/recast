// Shared on-demand Google Fonts loader, used by captions (and reusable by
// annotations). A font is fetched + cached on device by the Rust side on first
// use, then registered with the document via the FontFace API so any element
// using that family renders it. The full searchable catalog can come later;
// this curated set covers the common display/caption choices.
import { ensureGoogleFont } from "$lib/ipc";
import { convertFileSrc } from "@tauri-apps/api/core";

/** Curated, searchable set of popular Google Fonts offered in pickers. */
export const GOOGLE_FONTS = [
	"Inter",
	"Roboto",
	"Roboto Condensed",
	"Roboto Slab",
	"Open Sans",
	"Montserrat",
	"Poppins",
	"Lato",
	"Nunito",
	"Nunito Sans",
	"Work Sans",
	"Raleway",
	"Rubik",
	"Mulish",
	"Manrope",
	"DM Sans",
	"DM Serif Display",
	"Figtree",
	"Outfit",
	"Sora",
	"Space Grotesk",
	"Plus Jakarta Sans",
	"Oswald",
	"Bebas Neue",
	"Anton",
	"Archivo",
	"Archivo Black",
	"Teko",
	"Barlow",
	"Kanit",
	"Playfair Display",
	"Merriweather",
	"Lora",
	"PT Serif",
	"Source Serif 4",
	"Caveat",
	"Pacifico",
	"Dancing Script",
	"Permanent Marker",
	"Fredoka",
	"Comfortaa",
	"Josefin Sans",
	"Quicksand",
	"JetBrains Mono",
	"Fira Code",
] as const;

/** A CSS font-family stack for a Google font, e.g. `'Poppins', sans-serif`. */
export const googleFontStack = (family: string) => `'${family}', sans-serif`;

/** True if a CSS stack refers to one of our Google fonts (and which family). */
export function googleFamilyFromStack(stack: string): string | null {
	return GOOGLE_FONTS.find((f) => stack.includes(`'${f}'`)) ?? null;
}

const loaded = new Set<string>();

/**
 * Ensure `family` at `weight` is downloaded + registered with the document.
 * Idempotent per family+weight; failures are swallowed (the text just falls
 * back to the next family in the stack).
 */
export async function loadGoogleFont(family: string, weight = 400): Promise<void> {
	const key = `${family}:${weight}`;
	if (loaded.has(key)) return;
	loaded.add(key);
	try {
		const path = await ensureGoogleFont(family, weight);
		const face = new FontFace(family, `url("${convertFileSrc(path)}")`, {
			weight: String(weight),
		});
		await face.load();
		// `FontFaceSet.add` is missing from the lib typings in this config.
		(document.fonts as unknown as { add(f: FontFace): void }).add(face);
	} catch (e) {
		loaded.delete(key);
		console.warn(`Google font load failed: ${family} ${weight}`, e);
	}
}
