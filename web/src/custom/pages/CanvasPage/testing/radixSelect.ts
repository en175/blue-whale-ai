import { act } from 'react';

export function selectOptionElements(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[role="option"]')];
}

export function selectOptionByText(label: string): HTMLElement | undefined {
  return selectOptionElements().find((el) => el.textContent === label);
}

export function selectOptionByTestId(testId: string): HTMLElement | undefined {
  return document.querySelector<HTMLElement>(`[role="option"][data-testid="${testId}"]`) ?? undefined;
}

export async function clickSelectOption(label: string): Promise<HTMLElement> {
  const option = selectOptionByText(label);
  if (!option) throw new Error(`未找到下拉选项：${label}`);
  await act(async () => {
    option.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  return option;
}

export async function clickSelectOptionByTestId(testId: string): Promise<HTMLElement> {
  const option = selectOptionByTestId(testId);
  if (!option) throw new Error(`未找到下拉选项 testid：${testId}`);
  await act(async () => {
    option.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  return option;
}
