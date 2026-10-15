// @vitest-environment jsdom
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DurationSlider from './DurationSlider';

let root: Root;
let mountNode: HTMLDivElement;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  mountNode = document.createElement('div');
  document.body.appendChild(mountNode);
  root = createRoot(mountNode);
});

afterEach(async () => {
  await act(async () => root.unmount());
  mountNode.remove();
});

function Harness({
  initial,
  onChange,
}: {
  initial: number;
  onChange: (next: number) => void;
}) {
  const [value, setValue] = useState(initial);
  return createElement(DurationSlider, {
    value,
    onChange: (next) => {
      onChange(next);
      setValue(next);
    },
  });
}

function nativeInput(input: HTMLInputElement, next: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, next);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

async function renderHarness(initial: number) {
  const onChange = vi.fn();
  await act(async () => {
    root.render(createElement(Harness, { initial, onChange }));
  });
  return onChange;
}

describe('DurationSlider', () => {
  it('shows the current duration on the slider and numeric field', async () => {
    await renderHarness(14);
    const slider = mountNode.querySelector('[role="slider"]') as HTMLElement;
    const input = mountNode.querySelector('input[aria-label="时长秒数"]') as HTMLInputElement;
    expect(slider.getAttribute('aria-valuenow')).toBe('14');
    expect(slider.getAttribute('aria-valuetext')).toBe('14s');
    expect(input.value).toBe('14');
    expect(mountNode.querySelector('span')?.textContent).toBe('s');
  });

  it('commits a typed duration on blur', async () => {
    const onChange = await renderHarness(15);
    const input = mountNode.querySelector('input[aria-label="时长秒数"]') as HTMLInputElement;

    await act(async () => {
      input.focus();
      nativeInput(input, '8');
    });
    await act(async () => {
      input.blur();
    });

    expect(onChange).toHaveBeenCalledWith(8);
    expect(input.value).toBe('8');
  });

  it('clamps out-of-range input and restores invalid text to the current value', async () => {
    const onChange = await renderHarness(10);
    const input = mountNode.querySelector('input[aria-label="时长秒数"]') as HTMLInputElement;

    await act(async () => {
      input.focus();
      nativeInput(input, '40');
    });
    await act(async () => {
      input.blur();
    });
    expect(onChange).toHaveBeenCalledWith(15);
    expect(input.value).toBe('15');

    onChange.mockClear();
    await act(async () => {
      input.focus();
      nativeInput(input, 'abc');
    });
    await act(async () => {
      input.blur();
    });
    expect(onChange).not.toHaveBeenCalled();
    expect(input.value).toBe('15');
  });

  it('steps the committed duration with arrow keys', async () => {
    const onChange = await renderHarness(10);
    const slider = mountNode.querySelector('[role="slider"]') as HTMLElement;

    await act(async () => {
      slider.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith(9);

    await act(async () => {
      slider.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith(15);
  });
});
