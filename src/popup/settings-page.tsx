import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X, MessageSquare, Send, Info, Palette, Mail, ChevronRight, ArrowLeft, Sun, Moon, Monitor, BarChart2, Download, Trash2 } from 'lucide-react';
import { logger } from '../utils/logger';
import { toError } from '../utils/type-guards';
import { ThemeManager } from '../utils/theme-manager';
import { validateEmail } from '../utils/validation';
import type { Alert as AlertType, AllSettingsResponse } from '../types';

export type SettingsSection = 'menu' | 'feedback' | 'theme' | 'burner-services' | 'telemetry' | 'about';
type ThemeOption = 'light' | 'dark' | 'system';

export interface SettingsPageProps {
  isOpen: boolean;
  onClose: () => void;
  currentTab: chrome.tabs.Tab | null;
  onFeedbackSuccess: () => void;
  deepLinkSection?: SettingsSection | null;
  highlightBurnerToggle?: boolean;
  onBurnerHighlightComplete?: () => void;
  reportContext?: AlertType | null;
  onReportClear?: () => void;
  standalone?: boolean;
}

export function SettingsPage({
  isOpen,
  onClose,
  currentTab,
  onFeedbackSuccess,
  deepLinkSection,
  highlightBurnerToggle = false,
  onBurnerHighlightComplete,
  reportContext = null,
  onReportClear,
  standalone = false,
}: SettingsPageProps) {
  const [activeSection, setActiveSection] = useState<SettingsSection>('menu');
  const [feedbackText, setFeedbackText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedTheme, setSelectedTheme] = useState<ThemeOption>('system');
  const [isNavigatingForward, setIsNavigatingForward] = useState(true);
  const [isApplyingTheme, setIsApplyingTheme] = useState(false);
  const [isBurnerEmailEnabled, setIsBurnerEmailEnabled] = useState(false);
  const [isTogglingBurnerEmail, setIsTogglingBurnerEmail] = useState(false);
  const [shouldHighlightBurnerToggle, setShouldHighlightBurnerToggle] = useState(false);
  const [isTelemetryEnabled, setIsTelemetryEnabled] = useState(false);
  const [isTogglingTelemetry, setIsTogglingTelemetry] = useState(false);
  const [realEmail, setRealEmail] = useState<string>('');
  const [realEmailInput, setRealEmailInput] = useState<string>('');
  const [isSavingRealEmail, setIsSavingRealEmail] = useState(false);
  const [realEmailError, setRealEmailError] = useState<string | null>(null);
  const [isExportingData, setIsExportingData] = useState(false);
  const [exportFormat, setExportFormat] = useState<'json' | 'csv'>('json');
  const [includeEmailInExport, setIncludeEmailInExport] = useState(false);
  const [isDeletingData, setIsDeletingData] = useState(false);
  const burnerToggleRef = useRef<HTMLButtonElement | null>(null);
  const isTogglingRef = useRef(false);

  const loadAllSettings = useCallback(async (options?: { skipBurnerUpdate?: boolean }) => {
    const shouldSkipBurner = options?.skipBurnerUpdate || isTogglingRef.current;

    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_ALL_SETTINGS' });
      if (response.success && response.settings) {
        const { theme, burnerEmailEnabled, telemetryEnabled, realEmail } = response.settings as AllSettingsResponse;

        setSelectedTheme(theme ?? 'system');
        setIsTelemetryEnabled(Boolean(telemetryEnabled));

        if (!shouldSkipBurner) {
          setIsBurnerEmailEnabled(Boolean(burnerEmailEnabled));
        } else {
          logger.debug('Settings', 'loadAllSettings: Skipped burner update due to toggle/highlight');
        }

        const email = realEmail || '';
        setRealEmail(email);
        // Don't set realEmailInput - let user control it
      } else {
        logger.warn('Settings', 'loadAllSettings: Response was not successful', { response });
      }
    } catch (error) {
      logger.error('Settings', 'Failed to load settings', toError(error));
    }
  }, []);

  // Run once on mount to register listeners
  useEffect(() => {
    const messageListener = (message: { type: string }) => {
      if (message.type === 'STATE_UPDATE') {
        logger.debug('Settings', 'STATE_UPDATE received, reloading settings');
        loadAllSettings({ skipBurnerUpdate: isTogglingRef.current });
      }
    };

    chrome.runtime.onMessage.addListener(messageListener);

    return () => {
      chrome.runtime.onMessage.removeListener(messageListener);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reload state when settings modal opens to ensure consistency.
  // Refetch only when modal visibility/deep-link inputs change.
  useEffect(() => {
    if (isOpen) {
      logger.info('Settings', 'Modal opened, reloading state');

      // When arriving via burner deep-link (highlightBurnerToggle), skip updating burner state
      // to avoid immediately overwriting the user's intent.
      loadAllSettings({ skipBurnerUpdate: highlightBurnerToggle || isTogglingRef.current });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, highlightBurnerToggle]);

  // Reload burner email setting when navigating to burner-services section.
  // Restrict to section/nav changes to avoid redundant fetch loops.
  useEffect(() => {
    if (isOpen && activeSection === 'burner-services' && !highlightBurnerToggle) {
      logger.info('Settings', 'Navigated to burner-services, reloading state');
      loadAllSettings({ skipBurnerUpdate: isTogglingRef.current });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, activeSection, highlightBurnerToggle]);

  const handleSaveRealEmail = async () => {
    if (isSavingRealEmail) return;

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
        logger.info('Settings', 'Real email saved successfully');
      } else {
        setRealEmailError(response.error || 'Failed to save email');
        logger.error('Settings', 'Failed to save real email', new Error(response.error || 'Unknown error'));
      }
    } catch (error) {
      const err = toError(error);
      setRealEmailError('Failed to save email. Please try again.');
      logger.error('Settings', 'Failed to save real email', err);
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

  /**
   * Handles toggling the burner email feature on/off.
   * 
   * This function manages the toggle state and coordinates with the service worker
   * to update the burner email setting. It includes race condition protection and
   * error recovery mechanisms.
   * 
   * @remarks
   * Race Condition Handling:
   * - Uses `isTogglingBurnerEmail` flag to prevent concurrent toggle operations
   * - Returns early with a warning log if a toggle is already in progress
   * - The message bus in the service worker also processes requests sequentially
   * 
   * Error Recovery:
   * - On failure, reloads the current setting from storage to restore accurate state
   * - Logs detailed error information including attempted and previous values
   * - Always resets the toggle flag in finally block to prevent stuck state
   * 
   * Logging:
   * - Debug log when toggle starts (with current and new values)
   * - Info log on successful update (with previous and new values)
   * - Error logs on failure (with attempted and previous values)
   * - Warning log when blocked due to concurrent operation
   */
  const handleBurnerEmailToggle = async () => {
    if (isTogglingBurnerEmail) {
      logger.warn('Settings', 'Burner email toggle blocked - operation already in progress');
      return;
    }

    // Any explicit interaction with the toggle should clear the highlight state
    if (shouldHighlightBurnerToggle) {
      setShouldHighlightBurnerToggle(false);
      if (burnerToggleRef.current) {
        burnerToggleRef.current.blur();
      }
      onBurnerHighlightComplete?.();
    }

    const previousValue = isBurnerEmailEnabled;
    const newValue = !previousValue;

    // Optimistically update the UI to feel responsive
    setIsBurnerEmailEnabled(newValue);
    setIsTogglingBurnerEmail(true);
    isTogglingRef.current = true;
    logger.info('Settings', 'handleBurnerEmailToggle: Starting toggle', { previousValue, newValue });

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'SET_BURNER_EMAIL_SETTING',
        data: { enabled: newValue }
      });

      if (response.success && typeof response.enabled === 'boolean') {
        // The service worker has confirmed the new state. We can be confident in this value.
        logger.info('Settings', 'Burner email setting updated successfully', { verifiedValue: response.enabled });
        setIsBurnerEmailEnabled(response.enabled);

        // Refresh all settings (email, telemetry, theme) without overwriting the optimistic toggle while it's in-flight
        await loadAllSettings({ skipBurnerUpdate: true });
      } else {
        // If the update fails, roll back to the previous state
        logger.error('Settings', 'Failed to update burner email setting, rolling back UI', new Error(response.error || 'Unknown error'));
        setIsBurnerEmailEnabled(previousValue);
      }
    } catch (error) {
      // If the message fails to send, roll back to the previous state
      logger.error('Settings', 'Error toggling burner email setting, rolling back UI', toError(error));
      setIsBurnerEmailEnabled(previousValue);
    } finally {
      setIsTogglingBurnerEmail(false);
      isTogglingRef.current = false;
    }
  };

  const handleTelemetryToggle = async () => {
    if (isTogglingTelemetry) {
      logger.warn('Settings', 'Telemetry toggle blocked - operation already in progress');
      return;
    }

    setIsTogglingTelemetry(true);
    const newValue = !isTelemetryEnabled;
    logger.debug('Settings', 'Starting telemetry toggle', { currentValue: isTelemetryEnabled, newValue });

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'SET_TELEMETRY_SETTING',
        data: { enabled: newValue }
      });

      if (response.success) {
        setIsTelemetryEnabled(newValue);
        logger.info('Settings', 'Telemetry setting updated', { previousValue: isTelemetryEnabled, newValue });
      } else {
        logger.error('Settings', 'Failed to update telemetry setting', new Error(response.error || 'Unknown error'), { attemptedValue: newValue, previousValue: isTelemetryEnabled });
        await loadAllSettings({ skipBurnerUpdate: isTogglingRef.current });
      }
    } catch (error) {
      logger.error('Settings', 'Failed to toggle telemetry setting', toError(error), { attemptedValue: newValue, previousValue: isTelemetryEnabled });
      await loadAllSettings({ skipBurnerUpdate: isTogglingRef.current });
    } finally {
      setIsTogglingTelemetry(false);
    }
  };

  const handleThemeChange = async (theme: ThemeOption) => {
    if (isApplyingTheme) return;

    setIsApplyingTheme(true);
    setSelectedTheme(theme);

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'SET_THEME',
        data: { theme }
      });

      if (response.success) {
        ThemeManager.updatePreference(theme);
        logger.info('Settings', 'Theme updated successfully', { theme });
      } else {
        logger.error('Settings', 'Failed to set theme', new Error(response.error || 'Unknown error'));
        await loadAllSettings({ skipBurnerUpdate: isTogglingRef.current });
      }
    } catch (error) {
      logger.error('Settings', 'Failed to apply theme', toError(error));
      await loadAllSettings({ skipBurnerUpdate: isTogglingRef.current });
    } finally {
      setIsApplyingTheme(false);
    }
  };

  useEffect(() => {
    if (isOpen && deepLinkSection) {
      setIsNavigatingForward(deepLinkSection !== 'menu');
      setActiveSection(deepLinkSection);
    }
  }, [deepLinkSection, isOpen, highlightBurnerToggle]);

  useEffect(() => {
    if (!isOpen || !reportContext) return;
    if (activeSection !== 'feedback') return;

    const contextText =
      reportContext.type === 'post_consent_violation'
        ? `[Privacy Concern Report]\nDomain: ${reportContext.domain}\nTrackers loaded after denial: ${reportContext.trackerCount ?? 'unknown'}\nTrackers: ${reportContext.blockedTrackers?.join(', ') || 'N/A'}\nURL: ${reportContext.url || 'N/A'}\n\nAdditional details:`
        : `[Banner Experience Report]\nDomain: ${reportContext.domain}\nSignals: ${reportContext.deceptivePatterns?.join(', ') || 'N/A'}\nURL: ${reportContext.url || 'N/A'}\n\nAdditional details:`;

    setFeedbackText(contextText);
  }, [isOpen, reportContext, activeSection]);

  useEffect(() => {
    if (!isOpen || !highlightBurnerToggle) return;
    if (activeSection !== 'burner-services') return;
    if (!burnerToggleRef.current) return;

    setShouldHighlightBurnerToggle(true);
    burnerToggleRef.current.focus({ preventScroll: false });

    const timer = window.setTimeout(() => {
      setShouldHighlightBurnerToggle(false);
      if (burnerToggleRef.current) {
        burnerToggleRef.current.blur();
      }
      onBurnerHighlightComplete?.();
    }, 2500);

    return () => {
      window.clearTimeout(timer);
    };
  }, [highlightBurnerToggle, activeSection, isOpen, onBurnerHighlightComplete]);

  useEffect(() => {
    if (!isOpen) {
      setShouldHighlightBurnerToggle(false);
      if (burnerToggleRef.current) {
        burnerToggleRef.current.blur();
      }
    }
  }, [isOpen]);

  // Ensure toggle loses focus when highlightBurnerToggle becomes false
  useEffect(() => {
    if (!highlightBurnerToggle && shouldHighlightBurnerToggle) {
      setShouldHighlightBurnerToggle(false);
      if (burnerToggleRef.current) {
        burnerToggleRef.current.blur();
      }
    }
  }, [highlightBurnerToggle, shouldHighlightBurnerToggle]);


  const handleClose = () => {
    onReportClear?.();
    onClose();
  };

  if (!isOpen) return null;

  const navigateToSection = (section: SettingsSection) => {
    setIsNavigatingForward(section !== 'menu');
    setActiveSection(section);
  };

  const navigateBack = () => {
    setIsNavigatingForward(false);
    setActiveSection('menu');
  };

  const handleFeedbackSubmit = async () => {
    if (!feedbackText.trim() || isSubmitting) return;

    setIsSubmitting(true);
    try {
      const isHttpProtocol = (protocol: string): boolean => protocol === 'http:' || protocol === 'https:';

      const getSanitizedUrl = (url?: string): string | undefined => {
        if (!url) return undefined;
        try {
          const parsed = new URL(url);
          if (!isHttpProtocol(parsed.protocol)) {
            return undefined;
          }
          return `${parsed.protocol}//${parsed.hostname}${parsed.pathname}`;
        } catch {
          return undefined;
        }
      };

      const getDomain = (url?: string): string => {
        if (!url) return 'unknown';
        try {
          const parsed = new URL(url);
          return isHttpProtocol(parsed.protocol) ? parsed.hostname : 'unknown';
        } catch {
          return 'unknown';
        }
      };

      const response = await chrome.runtime.sendMessage({
        type: 'SUBMIT_FEEDBACK',
        data: {
          feedbackText,
          url: getSanitizedUrl(currentTab?.url),
          domain: getDomain(currentTab?.url),
        },
      });

      if (response.success) {
        logger.info('Popup', 'User feedback submitted', { domain: getDomain(currentTab?.url) });
        setFeedbackText('');
        handleClose();
        onFeedbackSuccess();
      } else {
        logger.error('Popup', 'Failed to submit feedback', new Error(response.error || 'Unknown error'));
      }
    } catch (error) {
      logger.error('Popup', 'Failed to submit feedback', toError(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleExportData = async () => {
    if (isExportingData) {
      return;
    }

    setIsExportingData(true);
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'EXPORT_USER_DATA',
        data: {
          format: exportFormat,
          includeEmail: includeEmailInExport,
        },
      }) as {
        success?: boolean;
        error?: string;
        exportData?: {
          filename: string;
          mimeType: string;
          content: string;
        };
      };

      if (!response?.success || !response.exportData) {
        throw new Error(response?.error || 'Failed to prepare export');
      }

      const blob = new Blob([response.exportData.content], { type: response.exportData.mimeType });
      const objectUrl = URL.createObjectURL(blob);
      const downloadLink = document.createElement('a');
      downloadLink.href = objectUrl;
      downloadLink.download = response.exportData.filename;
      document.body.appendChild(downloadLink);
      downloadLink.click();
      downloadLink.remove();
      URL.revokeObjectURL(objectUrl);

      logger.info('Settings', 'User data export downloaded', {
        format: exportFormat,
        includeEmail: includeEmailInExport,
      });
    } catch (error) {
      logger.error('Settings', 'Failed to export data', toError(error));
    } finally {
      setIsExportingData(false);
    }
  };

  const handleDeleteAllData = async () => {
    if (isDeletingData) {
      return;
    }

    const confirmed = window.confirm(
      'Delete all local Privaseer data from this browser? This action cannot be undone.'
    );
    if (!confirmed) {
      return;
    }

    setIsDeletingData(true);
    try {
      const response = await chrome.runtime.sendMessage({ type: 'DELETE_ALL_DATA' }) as {
        success?: boolean;
        error?: string;
      };
      if (!response?.success) {
        throw new Error(response?.error || 'Failed to delete data');
      }
      await loadAllSettings();
      setRealEmail('');
      setRealEmailInput('');
      logger.info('Settings', 'User requested local data deletion');
    } catch (error) {
      logger.error('Settings', 'Failed to delete local data', toError(error));
    } finally {
      setIsDeletingData(false);
    }
  };

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (standalone) {
      return;
    }
    if (e.target === e.currentTarget) {
      handleClose();
    }
  };

  return (
    <div
      className={
        standalone
          ? 'relative w-full min-h-screen bg-white dark:bg-gray-900 flex items-start justify-center p-4'
          : 'absolute inset-0 bg-black/60 flex items-center justify-center z-50 p-4'
      }
      onClick={handleBackdropClick}
    >
      <div className={`bg-white dark:bg-gray-800 rounded-xl ${standalone ? 'shadow-lg border border-gray-200 dark:border-gray-700 mt-4' : 'shadow-2xl'} w-full max-w-md`} role="dialog" aria-modal="true" aria-label="Extension settings">
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {activeSection !== 'menu' && (
              <button
                onClick={navigateBack}
                className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-all hover:scale-110"
                aria-label="Back to menu"
              >
                <ArrowLeft className="w-5 h-5 text-gray-600 dark:text-gray-400" />
              </button>
            )}
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              {activeSection === 'menu' && 'Settings'}
              {activeSection === 'feedback' && 'Feedback'}
              {activeSection === 'theme' && 'Theme'}
              {activeSection === 'burner-services' && 'Burner Email Services'}
              {activeSection === 'about' && 'About'}
            </h2>
          </div>
          <button
            onClick={handleClose}
            className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-all hover:scale-110"
            aria-label="Close settings"
          >
            <X className="w-5 h-5 text-gray-500 dark:text-gray-400" />
          </button>
        </div>

        <div className="p-6 max-h-96 overflow-y-auto">
          {activeSection === 'menu' && (
            <div className="space-y-3 animate-slide-in-left">
              <button
                onClick={() => navigateToSection('theme')}
                className="w-full flex items-center justify-between p-4 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg hover:border-blue-300 dark:hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-gray-600 transition-all group"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-blue-100 dark:bg-blue-900/40 rounded-lg group-hover:bg-blue-200 dark:group-hover:bg-blue-800/60 transition-colors">
                    <Palette className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div className="text-left">
                    <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Theme</h3>
                    <p className="text-xs text-gray-600 dark:text-gray-400">Customize appearance</p>
                  </div>
                </div>
                <ChevronRight className="w-5 h-5 text-gray-400 dark:text-gray-500 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors" />
              </button>

              <button
                onClick={() => navigateToSection('feedback')}
                className="w-full flex items-center justify-between p-4 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg hover:border-blue-300 dark:hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-gray-600 transition-all group"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-blue-100 dark:bg-blue-900/40 rounded-lg group-hover:bg-blue-200 dark:group-hover:bg-blue-800/60 transition-colors">
                    <MessageSquare className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div className="text-left">
                    <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Feedback</h3>
                    <p className="text-xs text-gray-600 dark:text-gray-400">Share your thoughts</p>
                  </div>
                </div>
                <ChevronRight className="w-5 h-5 text-gray-400 dark:text-gray-500 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors" />
              </button>

              <button
                onClick={() => navigateToSection('burner-services')}
                className="w-full flex items-center justify-between p-4 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg hover:border-blue-300 dark:hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-gray-600 transition-all group"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-blue-100 dark:bg-blue-900/40 rounded-lg group-hover:bg-blue-200 dark:group-hover:bg-blue-800/60 transition-colors">
                    <Mail className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div className="text-left">
                    <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Burner Email Services</h3>
                    <p className="text-xs text-gray-600 dark:text-gray-400">Manage email settings</p>
                  </div>
                </div>
                <ChevronRight className="w-5 h-5 text-gray-400 dark:text-gray-500 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors" />
              </button>

              <button
                onClick={() => navigateToSection('telemetry')}
                className="w-full flex items-center justify-between p-4 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg hover:border-blue-300 dark:hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-gray-600 transition-all group"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-blue-100 dark:bg-blue-900/40 rounded-lg group-hover:bg-blue-200 dark:group-hover:bg-blue-800/60 transition-colors">
                    <BarChart2 className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div className="text-left">
                    <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Telemetry & Improvements</h3>
                    <p className="text-xs text-gray-600 dark:text-gray-400">Opt into anonymous insights</p>
                  </div>
                </div>
                <ChevronRight className="w-5 h-5 text-gray-400 dark:text-gray-500 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors" />
              </button>

              <button
                onClick={() => navigateToSection('about')}
                className="w-full flex items-center justify-between p-4 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg hover:border-blue-300 dark:hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-gray-600 transition-all group"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-blue-100 dark:bg-blue-900/40 rounded-lg group-hover:bg-blue-200 dark:group-hover:bg-blue-800/60 transition-colors">
                    <Info className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div className="text-left">
                    <h3 className="text-sm font-semibold text-gray-900 dark:text-white">About</h3>
                    <p className="text-xs text-gray-600 dark:text-gray-400">App information</p>
                  </div>
                </div>
                <ChevronRight className="w-5 h-5 text-gray-400 dark:text-gray-500 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors" />
              </button>
            </div>
          )}

          {activeSection === 'feedback' && (
            <div className={isNavigatingForward ? 'animate-slide-in-right' : 'animate-slide-in-left'}>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                Help us improve Privaseer. Share your thoughts, report issues, or suggest features.
              </p>
              <textarea
                value={feedbackText}
                onChange={(e) => setFeedbackText(e.target.value)}
                placeholder="Type your feedback here..."
                className="w-full h-32 px-4 py-3 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 rounded-lg focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:border-transparent resize-none text-sm transition-all"
              />
              <button
                onClick={handleFeedbackSubmit}
                disabled={!feedbackText.trim() || isSubmitting}
                className="mt-3 w-full px-4 py-2 text-sm font-medium text-white bg-blue-600 dark:bg-blue-500 hover:bg-blue-700 dark:hover:bg-blue-600 disabled:bg-gray-300 dark:disabled:bg-gray-600 disabled:cursor-not-allowed rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                <Send className="w-4 h-4" />
                {isSubmitting ? 'Submitting...' : 'Submit Feedback'}
              </button>
            </div>
          )}

          {activeSection === 'theme' && (
            <div className={isNavigatingForward ? 'animate-slide-in-right' : 'animate-slide-in-left'}>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                Choose your preferred color theme for the extension.
              </p>
              <div className="space-y-3">
                <button
                  onClick={() => handleThemeChange('light')}
                  disabled={isApplyingTheme}
                  aria-pressed={selectedTheme === 'light'}
                  className={`w-full flex items-center justify-between p-4 border-2 rounded-lg transition-all ${
                    selectedTheme === 'light'
                      ? 'border-blue-500 dark:border-blue-400 bg-blue-50 dark:bg-blue-900/20'
                      : 'border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500 hover:bg-gray-50 dark:hover:bg-gray-700'
                  } ${isApplyingTheme ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-lg ${
                      selectedTheme === 'light' ? 'bg-blue-100 dark:bg-blue-900/40' : 'bg-gray-100 dark:bg-gray-600'
                    }`}>
                      <Sun className={`w-5 h-5 ${
                        selectedTheme === 'light' ? 'text-blue-600 dark:text-blue-400' : 'text-gray-600 dark:text-gray-400'
                      }`} />
                    </div>
                    <div className="text-left">
                      <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Light</h3>
                      <p className="text-xs text-gray-600 dark:text-gray-400">Bright and clear appearance</p>
                    </div>
                  </div>
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                    selectedTheme === 'light'
                      ? 'border-blue-500 dark:border-blue-400'
                      : 'border-gray-300 dark:border-gray-600'
                  }`}>
                    {selectedTheme === 'light' && (
                      <div className="w-3 h-3 rounded-full bg-blue-500 dark:bg-blue-400" />
                    )}
                  </div>
                </button>

                <button
                  onClick={() => handleThemeChange('dark')}
                  disabled={isApplyingTheme}
                  aria-pressed={selectedTheme === 'dark'}
                  className={`w-full flex items-center justify-between p-4 border-2 rounded-lg transition-all ${
                    selectedTheme === 'dark'
                      ? 'border-blue-500 dark:border-blue-400 bg-blue-50 dark:bg-blue-900/20'
                      : 'border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500 hover:bg-gray-50 dark:hover:bg-gray-700'
                  } ${isApplyingTheme ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-lg ${
                      selectedTheme === 'dark' ? 'bg-blue-100 dark:bg-blue-900/40' : 'bg-gray-100 dark:bg-gray-600'
                    }`}>
                      <Moon className={`w-5 h-5 ${
                        selectedTheme === 'dark' ? 'text-blue-600 dark:text-blue-400' : 'text-gray-600 dark:text-gray-400'
                      }`} />
                    </div>
                    <div className="text-left">
                      <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Dark</h3>
                      <p className="text-xs text-gray-600 dark:text-gray-400">Easy on the eyes at night</p>
                    </div>
                  </div>
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                    selectedTheme === 'dark'
                      ? 'border-blue-500 dark:border-blue-400'
                      : 'border-gray-300 dark:border-gray-600'
                  }`}>
                    {selectedTheme === 'dark' && (
                      <div className="w-3 h-3 rounded-full bg-blue-500 dark:bg-blue-400" />
                    )}
                  </div>
                </button>

                <button
                  onClick={() => handleThemeChange('system')}
                  disabled={isApplyingTheme}
                  aria-pressed={selectedTheme === 'system'}
                  className={`w-full flex items-center justify-between p-4 border-2 rounded-lg transition-all ${
                    selectedTheme === 'system'
                      ? 'border-blue-500 dark:border-blue-400 bg-blue-50 dark:bg-blue-900/20'
                      : 'border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500 hover:bg-gray-50 dark:hover:bg-gray-700'
                  } ${isApplyingTheme ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-lg ${
                      selectedTheme === 'system' ? 'bg-blue-100 dark:bg-blue-900/40' : 'bg-gray-100 dark:bg-gray-600'
                    }`}>
                      <Monitor className={`w-5 h-5 ${
                        selectedTheme === 'system' ? 'text-blue-600 dark:text-blue-400' : 'text-gray-600 dark:text-gray-400'
                      }`} />
                    </div>
                    <div className="text-left">
                      <h3 className="text-sm font-semibold text-gray-900 dark:text-white">System</h3>
                      <p className="text-xs text-gray-600 dark:text-gray-400">Match your system settings</p>
                    </div>
                  </div>
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                    selectedTheme === 'system'
                      ? 'border-blue-500 dark:border-blue-400'
                      : 'border-gray-300 dark:border-gray-600'
                  }`}>
                    {selectedTheme === 'system' && (
                      <div className="w-3 h-3 rounded-full bg-blue-500 dark:bg-blue-400" />
                    )}
                  </div>
                </button>
              </div>
            </div>
          )}

          {activeSection === 'burner-services' && (
            <div className={isNavigatingForward ? 'animate-slide-in-right' : 'animate-slide-in-left'}>
              <div className="p-4 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-blue-100 dark:bg-blue-900/40 rounded-lg transition-colors">
                      <Mail className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                    </div>
                    <div className="text-left">
                      <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Burner Email Protection</h3>
                      <p className="text-xs text-gray-600 dark:text-gray-400">
                        Control disposable email generation for untrusted sites
                      </p>
                    </div>
                  </div>
                  <button
                    ref={burnerToggleRef}
                    onClick={handleBurnerEmailToggle}
                    disabled={isTogglingBurnerEmail}
                    role="switch"
                    aria-checked={isBurnerEmailEnabled}
                    className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-800 ${
                      isBurnerEmailEnabled ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'
                    } ${isTogglingBurnerEmail ? 'opacity-50 cursor-not-allowed' : ''} ${
                      shouldHighlightBurnerToggle ? 'ring-4 ring-blue-300 dark:ring-blue-700 ring-offset-2 dark:ring-offset-gray-800' : ''
                    }`}
                    aria-label="Toggle burner email protection"
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        isBurnerEmailEnabled ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>
                <div
                  className="sr-only"
                  aria-live="polite"
                  aria-atomic="true"
                >
                  Burner email protection is {isBurnerEmailEnabled ? 'enabled' : 'disabled'}
                </div>
                <p className="mt-4 text-xs text-gray-600 dark:text-gray-400">
                  Burner email capabilities power the in-page autofill experience and the burner emails tab. Disabling
                  this feature blocks future email generation but keeps existing addresses accessible.
                </p>

                <div className="mt-6 pt-6 border-t border-gray-200 dark:border-gray-600">
                  <label htmlFor="real-email-input" className={`block text-sm font-medium mb-2 ${
                    !isBurnerEmailEnabled
                      ? 'text-gray-400 dark:text-gray-500'
                      : 'text-gray-900 dark:text-white'
                  }`}>
                    Forwarding Email Address
                  </label>
                  <p className={`text-xs mb-3 ${
                    !isBurnerEmailEnabled
                      ? 'text-gray-400 dark:text-gray-500'
                      : 'text-gray-600 dark:text-gray-400'
                  }`}>
                    Emails sent to your burner addresses will be forwarded to this address. Your email is stored locally and never shared.
                  </p>
                  
                  {!isBurnerEmailEnabled && (
                    <div className="mb-3 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
                      <p className="text-xs text-amber-800 dark:text-amber-300">
                        Enable Burner Email Protection above to configure your forwarding email address.
                      </p>
                    </div>
                  )}
                  
                  {realEmail && (
                    <div className="mb-3 p-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                      <p className="text-xs text-gray-600 dark:text-gray-400">
                        Current: <span className="font-mono text-gray-900 dark:text-white">{maskEmail(realEmail)}</span>
                      </p>
                    </div>
                  )}

                  <div className="space-y-2">
                    <input
                      id="real-email-input"
                      type="email"
                      value={realEmailInput}
                      onChange={(e) => {
                        setRealEmailInput(e.target.value);
                        setRealEmailError(null);
                      }}
                      placeholder="your.email@example.com"
                      className={`w-full px-3 py-2 text-sm border rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:border-transparent transition-all ${
                        !isBurnerEmailEnabled
                          ? 'bg-gray-100 dark:bg-gray-700 text-gray-400 dark:text-gray-500 border-gray-200 dark:border-gray-600 cursor-not-allowed'
                          : realEmailError
                          ? 'border-red-300 dark:border-red-600'
                          : 'border-gray-300 dark:border-gray-600'
                      }`}
                      disabled={isSavingRealEmail || !isBurnerEmailEnabled}
                      aria-disabled={!isBurnerEmailEnabled}
                    />
                    {realEmailError && (
                      <p className="text-xs text-red-600 dark:text-red-400">{realEmailError}</p>
                    )}
                    <button
                      onClick={handleSaveRealEmail}
                      disabled={isSavingRealEmail || !isBurnerEmailEnabled || realEmailInput.trim() === realEmail}
                      className="w-full px-4 py-2 text-sm font-medium text-white bg-blue-600 dark:bg-blue-500 hover:bg-blue-700 dark:hover:bg-blue-600 disabled:bg-gray-300 dark:disabled:bg-gray-600 disabled:cursor-not-allowed rounded-lg transition-colors"
                      aria-disabled={!isBurnerEmailEnabled}
                    >
                      {isSavingRealEmail ? 'Saving...' : realEmail ? 'Update Email' : 'Save Email'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeSection === 'about' && (
            <div className={isNavigatingForward ? 'animate-slide-in-right' : 'animate-slide-in-left'}>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
                Privaseer helps you protect your privacy online by blocking trackers and managing cookie consent.
              </p>
              <div className="space-y-4">
                <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-xs font-medium text-gray-600 dark:text-gray-400">Version</span>
                    <span className="text-sm font-semibold text-gray-900 dark:text-white">1.0.0</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-medium text-gray-600 dark:text-gray-400">Extension Name</span>
                    <span className="text-sm font-semibold text-gray-900 dark:text-white">Privaseer</span>
                  </div>
                </div>

                <div className="border-t border-gray-200 dark:border-gray-600 pt-4">
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">Features</h3>
                  <ul className="space-y-2 text-xs text-gray-600 dark:text-gray-400">
                    <li className="flex items-start gap-2">
                      <span className="text-blue-600 dark:text-blue-400 mt-0.5">•</span>
                      <span>Automatic tracker blocking and privacy protection</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-blue-600 dark:text-blue-400 mt-0.5">•</span>
                      <span>Smart cookie consent management</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-blue-600 dark:text-blue-400 mt-0.5">•</span>
                      <span>Burner email services for enhanced privacy</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-blue-600 dark:text-blue-400 mt-0.5">•</span>
                      <span>Real-time privacy score tracking</span>
                    </li>
                  </ul>
                </div>

                <div className="border-t border-gray-200 dark:border-gray-600 pt-4">
                  <label className="text-xs font-medium text-gray-700 dark:text-gray-300">
                    Export format
                  </label>
                  <select
                    value={exportFormat}
                    onChange={(event) => setExportFormat(event.target.value as 'json' | 'csv')}
                    className="mt-2 w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                    aria-label="Select export format"
                  >
                    <option value="json">JSON (full structured export)</option>
                    <option value="csv">CSV (metrics summary)</option>
                  </select>

                  <label className="mt-3 flex items-center gap-2 text-xs text-gray-700 dark:text-gray-300">
                    <input
                      type="checkbox"
                      checked={includeEmailInExport}
                      onChange={(event) => setIncludeEmailInExport(event.target.checked)}
                      className="rounded border-gray-300 dark:border-gray-600"
                    />
                    Include forwarding email address in export
                  </label>

                  <button
                    onClick={handleExportData}
                    disabled={isExportingData}
                    className="w-full px-4 py-2.5 text-sm font-medium text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 hover:bg-blue-100 dark:hover:bg-blue-900/30 disabled:opacity-60 disabled:cursor-not-allowed rounded-lg transition-colors flex items-center justify-center gap-2"
                    aria-label="Export my data file"
                  >
                    <Download className="w-4 h-4" />
                    {isExportingData ? 'Exporting...' : `Export My Data (${exportFormat.toUpperCase()})`}
                  </button>
                  <p className="mt-2 text-xs text-gray-500 dark:text-gray-400 text-center">
                    GDPR Article 20 portability export. URLs are sanitized; when enabled, forwarding email is included in JSON and as a CSV summary row.
                  </p>
                  <button
                    onClick={handleDeleteAllData}
                    disabled={isDeletingData}
                    className="mt-3 w-full px-4 py-2.5 text-sm font-medium text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 hover:bg-red-100 dark:hover:bg-red-900/30 disabled:opacity-60 disabled:cursor-not-allowed rounded-lg transition-colors flex items-center justify-center gap-2"
                    aria-label="Delete all local extension data"
                  >
                    <Trash2 className="w-4 h-4" />
                    {isDeletingData ? 'Deleting...' : 'Delete All My Data'}
                  </button>
                </div>

                <div className="border-t border-gray-200 dark:border-gray-600 pt-4">
                  <p className="text-xs text-gray-500 dark:text-gray-400 text-center">
                    Built with privacy in mind
                  </p>
                </div>
              </div>
            </div>
          )}

          {activeSection === 'telemetry' && (
            <div className={isNavigatingForward ? 'animate-slide-in-right' : 'animate-slide-in-left'}>
              <div className="p-4 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-blue-100 dark:bg-blue-900/40 rounded-lg transition-colors">
                      <BarChart2 className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                    </div>
                    <div className="text-left">
                      <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Telemetry & Improvements</h3>
                      <p className="text-xs text-gray-600 dark:text-gray-400">
                        Share anonymous usage patterns to help Privaseer improve. No personal data is collected.
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={handleTelemetryToggle}
                    disabled={isTogglingTelemetry}
                    role="switch"
                    aria-checked={isTelemetryEnabled}
                    className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800 ${
                      isTelemetryEnabled ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'
                    } ${isTogglingTelemetry ? 'opacity-50 cursor-not-allowed' : ''}`}
                    aria-label="Toggle telemetry collection"
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        isTelemetryEnabled ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>
                <div
                  className="sr-only"
                  aria-live="polite"
                  aria-atomic="true"
                >
                  Telemetry collection is {isTelemetryEnabled ? 'enabled' : 'disabled'}
                </div>
                <p className="mt-4 text-xs text-gray-600 dark:text-gray-400">
                  Telemetry helps us understand which features are useful so we can prioritize improvements. It never
                  includes page contents, form data, or personally identifiable information.
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="px-6 py-4 bg-gray-50 dark:bg-gray-700 border-t border-gray-200 dark:border-gray-600 rounded-b-xl">
          <button
            onClick={activeSection === 'menu' ? handleClose : navigateBack}
            className="w-full px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors"
          >
            {activeSection === 'menu' ? 'Close' : 'Back'}
          </button>
        </div>
      </div>
    </div>
  );
}
