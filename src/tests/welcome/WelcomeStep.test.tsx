/**
 * @file src/tests/welcome/WelcomeStep.test.tsx
 *
 * Test Type: Component
 * Contexts Tested: Welcome flow UI
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WelcomeStep } from '@/welcome/steps/WelcomeStep';

describe('WelcomeStep', () => {
  it('renders key content for the light theme', () => {
    const { container } = render(<WelcomeStep theme="light" />);

    expect(
      screen.getByRole('heading', {
        name: /your privacy copilot for every website you visit/i,
      })
    ).toBeInTheDocument();

    ['Real-time blocking', 'Consent guardrails', 'Secure identities'].forEach((title) => {
      expect(screen.getByText(title)).toBeInTheDocument();
    });

    const cards = container.querySelectorAll('article');
    expect(cards).toHaveLength(3);
    expect(cards[0]?.className).toContain('bg-white');

    const icons = container.querySelectorAll('svg');
    expect(icons.length).toBeGreaterThanOrEqual(4);
  });

  it('applies dark theme classes', () => {
    const { container } = render(<WelcomeStep theme="dark" />);

    const chip = screen.getByText(/welcome/i).closest('div');
    expect(chip?.className).toContain('bg-gray-800');

    const cards = container.querySelectorAll('article');
    expect(cards[0]?.className).toContain('bg-gray-800');
    expect(cards[0]?.className).toContain('border-gray-700');
  });
});
