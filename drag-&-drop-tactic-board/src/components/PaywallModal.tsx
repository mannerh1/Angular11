import React, {useEffect, useState} from 'react';
import {ExternalLink, Lock, RotateCcw, X} from 'lucide-react';
import {
  activateLicenseKey,
  getCheckoutUrl,
  isLiveCheckoutConfigured,
  StoredProLicense,
} from '../utils/licensing';

interface PaywallModalProps {
  isOpen: boolean;
  isProUnlocked: boolean;
  proMode: 'live' | 'preview' | null;
  triggerReason: string | null;
  onClose: () => void;
  onLicenseActivated: (license: StoredProLicense) => void;
  onPreviewUnlock: () => void;
  onResetToFree: () => void;
  onOpenTerms?: () => void;
}

export const PaywallModal: React.FC<PaywallModalProps> = ({
  isOpen,
  isProUnlocked,
  proMode,
  triggerReason,
  onClose,
  onLicenseActivated,
  onPreviewUnlock,
  onResetToFree,
  onOpenTerms,
}) => {
  const [licenseInput, setLicenseInput] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [isError, setIsError] = useState(false);
  const [isActivating, setIsActivating] = useState(false);

  const checkoutUrl = getCheckoutUrl();
  const isLive = isLiveCheckoutConfigured();

  useEffect(() => {
    if (!isOpen) return;
    setIsError(false);
    setStatusMessage(
      isProUnlocked
        ? proMode === 'live'
          ? 'Pro license is active on this device.'
          : 'Pro preview mode is active on this device.'
        : '',
    );

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isProUnlocked, proMode, onClose]);

  if (!isOpen) return null;

  const handleVerifyLicense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isActivating) return;

    setIsActivating(true);
    setIsError(false);
    setStatusMessage('');

    const result = await activateLicenseKey(licenseInput);
    setIsActivating(false);

    if (result.ok && result.license) {
      setLicenseInput('');
      setIsError(false);
      setStatusMessage('License activated. Unlimited board, PNG export & PWA install unlocked.');
      onLicenseActivated(result.license);
    } else {
      setIsError(true);
      setStatusMessage(result.error || 'Could not activate license key.');
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 p-4 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="paywallTitle"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-slate-900 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="paywallTitle" className="text-xl font-bold tracking-tight text-slate-900">
              Drag &amp; Drop Tactic Board Pro
            </h2>
            <p className="mt-1 flex items-baseline gap-2">
              <span className="font-mono text-2xl font-bold tabular-nums text-[#1565c0]">
                $1.99
              </span>
              <span className="text-sm font-medium text-slate-500">
                One-time purchase · No subscription
              </span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        {triggerReason && !isProUnlocked && (
          <div className="mt-3 flex items-start gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3.5 py-2.5 text-xs font-medium leading-relaxed text-blue-950">
            <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#1565c0]" aria-hidden="true" />
            <span>{triggerReason}</span>
          </div>
        )}

        <ul className="mt-4 space-y-2 pl-5 text-sm leading-relaxed text-slate-700 list-disc">
          <li>Unlimited circles, divider lines &amp; tactical arrows (free sandbox: 4 + 2 + 2)</li>
          <li>High-resolution PNG export for WhatsApp, Discord &amp; slides</li>
          <li>Installable offline PWA on iOS, Android &amp; Desktop</li>
        </ul>

        <div className="mt-5 space-y-3">
          {isLive ? (
            <a
              href={checkoutUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => {
                setIsError(false);
                setStatusMessage(
                  'Checkout opened in a new tab. Paste your license key below after completing payment.',
                );
              }}
              className="inline-flex w-full min-h-[44px] items-center justify-center gap-2 rounded-lg bg-[#1565c0] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#0d47a1] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1565c0]"
            >
              <span>Pay $1.99 &amp; Get License Key</span>
              <ExternalLink className="h-4 w-4 shrink-0" aria-hidden="true" />
            </a>
          ) : (
            <button
              type="button"
              onClick={() => {
                onPreviewUnlock();
                setIsError(false);
                setStatusMessage(
                  'Preview Pro unlocked on this device. Set VITE_CHECKOUT_URL for live Lemon Squeezy / Stripe checkout.',
                );
              }}
              className="w-full min-h-[44px] rounded-lg bg-[#1565c0] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#0d47a1] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1565c0]"
            >
              {isProUnlocked ? 'Pro Active (Preview Mode)' : 'Preview Unlock ($1.99 Pro)'}
            </button>
          )}

          <form onSubmit={handleVerifyLicense} className="flex gap-2">
            <label htmlFor="licenseInput" className="sr-only">
              License key
            </label>
            <input
              id="licenseInput"
              type="text"
              value={licenseInput}
              onChange={(e) => setLicenseInput(e.target.value)}
              placeholder={
                isLive ? 'Paste your Lemon Squeezy license key' : 'Enter key or PREVIEW-PRO'
              }
              className="min-h-[42px] flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[#1565c0] focus:outline-none"
            />
            <button
              type="submit"
              disabled={isActivating}
              className="min-h-[42px] rounded-lg border border-slate-300 bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-800 transition-colors hover:bg-slate-200 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              {isActivating ? 'Checking...' : 'Activate'}
            </button>
          </form>

          {statusMessage && (
            <p
              className={`text-sm font-medium ${isError ? 'text-red-700' : 'text-emerald-700'}`}
              aria-live="polite"
            >
              {statusMessage}
            </p>
          )}

          {isProUnlocked && proMode === 'preview' && !isLive && (
            <button
              type="button"
              onClick={() => {
                onResetToFree();
                setIsError(false);
                setStatusMessage(
                  'Switched back to Free Sandbox (4 circles + 2 lines + 2 arrows).',
                );
              }}
              className="inline-flex w-full min-h-[38px] items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-100"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Test Free Sandbox Mode Again</span>
            </button>
          )}
        </div>

        <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-xs leading-relaxed text-slate-600">
          <p className="font-semibold text-slate-800">How to Install After Unlocking:</p>
          <p className="mt-1">
            <strong>iOS (Safari):</strong> Tap <em>Share</em> then <em>Add to Home Screen</em>.
          </p>
          <p className="mt-0.5">
            <strong>Android / Desktop (Chrome or Edge):</strong> Click <em>Install App</em> in
            the toolbar or browser address bar.
          </p>
          {onOpenTerms && (
            <div className="mt-2.5 border-t border-slate-200 pt-2">
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenTerms();
                }}
                className="font-semibold text-[#1565c0] hover:underline"
              >
                14-Day Refund Policy, Terms &amp; Support →
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
