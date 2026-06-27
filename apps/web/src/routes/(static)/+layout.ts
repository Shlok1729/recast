// Every page in this group renders its own <SeoMeta>; suppress the root
// layout's default tags to avoid duplicate description / og: tags.
export const load = () => ({ customSeo: true });
