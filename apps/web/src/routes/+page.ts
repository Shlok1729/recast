// The homepage renders its own <SeoMeta>; signal the root layout to suppress
// its default tags so there's a single, authoritative set (no duplicate
// description / og: tags).
export const load = () => ({ customSeo: true });
