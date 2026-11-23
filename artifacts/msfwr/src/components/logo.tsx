import { useSite } from '@/lib/site';

// The WINRSS.net logo: a screen with a remote pointer, on the ink tile.
// The same drawing is public/favicon.svg and the Windows app icon. An admin
// can replace it with an uploaded logo from /admin → Site settings.
export function LogoMark({ className = 'h-9 w-9' }: { className?: string }) {
  const { site } = useSite();
  if (site.logo) {
    return <img src={site.logo.url} alt="Logo" className={`${className} shrink-0 rounded-xl object-contain`} data-testid="img-site-logo" />;
  }
  return (
    <svg viewBox="0 0 64 64" className={`${className} shrink-0 drop-shadow-sm`} role="img" aria-label="WINRSS.net">
      <rect width="64" height="64" rx="15" fill="#17252C" />
      <rect x="10" y="13" width="40" height="29" rx="4.5" fill="none" stroke="#FFFFFF" strokeWidth="4.5" />
      <path d="M22 51h16" stroke="#FFFFFF" strokeWidth="4.5" strokeLinecap="round" />
      <path d="M31 22 L55 35.4 L45.2 38.4 L50.6 48.8 L45.2 51.6 L39.8 41.2 L32.2 47.8 Z"
        fill="#E34A1C" stroke="#17252C" strokeWidth="3.2" strokeLinejoin="round" />
    </svg>
  );
}

// "WINRSS" with ".net" in the accent colour.
export function Wordmark({ className = 'text-lg' }: { className?: string }) {
  return (
    <span className={`block font-extrabold tracking-tight ${className}`}>
      WINRSS<span className="text-primary">.net</span>
    </span>
  );
}
