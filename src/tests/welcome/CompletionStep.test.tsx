/**
 * @file src/tests/welcome/CompletionStep.test.tsx
 *
 * Test Type: Component
 * Contexts Tested: Welcome flow UI
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CompletionStep } from '@/welcome/steps/CompletionStep';

describe('CompletionStep', () => {
  it('renders completion summary content', () => {
    render(<CompletionStep theme="light" />);

    expect(
      screen.getByRole('heading', {
        name: /privaseer is guarding every tab/i,
      })
    ).toBeInTheDocument();

    expect(screen.getByText(/protection active/i)).toBeInTheDocument();
    expect(screen.getByText(/burner email ready/i)).toBeInTheDocument();
    expect(screen.getByText(/privacy credit at a glance/i)).toBeInTheDocument();

    ['Protection Consistency', 'Clean Browsing', 'High-Risk Exposure', 'Consent Violations'].forEach(
      (label) => {
        expect(screen.getByText(label)).toBeInTheDocument();
      }
    );

    expect(
      screen.getByText(/tip: use the finish button below to close the tour/i)
    ).toBeInTheDocument();
  });

  it('applies dark theme container styles', () => {
    const { container } = render(<CompletionStep theme="dark" />);
    const section = container.querySelector('section');
    expect(section?.className).toContain('bg-green-900/30');
    expect(section?.className).toContain('border-green-700');
  });
});
