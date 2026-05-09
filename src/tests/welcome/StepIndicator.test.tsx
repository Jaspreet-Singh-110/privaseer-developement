/**
 * @file src/tests/welcome/StepIndicator.test.tsx
 *
 * Test Type: Component
 * Contexts Tested: Welcome flow UI
 * Chrome APIs Mocked: None
 */

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StepIndicator } from '@/welcome/components/StepIndicator';

describe('StepIndicator', () => {
  it('renders step counter and total steps', () => {
    render(<StepIndicator currentStep={1} totalSteps={4} theme="light" />);

    expect(screen.getByText('Step 2')).toBeInTheDocument();
    expect(screen.getByText('4 total')).toBeInTheDocument();
  });

  it('renders progress bars with active, complete, and pending styles', () => {
    const { container } = render(
      <StepIndicator currentStep={1} totalSteps={3} theme="light" />
    );

    const bars = container.querySelectorAll('div.h-2.rounded-full');
    expect(bars.length).toBe(3);

    expect(bars[0]?.className).toContain('bg-gray-400');
    expect(bars[1]?.className).toContain('bg-blue-600');
    expect(bars[2]?.className).toContain('bg-gray-300');
  });

  it('renders labels when provided', () => {
    render(
      <StepIndicator
        currentStep={0}
        totalSteps={2}
        labels={['First', 'Second']}
        theme="light"
      />
    );

    expect(screen.getByText('First')).toBeInTheDocument();
    expect(screen.getByText('Second')).toBeInTheDocument();
  });

  it('applies dark theme counter styles', () => {
    const { container } = render(
      <StepIndicator currentStep={0} totalSteps={2} theme="dark" />
    );

    const counter = container.querySelector('div.text-xs');
    expect(counter?.className).toContain('text-gray-400');
  });
});
