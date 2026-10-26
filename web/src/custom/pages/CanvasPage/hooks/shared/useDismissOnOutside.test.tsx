// @vitest-environment jsdom
import { act, createElement, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useDismissOnOutside } from './useDismissOnOutside';

let root: Root;
let mountNode: HTMLDivElement;

function Harness() {
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [dropdownOpen, setDropdownOpen] = useState(true);
  const [hostOpen, setHostOpen] = useState(true);
  useDismissOnOutside([
    { open: dropdownOpen, ref: dropdownRef, dismiss: () => setDropdownOpen(false) },
  ]);
  if (!hostOpen) return createElement('div', { 'data-testid': 'gone' });
  return createElement('div', { 'data-testid': 'host' }, [
    createElement(
      'button',
      { key: 'close-host', type: 'button', onClick: () => setHostOpen(false) },
      '关闭对话框',
    ),
    dropdownOpen
      ? createElement('div', { key: 'drop', ref: dropdownRef, 'data-testid': 'dropdown' }, '下拉选项')
      : null,
  ]);
}

async function renderHarness() {
  mountNode = document.createElement('div');
  document.body.appendChild(mountNode);
  root = createRoot(mountNode);
  await act(async () => {
    root.render(createElement(Harness));
  });
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  mountNode?.remove();
});

describe('useDismissOnOutside', () => {
  it('closes the dropdown when pressing outside its root, and keeps the host dialog', async () => {
    await renderHarness();
    expect(mountNode.querySelector('[data-testid="dropdown"]')).not.toBeNull();
    expect(mountNode.querySelector('[data-testid="host"]')).not.toBeNull();

    await act(async () => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });

    expect(mountNode.querySelector('[data-testid="dropdown"]')).toBeNull();
    expect(mountNode.querySelector('[data-testid="host"]')).not.toBeNull();
    expect(mountNode.querySelector('[data-testid="gone"]')).toBeNull();
  });

  it('does not close the dropdown when pressing inside its root', async () => {
    await renderHarness();
    const dropdown = mountNode.querySelector('[data-testid="dropdown"]');
    expect(dropdown).not.toBeNull();

    await act(async () => {
      dropdown?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });

    expect(mountNode.querySelector('[data-testid="dropdown"]')).not.toBeNull();
    expect(mountNode.querySelector('[data-testid="host"]')).not.toBeNull();
  });
});

function MultiRefHarness() {
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [menuOpen, setMenuOpen] = useState(true);
  useDismissOnOutside([
    { open: menuOpen, ref: [menuRef, triggerRef], dismiss: () => setMenuOpen(false) },
  ]);
  return createElement('div', { 'data-testid': 'multi-host' }, [
    createElement('button', { key: 'trigger', ref: triggerRef, 'data-testid': 'multi-trigger' }, '触发'),
    menuOpen
      ? createElement('div', { key: 'menu', ref: menuRef, 'data-testid': 'multi-menu' }, '菜单')
      : null,
  ]);
}

describe('useDismissOnOutside 多 ref 层', () => {
  it('点击层内任一 ref 不关闭，层外才关闭', async () => {
    mountNode = document.createElement('div');
    document.body.appendChild(mountNode);
    root = createRoot(mountNode);
    await act(async () => {
      root.render(createElement(MultiRefHarness));
    });

    const column = mountNode.querySelector('[data-testid="multi-trigger"]');
    await act(async () => {
      column?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(mountNode.querySelector('[data-testid="multi-menu"]')).not.toBeNull();

    await act(async () => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(mountNode.querySelector('[data-testid="multi-menu"]')).toBeNull();
  });
});
