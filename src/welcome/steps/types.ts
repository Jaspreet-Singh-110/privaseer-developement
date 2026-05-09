export type BurnerEmailFormStatus = 'idle' | 'success' | 'error';

export interface BurnerEmailProps {
  initialValue?: string;
  isSubmitting: boolean;
  status: BurnerEmailFormStatus;
  helperText?: string;
  errorMessage?: string;
  onSubmit: (email: string) => Promise<void>;
}

export interface StepContentProps {
  theme: 'light' | 'dark';
  burnerEmail?: BurnerEmailProps;
  onOpenSettings?: () => void;
  onLaunchDashboard?: () => void;
  trackerCount?: number;
  creditScore?: number | null;
  protectionEnabled?: boolean;
  emailConfigured?: boolean;
  onToggleProtection?: () => Promise<void>;
  onConfigureEmail?: () => Promise<void>;
  onRunDemoScan?: () => Promise<void>;
}

