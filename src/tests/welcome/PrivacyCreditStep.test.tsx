/**
 * @file src/tests/welcome/PrivacyCreditStep.test.tsx
 *
 * Test Type: Component
 * Contexts Tested: Welcome flow UI
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PrivacyCreditStep } from '@/welcome/steps/PrivacyCreditStep';

describe('PrivacyCreditStep', () => {
  it('renders the score summary, scale, and factors', () => {
    render(<PrivacyCreditStep theme="light" creditScore={720} />);

    expect(screen.getAllByText('720').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/good/i).length).toBeGreaterThan(0);

    ['300', '550', '750', '850'].forEach((label) => {
      expect(screen.getByText(label)).toBeInTheDocument();
    });

    const factors = [
      { name: 'Protection Consistency', impact: '+87' },
      { name: 'Clean Browsing', impact: '+34' },
      { name: 'High-Risk Exposure', impact: '-12' },
      { name: 'Violations', impact: '-25' },
    ];

    factors.forEach((factor) => {
      expect(screen.getByText(factor.name)).toBeInTheDocument();
      expect(screen.getByText(factor.impact)).toBeInTheDocument();
    });

    const positive = screen.getByText('Protection Consistency').closest('li');
    const negative = screen.getByText('High-Risk Exposure').closest('li');
    expect(positive?.className).toContain('border-emerald-200');
    expect(negative?.className).toContain('border-red-200');
  });

  it('renders placeholder state when score is unavailable', () => {
    render(<PrivacyCreditStep theme="light" creditScore={null} />);
    expect(screen.getByText('--')).toBeInTheDocument();
    expect(screen.getByText(/browse a few sites/i)).toBeInTheDocument();
    expect(screen.getByText(/no data yet/i)).toBeInTheDocument();
  });

  it('applies dark theme factor styles', () => {
    render(<PrivacyCreditStep theme="dark" />);

    const positive = screen.getByText('Clean Browsing').closest('li');
    const negative = screen.getByText('Violations').closest('li');

    expect(positive?.className).toContain('border-emerald-900/60');
    expect(negative?.className).toContain('border-red-900/60');
  });
});
