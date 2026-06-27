// The tool pages render their own <SeoMeta> (+ JSON-LD); suppress the root
// layout's default tags to avoid duplicate description / og: tags.
export const prerender = true;
export const load = () => ({ customSeo: true });
