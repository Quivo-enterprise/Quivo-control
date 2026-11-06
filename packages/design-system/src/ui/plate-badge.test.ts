import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PlateBadge } from './primitives.js';

describe('PlateBadge', () => {
  it('no marca el tamaño grande por defecto', () => {
    const html = renderToStaticMarkup(createElement(PlateBadge, { plate: '4701EHA' }));
    expect(html).toContain('qv-plate');
    expect(html).not.toContain('qv-plate--lg');
    expect(html).toContain('4701EHA');
  });

  it('size="lg" agrega el modificador y conserva className', () => {
    const html = renderToStaticMarkup(createElement(PlateBadge, { plate: '4701EHA', size: 'lg', className: 'extra-clase' }));
    expect(html).toContain('class="qv-plate qv-plate--lg extra-clase"');
  });
});
