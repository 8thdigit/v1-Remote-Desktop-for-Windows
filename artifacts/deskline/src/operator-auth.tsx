import type { ReactNode } from 'react';
import { ClerkProvider, SignIn, SignUp } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import { Link, useLocation } from 'wouter';

export const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

export function OperatorAuth({ children }: { children: ReactNode }) {
  const [, setLocation] = useLocation();
  if (!clerkPubKey) {
    return <p role="alert" className="m-6">The operator sign-in service is not configured.</p>;
  }
  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      signInFallbackRedirectUrl={`${basePath}/viewer`}
      signUpFallbackRedirectUrl={`${basePath}/viewer`}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
      appearance={{
        theme: shadcn,
        cssLayerName: 'clerk',
        variables: {
          colorPrimary: '#b93f16', colorForeground: '#192a30',
          colorMutedForeground: '#485b62', colorBackground: '#fbf8f1',
          colorInput: '#fffdf7', colorInputForeground: '#192a30',
          colorDanger: '#9c2734', colorNeutral: '#192a30',
          fontFamily: 'Bricolage Grotesque, sans-serif', borderRadius: '0.625rem',
        },
        options: {
          logoPlacement: 'inside',
          logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
          logoLinkUrl: `${basePath}/`,
        },
        elements: {
          cardBox: 'w-[440px] max-w-full overflow-hidden',
          rootBox: 'max-w-full',
        },
      }}
      localization={{
        signIn: { start: { title: 'Sign in to winss132r', subtitle: 'For the approved lab operator' } },
        signUp: { start: { title: 'Create your operator account', subtitle: 'Only the approved lab email can start a session' } },
      }}
    >
      {children}
    </ClerkProvider>
  );
}

export function OperatorSignIn() {
  return (
    <AuthScreen>
      <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} />
    </AuthScreen>
  );
}

export function OperatorSignUp() {
  return (
    <AuthScreen>
      <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />
    </AuthScreen>
  );
}

function AuthScreen({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-[100dvh] flex-col items-center justify-center gap-6 bg-background px-4 py-8">
      {children}
      <Link href="/" className="px-2 py-2 font-semibold text-primary underline underline-offset-4">Back to winss132r</Link>
    </main>
  );
}
