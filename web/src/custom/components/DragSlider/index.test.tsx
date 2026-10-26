// @vitest-environment jsdom
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DragSlider from './index';

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
  disabled,
}: {
  initial: number;
  onChange: (next: number) => void;
  disabled?: boolean;
}) {
  const [value, setValue] = useState(initial);
  return createElement(DragSlider, {
    value,
    min: 4,
    max: 15,
    step: 1,
    disabled,
    ariaLabel: '时长',
    ariaValueText: `${value}s`,
    testId: 'drag-slider-native',
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

describe('DragSlider', () => {
  it('shows committed value on the visual slider and native range', async () => {
    const onChange = vi.fn();
    await act(async () => {
      root.render(createElement(Harness, { initial: 10, onChange }));
    });
    const slider = mountNode.querySelector('[role="slider"]') as HTMLElement;
    const native = mountNode.querySelector<HTMLInputElement>('[data-testid="drag-slider-native"]')!;
    expect(slider.getAttribute('aria-valuenow')).toBe('10');
    expect(slider.getAttribute('aria-valuetext')).toBe('10s');
    expect(native.value).toBe('10');
    expect(native.min).toBe('4');
    expect(native.max).toBe('15');
  });

  it('commits a native range input event', async () => {
    const onChange = vi.fn();
    await act(async () => {
      root.render(createElement(Harness, { initial: 10, onChange }));
    });
    const native = mountNode.querySelector<HTMLInputElement>('[data-testid="drag-slider-native"]')!;
    await act(async () => {
      nativeInput(native, '8');
    });
    expect(onChange).toHaveBeenCalledWith(8);
  });

  it('steps with arrow keys on the visual slider', async () => {
    const onChange = vi.fn();
    await act(async () => {
      root.render(createElement(Harness, { initial: 10, onChange }));
    });
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

  it('does not change value when disabled', async () => {
    const onChange = vi.fn();
    await act(async () => {
      root.render(createElement(Harness, { initial: 10, onChange, disabled: true }));
    });
    const native = mountNode.querySelector<HTMLInputElement>('[data-testid="drag-slider-native"]')!;
    await act(async () => {
      nativeInput(native, '8');
    });
    expect(onChange).not.toHaveBeenCalled();
    expect(native.disabled).toBe(true);
  });
});
