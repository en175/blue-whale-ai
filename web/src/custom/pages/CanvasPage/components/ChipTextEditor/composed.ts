
export interface ComposedRef {
  id: string;
  label: string;
  prompt: string;
}

export type ComposedSegment =
  | { kind: 'text'; value: string }
  | { kind: 'ref'; ref: ComposedRef };

export interface ComposedValue {
  segments: ComposedSegment[];
}

export const EMPTY_COMPOSED: ComposedValue = { segments: [] };

export function composedLength(value: ComposedValue): number {
  return value.segments.reduce(
    (total, segment) => total + (segment.kind === 'text' ? segment.value.length : 1),
    0,
  );
}

export function composedIsEmpty(value: ComposedValue): boolean {
  return !value.segments.some((segment) => (segment.kind === 'ref' ? true : segment.value.trim().length > 0));
}

export function resolveComposed(value: ComposedValue): string {
  return value.segments
    .map((segment) => (segment.kind === 'text' ? segment.value : segment.ref.prompt))
    .join('');
}

export const BLOCK_SEPARATOR = '\n\n';
