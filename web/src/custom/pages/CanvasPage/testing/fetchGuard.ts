import { beforeEach, onTestFinished, vi } from 'vitest';

type FetchRoute = readonly [method: string, path: string];

export function createFetchGuard() {
  let handler: typeof fetch | undefined;
  let routes: readonly FetchRoute[] = [];
  const unexpected: string[] = [];
  const guardedFetch: typeof fetch = async (input, init) => {
    const request = typeof input === 'object' && 'url' in input ? input : undefined;
    const url = request ? request.url : String(input);
    const method = (init?.method ?? request?.method ?? 'GET').toUpperCase();
    if (handler && routes.some(([allowedMethod, path]) => allowedMethod === method && path === url.split('?')[0])) {
      return handler(input, init);
    }
    const message = `Unexpected fetch: ${method} ${url}`;
    unexpected.push(message);
    throw new Error(message);
  };
  return {
    fetch: guardedFetch,
    stub(nextHandler: typeof fetch, allowed: readonly FetchRoute[]) {
      handler = nextHandler;
      routes = allowed;
    },
    reset() {
      handler = undefined;
      routes = [];
    },
    assertNoUnexpectedRequests() {
      const requests = unexpected.splice(0);
      if (requests.length) throw new Error(requests.join('\n'));
    },
  };
}

export function installFetchGuard(defaultRoutes: readonly FetchRoute[] = []) {
  const guard = createFetchGuard();
  const install = () => { vi.stubGlobal('fetch', guard.fetch); };
  install();
  beforeEach(() => {
    guard.assertNoUnexpectedRequests();
    guard.reset();
    install();
    onTestFinished(() => {
      try {
        guard.assertNoUnexpectedRequests();
      } finally {
        guard.reset();
        install();
      }
    });
  });
  return {
    stub(handler: typeof fetch, routes: readonly FetchRoute[] = defaultRoutes) {
      guard.stub(handler, routes);
      install();
    },
    unstubGlobals() {
      vi.unstubAllGlobals();
      guard.reset();
      install();
    },
  };
}
