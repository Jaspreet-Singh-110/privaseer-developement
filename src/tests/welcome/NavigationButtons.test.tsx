/**
 * @file src/tests/welcome/NavigationButtons.test.tsx
 *
 * Test Type: Component
 * Contexts Tested: Welcome flow UI
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NavigationButtons } from '@/welcome/components/NavigationButtons';

describe('NavigationButtons', () => {
  const baseProps = {
    currentStep: 0,
    totalSteps: 6,
    onBack: vi.fn(),
    onNext: vi.fn(),
    onSkip: vi.fn(),
    theme: 'light' as const,
  };

  it('renders skip button when enabled', async () => {
    render(<NavigationButtons {...baseProps} showSkip />);

    expect(screen.getByRole('button', { name: /skip tour/i })).toBeInTheDocument();
  });

  it('hides skip button when disabled', () => {
    render(<NavigationButtons {...baseProps} showSkip={false} />);

    expect(screen.queryByRole('button', { name: /skip tour/i })).toBeNull();
  });

  it('disables back button on first step', () => {
    render(<NavigationButtons {...baseProps} currentStep={0} />);

    const backButton = screen.getByRole('button', { name: /back/i });
    expect(backButton).toBeDisabled();
  });

  it('enables back button after first step', () => {
    render(<NavigationButtons {...baseProps} currentStep={1} />);

    const backButton = screen.getByRole('button', { name: /back/i });
    expect(backButton).not.toBeDisabled();
  });

  it('renders correct primary label by step position', () => {
    const { rerender } = render(<NavigationButtons {...baseProps} currentStep={0} />);
    expect(screen.getByRole('button', { name: /get started/i })).toBeInTheDocument();

    rerender(<NavigationButtons {...baseProps} currentStep={2} />);
    expect(screen.getByRole('button', { name: /continue/i })).toBeInTheDocument();

    rerender(<NavigationButtons {...baseProps} currentStep={5} />);
    expect(screen.getByRole('button', { name: /finish/i })).toBeInTheDocument();
  });

  it('uses custom labels when provided', () => {
    render(
      <NavigationButtons
        {...baseProps}
        primaryLabel="Next Step"
        secondaryLabel="Go Back"
      />
    );

    expect(screen.getByRole('button', { name: /next step/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /go back/i })).toBeInTheDocument();
  });

  it('disables primary button when loading', () => {
    render(<NavigationButtons {...baseProps} loading />);

    const primaryButton = screen.getByRole('button', { name: /working/i });
    expect(primaryButton).toBeDisabled();
  });

  it('fires callbacks for back, next, and skip', async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    const onNext = vi.fn();
    const onSkip = vi.fn();

    render(
      <NavigationButtons
        {...baseProps}
        currentStep={1}
        onBack={onBack}
        onNext={onNext}
        onSkip={onSkip}
      />
    );

    await user.click(screen.getByRole('button', { name: /back/i }));
    await user.click(screen.getByRole('button', { name: /continue/i }));
    await user.click(screen.getByRole('button', { name: /skip tour/i }));

    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(onSkip).toHaveBeenCalledTimes(1);
  });
});
