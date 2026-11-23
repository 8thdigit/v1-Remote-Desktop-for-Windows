import { useEffect } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Link } from 'wouter';
import { PageText, useSite } from '@/lib/site';

const sections = [
  {
    title: 'What is shared during a session',
    text: 'The relay processes the one-time connection code, verification number, and temporary session tokens used to pair the Windows host with the helper’s browser. Once the person at the PC approves, the host sends images of the primary display. If the helper enables remote input, the relay forwards their mouse and keyboard actions to the host.',
  },
  {
    title: 'What the relay keeps',
    text: 'The relay keeps temporary session details, the latest screen image, and queued input in memory. It does not record sessions or save their contents to a database. Ending a session or letting it expire clears its relay data. Pairing codes expire after three minutes, and approved sessions last no more than 30 minutes.',
  },
  {
    title: 'HTTPS and who can see the screen',
    text: 'The host and viewer connect to the relay over HTTPS. This protects traffic in transit, but it is not end-to-end encryption: the relay can read screen images and input. The helper can see anything visible on the shared display and could capture it separately. Only connect to a relay and helper you trust, and close sensitive windows before approving.',
  },
  {
    title: 'Website requests and logs',
    text: 'No account is required. App request logs can include technical details such as the request path, method, status, and response time. The infrastructure serving the site and relay may also process connection details such as IP addresses. The site loads fonts from Google Fonts, which receives your browser’s request.',
  },
  {
    title: 'Your controls',
    text: 'The Windows host does not share its screen before you approve. The host displays a live sharing indicator. Click Stop sharing on it or press Ctrl+2 or F12 on the Windows PC to stop. The helper can end the session in the browser. The app does not include audio streaming, clipboard sync, file transfer, or unattended access.',
  },
  {
    title: 'Privacy questions',
    text: 'For questions about a particular relay, including how its infrastructure handles logs, contact the person or organization that operates it.',
  },
];

function PageShell({ title, lead, children }: { title: string; lead?: string; children: React.ReactNode }) {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = `${title} — WINRSS.net`;
    return () => { document.title = previousTitle; };
  }, [title]);
  return (
    <main className="min-h-[100dvh] bg-background text-foreground">
      <div className="mx-auto max-w-3xl px-5 pb-16 pt-6 sm:px-8 sm:pt-10">
        <Link href="/" className="inline-flex min-h-11 items-center gap-2 rounded-md text-sm font-semibold text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary">
          <ArrowLeft size={16} aria-hidden="true" /> Back to WINRSS.net
        </Link>
        <header className="mt-7 border-b pb-7 sm:mt-10">
          <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">WINRSS.net · Attended remote support</p>
          <h1 className="mt-3 text-4xl font-extrabold tracking-tight sm:text-5xl" data-testid="text-page-title">{title}</h1>
          {lead && <p className="mt-4 max-w-prose text-lg text-muted-foreground">{lead}</p>}
        </header>
        {children}
      </div>
    </main>
  );
}

// The privacy page: the admin's own text when they wrote one in Site
// settings, otherwise the built-in notice below.
export default function Privacy() {
  const { site, loaded } = useSite();
  const page = site.pages.privacy;
  if (!loaded) return <PageShell title="Privacy"><p className="py-6 text-sm text-muted-foreground">Loading…</p></PageShell>;
  if (page.body.trim()) {
    return <PageShell title={page.title || 'Privacy'}><div className="py-6" data-testid="text-page-body"><PageText body={page.body} /></div></PageShell>;
  }
  return (
    <PageShell title="Privacy" lead="What WINRSS.net handles when you visit the site or start a remote support session.">
      {sections.map(({ title, text }) => (
        <section key={title} className="border-b py-6 last:border-b-0">
          <h2 className="text-xl font-bold">{title}</h2>
          <p className="mt-2 max-w-prose leading-relaxed text-muted-foreground">{text}</p>
        </section>
      ))}
    </PageShell>
  );
}

export function Disclaimer() {
  const { site, loaded } = useSite();
  const page = site.pages.disclaimer;
  if (!loaded) return <PageShell title="Disclaimer"><p className="py-6 text-sm text-muted-foreground">Loading…</p></PageShell>;
  return (
    <PageShell title={page.title || 'Disclaimer'}>
      <div className="py-6" data-testid="text-page-body">
        {page.enabled && page.body.trim() ? <PageText body={page.body} /> : <p className="text-muted-foreground">There is no disclaimer for this site yet.</p>}
      </div>
    </PageShell>
  );
}

// Footer links to the pages the admin has turned on.
export function SiteLinks({ className = '' }: { className?: string }) {
  const { site } = useSite();
  const cls = 'inline-flex min-h-11 items-center rounded-md font-semibold text-foreground underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary';
  return (
    <>
      {site.pages.privacy.enabled && <Link href="/privacy" className={`${cls} ${className}`}>{site.pages.privacy.title || 'Privacy'}</Link>}
      {site.pages.disclaimer.enabled && site.pages.disclaimer.body.trim() && (
        <Link href="/disclaimer" className={`${cls} ${className}`} data-testid="link-disclaimer">{site.pages.disclaimer.title || 'Disclaimer'}</Link>
      )}
    </>
  );
}
