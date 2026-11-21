import { type ReactNode } from 'react';
import { Show } from '@clerk/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import Home from '@/pages/home';
import Privacy from '@/pages/privacy';
import Project from '@/pages/project';
import { basePath, OperatorAuth, OperatorSignIn, OperatorSignUp } from '@/operator-auth';
import {
  Route,
  Switch,
  useLocation,
  Router as WouterRouter,
  Redirect,
} from 'wouter';

const queryClient = new QueryClient();

function Router() {
  return (
    // Keep a shared shell (sidebar, navbar) outside the boundary so it
    // survives a page crash.
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/">
          <Show when="signed-in"><Redirect to="/viewer" /></Show>
          <Show when="signed-out"><Home /></Show>
        </Route>
        <Route path="/sign-in/*?" component={OperatorSignIn} />
        <Route path="/sign-up/*?" component={OperatorSignUp} />
        <Route path="/viewer">
          <Show when="signed-in"><Home viewer /></Show>
          <Show when="signed-out"><Redirect to="/sign-in" /></Show>
        </Route>
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
        <WouterRouter base={basePath}>
          <OperatorAuth><Router /></OperatorAuth>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
