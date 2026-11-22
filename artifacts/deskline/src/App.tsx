import { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Radio } from 'lucide-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import Home from '@/pages/home';
import Admin from '@/pages/admin';
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

function Splash({ text, retry }: { text: string; retry?: () => void }) {
  return (
    <div className="dl-shell grid min-h-[100dvh] place-items-center px-4 text-center text-foreground">
      <div>
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-foreground text-background">
          <Radio className="h-5 w-5 text-primary" />
        </span>
        <p className={`mt-4 text-sm text-muted-foreground ${retry ? '' : 'dl-pulse'}`}>{text}</p>
        {retry && (
          <button type="button" onClick={retry} className="mt-4 rounded-xl bg-foreground px-4 py-2 text-sm font-bold text-background">Try again</button>
        )}
      </div>
    </div>
  );
}

// Everything except the public pages needs a portal account.
function Gate() {
  const status = useAuthStatus();
  const [location] = useLocation();
  if (location === '/privacy') return <Privacy />;
  if (location === '/project') return <Project />;
  if (status.isPending) return <Splash text="Connecting to the relay…" />;
  if (status.isError || !status.data) return <Splash text="Could not reach the relay." retry={() => void status.refetch()} />;
  if (status.data.setupRequired) return <SetupAdmin />;
  const user = status.data.user;
  if (!user) return <SignIn />;
  return (
    <AuthProvider user={user}>
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/admin">{user.role === 'admin' ? <Admin /> : <Redirect to="/" />}</Route>
        <Route component={NotFound} />
      </Switch>
    </AuthProvider>
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
          <RoutedErrorBoundary>
            <Gate />
          </RoutedErrorBoundary>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
