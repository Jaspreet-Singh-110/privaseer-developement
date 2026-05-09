import { useState, useEffect } from 'react';
import { Mail, Copy, Trash2, Plus, ExternalLink } from 'lucide-react';
import type { BurnerEmail } from '../types';
import { logger } from '../utils/logger';
import { toError } from '../utils/type-guards';
import { BurnerEmailDisabled } from './BurnerEmailDisabled';
import { validateEmail } from '../utils/validation';

interface BurnerEmailsSectionProps {
  onOpenSettings?: () => void;
  isActive?: boolean;
}

/**
 * BurnerEmailsSection Component
 * 
 * Displays a list of burner emails with copy and delete functionality.
 * The component handles both enabled and disabled feature states.
 * 
 * @param props - Component props
 * @param props.onOpenSettings - Optional callback to open settings page
 * 
 * @remarks
 * When the burner email feature is disabled:
 * - Only new email generation is blocked
 * - Existing emails remain fully accessible
 * - Users can still view, copy, and delete previously created burner emails
 * - The email list is displayed regardless of feature state
 * - Copy and delete operations work regardless of feature state
 * 
 * @example
 * ```tsx
 * <BurnerEmailsSection onOpenSettings={() => setShowSettings(true)} />
 * ```
 */
export function BurnerEmailsSection({ onOpenSettings }: BurnerEmailsSectionProps = {}) {
  // Emails persist across feature toggles: once fetched they remain in state and storage
  // so users can resume accessing them even if the feature is later disabled
  const [emails, setEmails] = useState<BurnerEmail[]>([]);
  const [loading, setLoading] = useState(true);
  const [copiedEmail, setCopiedEmail] = useState<string | null>(null);
  // Default to false (disabled) - feature must be explicitly enabled by user
  const [isFeatureEnabled, setIsFeatureEnabled] = useState(false);
  const [realEmail, setRealEmail] = useState<string | null>(null);
  const [realEmailInput, setRealEmailInput] = useState<string>('');
  const [isSavingRealEmail, setIsSavingRealEmail] = useState(false);
  const [realEmailError, setRealEmailError] = useState<string | null>(null);

  useEffect(() => {
    loadFeatureState();
    loadEmails();
    loadRealEmail();

    const messageListener = (message: { type: string }) => {
      if (message.type === 'STATE_UPDATE') {
        loadFeatureState();
        // Don't reload email - let user control the input
      }
    };

    chrome.runtime.onMessage.addListener(messageListener);

    return () => {
      chrome.runtime.onMessage.removeListener(messageListener);
    };
  }, []);

  // Reload state when the tab becomes active to ensure consistency
  // This handles the case where settings were changed in another tab/section.
  // We deliberately avoid re-running when internal state changes to prevent loops.
  // Removed isActive effect - component now only mounts when active
  // Data loads on mount via the initial useEffect

  const loadFeatureState = async () => {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_BURNER_EMAIL_SETTING' });
      if (response.success) {
        logger.info('BurnerEmails', 'loadFeatureState: Setting isFeatureEnabled state', { enabled: response.enabled });
        setIsFeatureEnabled(response.enabled);
      } else {
        logger.warn('BurnerEmails', 'loadFeatureState: Response was not successful', { response });
      }
    } catch (error) {
      logger.error('BurnerEmails', 'Failed to load feature state', toError(error));
    }
  };

  const loadEmails = async () => {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_BURNER_EMAILS' });
      if (response.success) {
        setEmails(response.emails || []);
      }
    } catch (error) {
      logger.error('BurnerEmails', 'Failed to load emails', toError(error));
    } finally {
      setLoading(false);
    }
  };

  const loadRealEmail = async () => {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_REAL_EMAIL' });
      if (response.success) {
        const email = response.email || null;
        logger.info('BurnerEmails', 'loadRealEmail: Setting email state', { email: email ? 'present' : 'empty' });
        setRealEmail(email);
        // Don't set realEmailInput - let user control it
      } else {
        logger.warn('BurnerEmails', 'loadRealEmail: Response was not successful', { response });
      }
    } catch (error) {
      logger.error('BurnerEmails', 'Failed to load real email', toError(error));
    }
  };

  const handleSaveRealEmail = async () => {
    if (isSavingRealEmail) return;

    // Check if feature is enabled before allowing save
    if (!isFeatureEnabled) {
      setRealEmailError('Burner email feature is disabled. Please enable it in settings.');
      return;
    }

    // Use shared validation module for consistent validation
    const validation = validateEmail(realEmailInput);
    if (!validation.valid) {
      setRealEmailError(validation.error || 'Please enter a valid email address');
      return;
    }

    setIsSavingRealEmail(true);
    setRealEmailError(null);

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'SET_REAL_EMAIL',
        data: { email: validation.sanitized }
      });

      if (response.success) {
        setRealEmail(validation.sanitized!);
        setRealEmailInput('');
        logger.info('BurnerEmails', 'Real email saved successfully');
        
        // Reload feature state to ensure consistency after save
        await loadFeatureState();
      } else {
        setRealEmailError(response.error || 'Failed to save email');
        logger.error('BurnerEmails', 'Failed to save real email', new Error(response.error || 'Unknown error'));
      }
    } catch (error) {
      const err = toError(error);
      setRealEmailError('Failed to save email. Please try again.');
      logger.error('BurnerEmails', 'Failed to save real email', err);
    } finally {
      setIsSavingRealEmail(false);
    }
  };

  const maskEmail = (email: string): string => {
    if (!email) return '';
    const [local, domain] = email.split('@');
    if (!domain) return email;
    if (local.length <= 1) return `***@${domain}`;
    return `${local[0]}***@${domain}`;
  };

  // Copy functionality works regardless of feature state - users can copy emails even when disabled
  const copyEmail = async (email: string) => {
    try {
      await navigator.clipboard.writeText(email);
      setCopiedEmail(email);
      setTimeout(() => setCopiedEmail(null), 2000);
    } catch (error) {
      // Catch acts as a lightweight error boundary: we log but don't crash the UI
      logger.error('BurnerEmails', 'Failed to copy email', toError(error));
    }
  };

  // Delete functionality works regardless of feature state - users can delete emails even when disabled
  const deleteEmail = async (emailId: string) => {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'DELETE_BURNER_EMAIL',
        data: { emailId }
      });

      if (response.success) {
        setEmails(emails.filter(e => e.id !== emailId));
      }
    } catch (error) {
      // Deletion errors are logged but UI continues to render existing emails safely
      logger.error('BurnerEmails', 'Failed to delete email', toError(error));
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/3"></div>
          <div className="h-16 bg-gray-100 dark:bg-gray-800 rounded"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className={`text-lg font-semibold flex items-center gap-2 ${
            !isFeatureEnabled 
              ? 'text-gray-400 dark:text-gray-500' 
              : 'text-gray-900 dark:text-white'
          }`}>
            <Mail className={`w-5 h-5 ${
              !isFeatureEnabled 
                ? 'text-gray-400 dark:text-gray-500' 
                : 'text-blue-600 dark:text-blue-400'
            }`} />
            Burner Emails
          </h3>
          <p className={`text-xs mt-1 ${
            !isFeatureEnabled 
              ? 'text-gray-400 dark:text-gray-500' 
              : 'text-gray-600 dark:text-gray-400'
          }`}>
            Protected disposable emails for untrusted sites
          </p>
        </div>
      </div>

      {!isFeatureEnabled && (
        <BurnerEmailDisabled onOpenSettings={onOpenSettings} />
      )}

      {/* Email configuration section - only visible when feature is enabled */}
      {isFeatureEnabled && (
        <div className="mb-4 p-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg">
        <div className="flex items-start gap-3 mb-3">
          <div className="flex-shrink-0">
            <Mail className="w-5 h-5 text-blue-600 dark:text-blue-400 mt-0.5" />
          </div>
          <div className="flex-1 min-w-0">
            <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-1">
              Forwarding Email Address
            </h4>
            <p className="text-xs text-gray-600 dark:text-gray-400 mb-3">
              Emails sent to your burner addresses will be forwarded to this address. Your email is stored locally and never shared.
            </p>
            
            {realEmail && (
              <div className="mb-3 p-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                <p className="text-xs text-gray-600 dark:text-gray-400">
                  Current: <span className="font-mono text-gray-900 dark:text-white">{maskEmail(realEmail)}</span>
                </p>
              </div>
            )}

            <div className="space-y-2">
              <input
                type="email"
                value={realEmailInput}
                onChange={(e) => {
                  const val = e.target.value;
                  setRealEmailInput(val);
                  if (val.trim().length === 0) {
                    setRealEmailError(null);
                  } else {
                    const result = validateEmail(val.trim());
                    setRealEmailError(result.valid ? null : (result.error || 'Invalid email format'));
                  }
                }}
                placeholder="your.email@example.com"
                className={`w-full px-3 py-2 text-sm border rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:border-transparent transition-all ${
                  !isFeatureEnabled
                    ? 'bg-gray-100 dark:bg-gray-700 text-gray-400 dark:text-gray-500 border-gray-200 dark:border-gray-600 cursor-not-allowed'
                    : realEmailError
                    ? 'border-red-300 dark:border-red-600'
                    : 'border-gray-300 dark:border-gray-600'
                }`}
                disabled={isSavingRealEmail || !isFeatureEnabled}
                aria-disabled={!isFeatureEnabled}
                aria-invalid={!!realEmailError}
                aria-describedby={realEmailError ? 'email-validation-error' : undefined}
              />
              {realEmailError && (
                <p id="email-validation-error" className="text-xs text-red-600 dark:text-red-400 transition-opacity" role="alert">{realEmailError}</p>
              )}
              <button
                onClick={handleSaveRealEmail}
                disabled={isSavingRealEmail || !isFeatureEnabled || realEmailInput.trim() === (realEmail || '') || !!realEmailError || realEmailInput.trim().length === 0}
                className="w-full px-4 py-2 text-sm font-medium text-white bg-blue-600 dark:bg-blue-500 hover:bg-blue-700 dark:hover:bg-blue-600 disabled:bg-gray-300 dark:disabled:bg-gray-600 disabled:cursor-not-allowed rounded-lg transition-colors"
                aria-disabled={!isFeatureEnabled}
              >
                {isSavingRealEmail ? 'Saving...' : realEmail ? 'Update Email' : 'Save Email'}
              </button>
            </div>
          </div>
        </div>
      </div>
      )}

      {isFeatureEnabled && !realEmail && (
        <div className="mb-4 p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0">
              <Mail className="w-5 h-5 text-amber-600 dark:text-amber-400 mt-0.5" />
            </div>
            <div className="flex-1 min-w-0">
              <h4 className="text-sm font-semibold text-amber-900 dark:text-amber-200 mb-1">
                Forwarding Email Not Configured
              </h4>
              <p className="text-xs text-amber-800 dark:text-amber-300">
                To receive emails at your burner addresses, configure your forwarding email address above or in settings.
              </p>
            </div>
          </div>
        </div>
      )}

      {emails.length === 0 ? (
        <div className={`text-center py-8 px-4 rounded-xl border ${
          isFeatureEnabled
            ? 'bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 border-blue-100 dark:border-blue-800'
            : 'bg-gray-50 dark:bg-gray-800/40 border-gray-200 dark:border-gray-700'
        }`}>
          <Mail className={`w-12 h-12 mx-auto mb-3 ${
            isFeatureEnabled ? 'text-blue-400 dark:text-blue-500' : 'text-gray-400 dark:text-gray-500'
          }`} />
          <p className={`text-sm font-medium mb-1 ${
            isFeatureEnabled ? 'text-gray-900 dark:text-white' : 'text-gray-600 dark:text-gray-300'
          }`}>
            No burner emails yet
          </p>
          <p className="text-xs text-gray-600 dark:text-gray-400 mb-4">
            {isFeatureEnabled
              ? 'Focus any email field on a website to generate one'
              : 'Turn the feature back on to generate new burner emails'}
          </p>
          {isFeatureEnabled && (
            <div className="flex items-center justify-center gap-2 text-xs text-blue-700 dark:text-blue-300 bg-blue-100 dark:bg-blue-900/40 px-3 py-2 rounded-lg inline-flex">
              <Plus className="w-4 h-4" />
              <span>Click "Generate Burner Email" when you see it</span>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-2" role="list" aria-label="Burner email addresses">
          {emails.map((email) => (
            <div
              key={email.id}
              role="listitem"
              aria-label={`Burner email ${email.email_address} for ${email.domain}`}
              className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4 hover:border-blue-300 dark:hover:border-blue-500 hover:shadow-sm transition-all group"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <Mail className="w-4 h-4 text-blue-600 dark:text-blue-400 flex-shrink-0" />
                    <span className="text-sm font-mono font-medium text-gray-900 dark:text-white truncate">
                      {email.email_address}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
                    <ExternalLink className="w-3 h-3" />
                    <span className="truncate">{email.domain}</span>
                    <span className="text-gray-400 dark:text-gray-500">•</span>
                    <span>{formatDate(email.created_at)}</span>
                  </div>
                  {email.label && (
                    <div className="mt-2 text-xs text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-700 px-2 py-1 rounded inline-block">
                      {email.label}
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-1">
                  {/* Copy button uses native <button> semantics, so it is fully keyboard accessible */}
                  <button
                    onClick={() => copyEmail(email.email_address)}
                    aria-label={`Copy email address ${email.email_address}`}
                    className="p-2 hover:bg-blue-50 dark:hover:bg-blue-900/40 rounded-lg transition-colors group/copy"
                    title="Copy email"
                  >
                    {copiedEmail === email.email_address ? (
                      <svg className="w-4 h-4 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    ) : (
                      <Copy className="w-4 h-4 text-gray-400 group-hover/copy:text-blue-600 dark:group-hover/copy:text-blue-400" />
                    )}
                  </button>
                  {/* Delete button also relies on native <button> semantics for keyboard access */}
                  <button
                    onClick={() => deleteEmail(email.id)}
                    aria-label={`Delete email address ${email.email_address}`}
                    className="p-2 hover:bg-red-50 dark:hover:bg-red-900/40 rounded-lg transition-colors group/delete"
                    title="Delete email"
                  >
                    <Trash2 className="w-4 h-4 text-gray-400 group-hover/delete:text-red-600 dark:group-hover/delete:text-red-400" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {isFeatureEnabled && (
        <div className="pt-2 border-t border-gray-200 dark:border-gray-700">
          <div className="text-xs text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-800 p-3 rounded-lg">
            <p className="font-medium text-gray-900 dark:text-white mb-1">How it works:</p>
            <ul className="space-y-1 ml-4 list-disc">
              <li>Click any email field on a website</li>
              <li>Click "Generate Burner Email" button</li>
              <li>Email is automatically filled in</li>
              <li>Your identity stays protected</li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
