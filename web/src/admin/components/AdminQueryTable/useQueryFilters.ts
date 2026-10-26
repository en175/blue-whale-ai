import { useCallback, useState, type Dispatch, type SetStateAction } from "react";

export interface AppliedFilters<F extends Record<string, string>> {
  draft: F;
  setDraft: Dispatch<SetStateAction<F>>;
  applied: F;
  apply: () => void;
  reset: () => void;
  hasApplied: boolean;
  epoch: number;
}

export function useAppliedFilters<F extends Record<string, string>>(empty: F): AppliedFilters<F> {
  const [draft, setDraft] = useState<F>(empty);
  const [applied, setApplied] = useState<F>(empty);
  const [epoch, setEpoch] = useState(0);

  const apply = useCallback(() => {
    setApplied(draft);
    setEpoch((n) => n + 1);
  }, [draft]);

  const reset = useCallback(() => {
    setDraft(empty);
    setApplied(empty);
    setEpoch((n) => n + 1);
  }, [empty]);

  return { draft, setDraft, applied, apply, reset, epoch, hasApplied: hasAny(applied) };
}

function hasAny(filters: Record<string, string>): boolean {
  return Object.values(filters).some((value) => value !== "");
}

export interface PagedQuery {
  page: number;
  prev: () => void;
  next: () => void;
}

export function usePagedQuery(epoch: number): PagedQuery {
  const [state, setState] = useState({ epoch, page: 1 });
  const page = state.epoch === epoch ? state.page : 1;

  return {
    page,
    prev: () => setState({ epoch, page: Math.max(1, page - 1) }),
    next: () => setState({ epoch, page: page + 1 }),
  };
}

export interface OffsetPagination extends PagedQuery {
  kind: "offset";
  pageSize: number;
  total: number;
}

export interface CursorStack {
  page: number;
  pageToken: string;
  prev: () => void;
  next: (token: string) => void;
}

export function useCursorStack(epoch: number): CursorStack {
  const [state, setState] = useState({ epoch, tokens: [""] });
  const tokens = state.epoch === epoch ? state.tokens : [""];

  return {
    page: tokens.length,
    pageToken: tokens[tokens.length - 1] ?? "",
    prev: () => setState({ epoch, tokens: tokens.length > 1 ? tokens.slice(0, -1) : tokens }),
    next: (token: string) => {
      if (token) setState({ epoch, tokens: [...tokens, token] });
    },
  };
}

export interface CursorPagination extends Omit<CursorStack, "next"> {
  kind: "cursor";
  pageSize: number;
  nextToken: string;
  onNext: () => void;
}
