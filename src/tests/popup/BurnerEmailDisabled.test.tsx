/**
 * @file src/tests/popup/BurnerEmailDisabled.test.tsx
 *
 * Test Type: Component
 * Contexts Tested: Popup UI
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BurnerEmailDisabled } from '@/popup/BurnerEmailDisabled';

describe('BurnerEmailDisabled', () => {
  it('renders the disabled message and button', () => {
    render(<BurnerEmailDisabled />);

    expect(
      screen.getByText(/feature is off\. enable it in settings/i)
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /go to settings/i })).toBeDisabled();
  });

  it('invokes handler when button is clicked', async () => {
    const user = userEvent.setup();
    const onOpenSettings = vi.fn();

    render(<BurnerEmailDisabled onOpenSettings={onOpenSettings} />);

    await user.click(screen.getByRole('button', { name: /go to settings/i }));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });
});
