// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ChatbotShell } from './App';

afterEach(() => cleanup());

// Regression test for the post-login white screen (App.tsx:110):
// an effect deps array referencing state declared below it throws
// "Cannot access before initialization" and unmounts the whole app.
// Opening the chat panel exercises that exact mount path.
describe('ChatbotShell mount', () => {
  it('opens the panel and renders the greeting without throwing', () => {
    render(<ChatbotShell token="test-token" />);
    fireEvent.click(screen.getByRole('button', { name: 'Open Operations Assistant' }));
    expect(
      screen.getByText(/Ask me anything/, { exact: false }),
    ).toBeTruthy();
  });

  it('opens without window.matchMedia (old browsers, minimal DOMs)', () => {
    const original = window.matchMedia;
    // @ts-expect-error intentionally removed for the test
    delete window.matchMedia;
    try {
      render(<ChatbotShell token="test-token" />);
      fireEvent.click(screen.getByRole('button', { name: 'Open Operations Assistant' }));
      expect(document.body.textContent).toContain('Operations Assistant');
    } finally {
      window.matchMedia = original;
    }
  });
});
