export const prerender = false;
export const ssr = false;

import type { PageLoad } from './$types';

export const load: PageLoad = ({ params }) => {
	// Decode the base64-encoded file path
	const filePath = decodeURIComponent(atob(params.file));
	const filename = filePath.split(/[\\/]/).pop() || 'Recording';

	return {
		filePath,
		filename,
	};
};
