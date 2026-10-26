# Frontend server state (TanStack Query)

Constraint for **newly generated** `web/` code. Transport stays `web/src/shared/api/http.ts` (`apiRequest` / `http`, envelope unwrap, 401, default toast, `silent`). Do not migrate existing `useEffect` fetch in the same change.

```
New page / new data source / new polling?
  yes → useQuery / useMutation (this file)
  no, Bugfix on existing useEffect fetch → keep that file's current style
Zustand UI, SSE, WebSocket → not Query
```

## Bootstrap (only if `@tanstack/react-query` is missing)

Same PR as the first feature that needs Query. Add the dependency and wrap the tree in `web/src/main.tsx`. Do not rewrite other pages.

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { isApiError } from '@/api/http'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: (count, error) => {
        if (isApiError(error) && error.status < 500) return false
        return count < 1
      },
    },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)
```

Never retry 4xx (401 would re-enter `handleUnauthorized`).

## queryOptions

Co-locate with the resource in `web/src/custom/api/` or `web/src/admin/api/`. Shared transport is `web/src/shared/api/http.ts`. `queryFn` calls `apiRequest` / `http` with `{ silent: true }`. Pages import the factory, not a raw path string.

```ts
// web/src/custom/api/projects.ts — next to existing fetch helpers
import { queryOptions } from '@tanstack/react-query'
import { apiRequest } from '@/shared/api/http'

export const projectKeys = {
  all: ['projects'] as const,
  list: () => [...projectKeys.all, 'list'] as const,
}

export function projectListOptions() {
  return queryOptions({
    queryKey: projectKeys.list(),
    queryFn: () => apiRequest<ProjectRecord[]>('/api/projects', { silent: true }),
  })
}
```

```tsx
const list = useQuery(projectListOptions())
if (list.isPending) return <p>加载中</p>
if (list.isError) {
  return <p>{isApiError(list.error) ? list.error.message : '项目列表加载失败'}</p>
}
```

`enabled: Boolean(id)` when the key needs an id. Detail keys: `[...resourceKeys.all, 'detail', id]`.

## Mutations

`mutationFn` may use existing api helpers (http default toast). Do **not** toast again in `onError`. Invalidate with the factory key, not a one-off string.

```tsx
const queryClient = useQueryClient()
const create = useMutation({
  mutationFn: createProject,
  onSuccess: () => {
    void queryClient.invalidateQueries({ queryKey: projectKeys.all })
  },
})
```

Form-local errors: pass `{ silent: true }` into the api helper and set local error state. Do not also `toast.error`.

## Polling

New polling: `useQuery` + `refetchInterval` (and `silent: true` in `queryFn`). Do not `setInterval` + `fetch` for new server polling.

## Tests

Wrap with a dedicated `QueryClient` (`queries.retry: false`). Keep envelope/401 tests in `http.test.ts`.

## Do not

| Excuse | Reality |
| --- | --- |
| "This page is simple, useEffect is fine" | New server state still uses Query. |
| "I'll migrate nearby lists while here" | Out of scope unless that surface is the task. |
| "queryFn can toast and the page can show query.error" | Queries are silent; one error surface only. |
| "Query default retry is fine" | 4xx must not retry. |
| "queryKey is the URL, skip queryFn" | Typed api module + `queryOptions`. No defaultQueryFn. |
