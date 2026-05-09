/**
 * @file src/tests/welcome/ConsentScannerStep.test.tsx
 *
 * Test Type: Component
 * Contexts Tested: Welcome flow UI
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ConsentScannerStep } from '@/welcome/steps/ConsentScannerStep';

describe('ConsentScannerStep', () => {
  it('renders the consent patterns and violation list', () => {
    render(<ConsentScannerStep theme="light" />);

    expect(
      screen.getByRole('heading', { name: /detect dark patterns before you click anything/i })
    ).toBeInTheDocument();

    ['Forced consent', 'Hidden reject', 'Pre-checked boxes'].forEach((title) => {
      expect(screen.getByText(title)).toBeInTheDocument();
    });

    expect(screen.getByText(/gdpr risk detected/i)).toBeInTheDocument();
    expect(screen.getByText(/reject button hidden behind accordion/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try a demo scan/i })).toBeInTheDocument();
  });

  it('applies dark theme styles to the container and violation card', () => {
    const { container } = render(<ConsentScannerStep theme="dark" />);

    const section = container.querySelector('section');
    expect(section?.className).toContain('bg-gray-800');
    expect(section?.className).toContain('border-gray-700');

    const violationCard = screen.getByText(/gdpr risk detected/i).closest('article');
    expect(violationCard?.className).toContain('bg-amber-900/30');
  });
});
