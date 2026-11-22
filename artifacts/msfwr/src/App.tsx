import { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import Home from '@/pages/home';
import Admin from '@/pages/admin';
import LinkPage from '@/pages/link';
import Privacy from '@/pages/privacy';
import Project from '@/pages/project';
import { SetupAdmin, SignIn } from '@/pages/sign-in';
import { AuthProvider, useAuthStatus } from '@/lib/auth';
import {
  Redirect,
  Route,
  Switch,
  useLocation,
  Router as WouterRouter,
} from 'wouter';

const queryClient = new QueryClient();

// Pages behind the login: the company's requests and PCs, and /admin.
function Signed({ children, admin = false }: { children: ReactNode; admin?: boolean }) {
  const status = useAuthStatus();
  if (status.isPending) {
    return <div className="dl-shell grid min-h-[100dvh] place-items-center text-sm text-muted-foreground"><span className="dl-pulse">Loading…</span></div>;
  }
  if (status.isError || !status.data) {
    return (
      <div className="dl-shell grid min-h-[100dvh] place-items-center px-4 text-center text-sm">
        <div>
          <p className="font-semibold">Could not reach the relay.</p>
          <button type="button" onClick={() => void status.refetch()} className="mt-3 rounded-xl border px-4 py-2 font-semibold hover:bg-muted">Try again</button>
        </div>
      </div>
    );
  }
  if (status.data.setupRequired) return <SetupAdmin />;
  if (!status.data.user) return <SignIn />;
  if (admin && status.data.user.role !== 'admin') {
    return (
      <div className="dl-shell grid min-h-[100dvh] place-items-center px-4 text-center text-sm">
        <div>
          <p className="text-lg font-bold">Only admins can open the admin console.</p>
          <a href="/" className="mt-3 inline-block font-semibold text-primary underline underline-offset-4">Back to requests and PCs</a>
        </div>
      </div>
    );
  }
  return <AuthProvider user={status.data.user}>{children}</AuthProvider>;
}

function Router() {
  // Older clients shared links as /?access=CODE.
  const access = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('access') : null;
  if (access && /^L[0-9A-F]{11}$/i.test(access)) return <Redirect to={`/r/${access.toUpperCase()}`} replace />;
  return (
    // Keep a shared shell (sidebar, navbar) outside the boundary so it
    // survives a page crash.
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/r/:code">{(params) => <LinkPage code={params.code} />}</Route>
        <Route path="/admin"><Signed admin><Admin /></Signed></Route>
        <Route path="/"><Signed><Home /></Signed></Route>
        <Route path="/privacy" component={Privacy} />
        <Route path="/project" component={Project} />
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
