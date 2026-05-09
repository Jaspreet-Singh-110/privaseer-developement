/**
 * @file src/tests/welcome/ProtectionStep.test.tsx
 *
 * Test Type: Component
 * Contexts Tested: Welcome flow UI
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProtectionStep } from '@/welcome/steps/ProtectionStep';

describe('ProtectionStep', () => {
  it('renders the protection messaging and live tracker controls', () => {
    const { container } = render(
      <ProtectionStep theme="light" trackerCount={14} protectionEnabled={true} />
    );

    expect(
      screen.getByRole('heading', {
        name: /firewall-grade blocking before trackers ever reach your browser/i,
      })
    ).toBeInTheDocument();

    expect(screen.getByText(/trackers blocked so far/i)).toBeInTheDocument();
    expect(screen.getByText('14')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /protection enabled/i })).toBeInTheDocument();

    const cards = container.querySelectorAll('article');
    expect(cards).toHaveLength(2);
  });

  it('applies dark theme styles to the container and cards', () => {
    const { container } = render(<ProtectionStep theme="dark" />);

    const section = container.querySelector('section');
    expect(section?.className).toContain('bg-gray-800');
    expect(section?.className).toContain('text-white');

    const cards = container.querySelectorAll('article');
    expect(cards[0]?.className).toContain('border-gray-700');
    expect(cards[1]?.className).toContain('bg-gray-800');
  });
});
