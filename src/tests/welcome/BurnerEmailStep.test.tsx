/**
 * @file src/tests/welcome/BurnerEmailStep.test.tsx
 *
 * Test Type: Component
 * Contexts Tested: Welcome flow UI
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BurnerEmailStep } from '@/welcome/steps/BurnerEmailStep';

describe('BurnerEmailStep', () => {
  it('renders the feature cards and helper text', () => {
    const { container } = render(<BurnerEmailStep theme="light" emailConfigured={false} />);

    expect(
      screen.getByRole('heading', {
        name: /protect your inbox with aliases that forward instantly/i,
      })
    ).toBeInTheDocument();

    ['Instant Forwarding', 'Single-use Identities', 'Spam Detox'].forEach((title) => {
      expect(screen.getByText(title)).toBeInTheDocument();
    });

    const cards = container.querySelectorAll('article');
    expect(cards).toHaveLength(3);

    expect(screen.getByText(/set your forwarding email now/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /configure email now/i })).toBeInTheDocument();
  });

  it('applies dark theme container styles', () => {
    const { container } = render(<BurnerEmailStep theme="dark" />);
    const section = container.querySelector('section');
    expect(section?.className).toContain('bg-gray-800');
    expect(section?.className).toContain('border-gray-700');
  });

  it('shows configured state when email is already set', () => {
    render(<BurnerEmailStep theme="light" emailConfigured={true} />);
    expect(screen.getByText(/forwarding email is configured/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /configure email now/i })).not.toBeInTheDocument();
  });
});
