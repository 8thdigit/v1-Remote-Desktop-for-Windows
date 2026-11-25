import { useEffect, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';

// Site settings an admin controls from /admin → Site settings: visible
// sections, the logo, favicon, share tags, and the disclaimer and privacy
// pages. Every page reads them from the relay; if the relay cannot be
// reached, the built-in defaults apply.

export type AssetInfo = { url: string; type: string; bytes: number; updatedAt: number } | null;
export type PageContent = { enabled: boolean; title: string; body: string };
export type SiteSettings = {
  tabs: { pcs: boolean; connect: boolean; download: boolean; test: boolean };
  signIn: { requestAccess: boolean; downloadLink: boolean };
  og: { title: string; description: string };
  pages: { disclaimer: PageContent; privacy: PageContent };
  updatedAt: number;
  logo: AssetInfo;
  favicon: AssetInfo;
  ogImage: AssetInfo;
};

export const DEFAULT_SITE: SiteSettings = {
  tabs: { pcs: true, connect: true, download: true, test: false },
  signIn: { requestAccess: true, downloadLink: true },
  og: { title: 'Connect.AI', description: '' },
  pages: {
    disclaimer: { enabled: false, title: 'Disclaimer', body: '' },
    privacy: { enabled: true, title: 'Privacy', body: '' },
  },
  updatedAt: 0,
  logo: null,
  favicon: null,
  ogImage: null,
};

export const SITE_KEY = ['site-settings'] as const;

export function useSite() {
  const q = useQuery<SiteSettings>({
    queryKey: SITE_KEY,
    queryFn: async () => {
      const res = await fetch('/api/site/settings', { credentials: 'same-origin' });
      if (!res.ok) throw new Error(`settings ${res.status}`);
      return (await res.json()) as SiteSettings;
    },
    staleTime: 60_000,
    retry: 1,
  });
  return { site: q.data ?? DEFAULT_SITE, loaded: q.isSuccess || q.isError };
}

// Keeps the favicon and share tags in the open page in step with the settings.
// Social networks read the tags from the HTML itself; see middleware.js.
export function SiteHead() {
  const { site } = useSite();
  useEffect(() => {
    const href = site.favicon?.url ?? '/favicon.svg';
    const type = site.favicon?.type ?? 'image/svg+xml';
    let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    if (link.getAttribute('href') !== href) { link.href = href; link.type = type; }
  }, [site.favicon]);
  useEffect(() => {
    const set = (attr: 'name' | 'property', key: string, value: string | undefined) => {
      if (!value) return;
      let tag = document.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
      if (!tag) {
        tag = document.createElement('meta');
        tag.setAttribute(attr, key);
        document.head.appendChild(tag);
      }
      tag.content = value;
    };
    const image = site.ogImage ? new URL(site.ogImage.url, window.location.origin).href : undefined;
    set('property', 'og:title', site.og.title);
    set('name', 'twitter:title', site.og.title);
    set('property', 'og:description', site.og.description);
    set('name', 'twitter:description', site.og.description);
    set('name', 'description', site.og.description);
    set('property', 'og:image', image);
    set('name', 'twitter:image', image);
  }, [site.og.title, site.og.description, site.ogImage]);
  return null;
}

// Renders an admin's page text safely, as text: blank lines split
// paragraphs, "## " starts a heading and "- " a bullet. No HTML is ever
// interpreted.
export function PageText({ body }: { body: string }) {
  const blocks = body.replace(/\r\n?/g, '\n').split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  const out: ReactNode[] = [];
  blocks.forEach((block, i) => {
    const lines = block.split('\n');
    if (/^#{1,3}\s/.test(lines[0])) {
      out.push(<h2 key={`h${i}`} className="mt-8 text-xl font-bold first:mt-0">{lines[0].replace(/^#{1,3}\s+/, '')}</h2>);
      lines.shift();
      if (!lines.length) return;
    }
    if (lines.every((l) => /^[-*]\s/.test(l))) {
      out.push(
        <ul key={`u${i}`} className="mt-3 max-w-prose list-disc space-y-1 pl-5 leading-relaxed text-muted-foreground">
          {lines.map((l, j) => <li key={j}>{l.replace(/^[-*]\s+/, '')}</li>)}
        </ul>,
      );
      return;
    }
    out.push(<p key={`p${i}`} className="mt-3 max-w-prose whitespace-pre-line leading-relaxed text-muted-foreground">{lines.join('\n')}</p>);
  });
  return <>{out}</>;
}
