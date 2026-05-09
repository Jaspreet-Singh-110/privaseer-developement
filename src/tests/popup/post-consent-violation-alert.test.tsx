/**
 * TEST FILE: Popup Post-Consent Violation Alert UI
 *
 * Test Type: Unit
 * Contexts Tested: Popup (alert item component)
 * Chrome APIs Mocked: None (component-level test)
 * Prerequisites:
 *   - Uses wrapper component to manage local expanded state
 *
 * Coverage Target: AlertItem rendering + report action for post-consent violations
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import type { Alert } from '../../types';
import { AlertItem } from '../../popup/popup';

const buildPostConsentAlert = (): Alert => ({
  id: 'pcv-123',
  type: 'post_consent_violation',
  severity: 'high',
  message: 'Alert: This site may be violating privacy laws. It loaded 2 trackers after you denied consent.',
  domain: 'video.example',
  timestamp: Date.now(),
  trackerCount: 2,
  blockedTrackers: ['tracker.one.com', 'tracker.two.com'],
  url: 'https://video.example/watch',
});

function AlertItemWrapper({
  alert,
  onReport,
}: {
  alert: Alert;
  onReport: (alert: Alert) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <AlertItem
      alert={alert}
      isExpanded={expanded}
      onToggleExpanded={() => setExpanded(prev => !prev)}
      onReport={onReport}
    />
  );
}

describe('AlertItem - post consent violation UI', () => {
  it('shows violation details and report affordance', async () => {
    const alert = buildPostConsentAlert();
    const handleReport = vi.fn();
    const user = userEvent.setup();

    render(<AlertItemWrapper alert={alert} onReport={handleReport} />);

    const detailsButton = await screen.findByTitle('Show violation details');
    await user.click(detailsButton);

    await screen.findByText('Potential privacy issue');
    expect(screen.getByText('tracker.one.com')).toBeTruthy();

    const reportButton = screen.getByRole('button', { name: /report/i });
    await user.click(reportButton);

    expect(handleReport).toHaveBeenCalledTimes(1);
    expect(handleReport).toHaveBeenCalledWith(alert);
  });
});
