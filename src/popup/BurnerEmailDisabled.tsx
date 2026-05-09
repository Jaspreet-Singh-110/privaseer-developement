interface BurnerEmailDisabledProps {
  onOpenSettings?: () => void;
}

export function BurnerEmailDisabled({ onOpenSettings }: BurnerEmailDisabledProps) {
  return (
    <div className="p-4 text-center rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 space-y-3">
      <p className="text-sm font-medium text-gray-600 dark:text-gray-300">
        Feature is off. Enable it in Settings to start generating burner emails.
      </p>
      <button
        onClick={onOpenSettings}
        disabled={!onOpenSettings}
        className="px-4 py-2 rounded-lg text-sm font-medium bg-blue-600 dark:bg-blue-500 text-white hover:bg-blue-700 dark:hover:bg-blue-600 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
      >
        Go to Settings
      </button>
    </div>
  );
}

