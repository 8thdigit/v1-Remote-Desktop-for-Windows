import { useEffect } from 'react';
import { ArrowLeft, ArrowUpRight, BookOpen, Code2, FlaskConical, ShieldCheck } from 'lucide-react';
import { Link } from 'wouter';

const repository = 'https://github.com/8thdigit/v1-Remote-Desktop-for-Windows';
const resources = [
  {
    title: 'Source repository',
    description: 'Browse the Windows host, browser viewer, HTTPS relay, and public commit history.',
    href: repository,
    icon: Code2,
  },
  {
    title: 'Windows host and build guide',
    description: 'See how the host is built, how pairing works, and what to check on a Windows PC.',
    href: `${repository}/tree/main/windows-host`,
    icon: BookOpen,
  },
  {
    title: 'Session tests',
    description: 'Read the tests for one-time pairing codes, host and viewer permissions, approval, and expiry.',
    href: `${repository}/blob/main/artifacts/api-server/tests/msfwr.test.mjs`,
    icon: FlaskConical,
  },
];

export default function Project() {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = 'Project status — Connect.AI';
    return () => { document.title = previousTitle; };
  }, []);

  return (
    <main className="min-h-[100dvh] bg-background text-foreground">
      <div className="mx-auto max-w-4xl px-5 pb-16 pt-6 sm:px-8 sm:pt-10">
        <Link href="/" className="inline-flex min-h-11 items-center gap-2 rounded-md text-sm font-semibold text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary">
          <ArrowLeft size={16} aria-hidden="true" /> Back to Connect.AI
        </Link>

        <header className="mt-7 border-b pb-8 sm:mt-10">
          <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Connect.AI · Early preview</p>
          <h1 className="mt-3 text-4xl font-extrabold tracking-tight sm:text-5xl">Project status</h1>
          <p className="mt-4 max-w-prose text-lg leading-relaxed text-muted-foreground">
            Connect.AI is an attended remote support tool for Windows. The person at the PC approves each connection and can stop sharing at any time.
          </p>
        </header>

        <section className="py-8" aria-labelledby="evidence-heading">
          <h2 id="evidence-heading" className="text-2xl font-bold">What you can verify</h2>
          <p className="mt-2 max-w-prose text-muted-foreground">Review the public source, build instructions, tests, and privacy practices for yourself.</p>
          <ul className="mt-5 grid gap-3 sm:grid-cols-2">
            {resources.map(({ title, description, href, icon: Icon }) => (
              <li key={href}>
                <a href={href} className="flex h-full gap-3 rounded-xl border bg-card p-4 hover:border-primary focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary sm:p-5">
                  <Icon size={19} className="mt-0.5 shrink-0 text-primary" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <span className="font-semibold">{title}</span>
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{description}</p>
                  </div>
                  <ArrowUpRight size={16} className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                </a>
              </li>
            ))}
            <li>
              <Link href="/privacy" className="flex h-full gap-3 rounded-xl border bg-card p-4 hover:border-primary focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary sm:p-5">
                <ShieldCheck size={19} className="mt-0.5 shrink-0 text-primary" aria-hidden="true" />
                <div>
                  <span className="font-semibold">Privacy and session data</span>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">See what the relay handles, what it keeps temporarily, and who can see the shared screen.</p>
                </div>
              </Link>
            </li>
          </ul>
        </section>

        <section className="rounded-xl border bg-card p-5 sm:p-6" aria-labelledby="stage-heading">
          <h2 id="stage-heading" className="text-xl font-bold">Current release and adoption status</h2>
          <p className="mt-2 max-w-prose leading-relaxed text-muted-foreground">
            The Windows installer is unsigned and is provided as a preview. This project page is not evidence of widespread use: it does not report verified download counts, independent reviews, or media coverage.
          </p>
        </section>
      </div>
    </main>
  );
}
