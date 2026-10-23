import { describe, expect, it, vi } from 'vitest';

// The island is rendered on the server first, where `location` and `document` do not exist.
vi.mock('astro:transitions/client', () => ({ navigate: () => {} }));
vi.mock('motion/react', async () => {
  const React = await import('react');
  return { AnimatePresence: ({ children }: any) => React.createElement(React.Fragment, null, children), motion: new Proxy({}, { get: () => (p: any) => React.createElement('div', null, p.children) }) };
});
vi.mock('../../src/styles/personal.css', () => ({}));

describe('Highlighter on the server', () => {
  it('renders without touching browser globals', async () => {
    const { renderToString } = await import('react-dom/server');
    const { createElement } = await import('react');
    const { default: Highlighter } = await import('../../src/components/islands/Highlighter');
    expect(() => renderToString(createElement(Highlighter))).not.toThrow();
  });
});
