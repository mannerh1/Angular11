import React, {useEffect, useState} from 'react';
import {CheckCircle2, Mail, ShieldCheck, X} from 'lucide-react';
import {
  FREE_MAX_ARROWS,
  FREE_MAX_CIRCLES,
  FREE_MAX_LINES,
} from '../utils/licensing';

export type InfoTab = 'about' | 'pricing' | 'terms';

interface InfoTermsModalProps {
  isOpen: boolean;
  initialTab?: InfoTab;
  onClose: () => void;
  onOpenUpgrade: () => void;
}

const DEFAULT_SUPPORT_EMAIL = 'ritchie.hwang@yahoo.com';

export function getSupportEmail(): string {
  const configured = (import.meta.env.VITE_SUPPORT_EMAIL || '').trim();
  return configured || DEFAULT_SUPPORT_EMAIL;
}

export const InfoTermsModal: React.FC<InfoTermsModalProps> = ({
  isOpen,
  initialTab = 'about',
  onClose,
  onOpenUpgrade,
}) => {
  const [activeTab, setActiveTab] = useState<InfoTab>(initialTab);
  const supportEmail = getSupportEmail();

  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab);
    }
  }, [isOpen, initialTab]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 p-4 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="infoTermsTitle"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[90dvh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white text-slate-900 shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-4">
          <div>
            <h2 id="infoTermsTitle" className="text-lg font-bold tracking-tight text-slate-900">
              Drag &amp; Drop Tactic Board
            </h2>
            <p className="mt-0.5 text-xs font-medium text-slate-500">
              Offline-first tactical whiteboard for coaches, players &amp; analysts
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close information dialog"
            className="inline-flex min-h-[38px] min-w-[38px] items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex gap-1 border-b border-slate-200 bg-slate-50 px-6 py-2">
          {(
            [
              {id: 'about', label: 'About'},
              {id: 'pricing', label: 'Pricing'},
              {id: 'terms', label: 'Refunds, Terms & Privacy'},
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`min-h-[34px] rounded-md px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                activeTab === tab.id
                  ? 'bg-white text-[#1565c0] shadow-xs ring-1 ring-slate-200'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="overflow-y-auto px-6 py-5 text-sm leading-relaxed text-slate-700">
          {activeTab === 'about' && (
            <div className="space-y-4">
              <p>
                <strong>Drag &amp; Drop Tactic Board</strong> is a fast, zero-clutter tactical
                diagramming web app built for sports coaches, captains, and esports or futsal
                strategists.
              </p>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Core Features
                </h3>
                <ul className="mt-2.5 space-y-2 text-sm text-slate-700">
                  <li className="flex items-start gap-2">
                    <CheckCircle2
                      className="mt-0.5 h-4 w-4 shrink-0 text-[#1565c0]"
                      aria-hidden="true"
                    />
                    <span>
                      Drag yellow and red player tokens (Small, Medium, Large) anywhere on the
                      board.
                    </span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2
                      className="mt-0.5 h-4 w-4 shrink-0 text-[#1565c0]"
                      aria-hidden="true"
                    />
                    <span>
                      Place horizontal and vertical zone divider lines (Thin, Medium, Thick).
                    </span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2
                      className="mt-0.5 h-4 w-4 shrink-0 text-[#1565c0]"
                      aria-hidden="true"
                    />
                    <span>
                      Draw and adjust tactical movement arrows directly from any token or spot.
                    </span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2
                      className="mt-0.5 h-4 w-4 shrink-0 text-[#1565c0]"
                      aria-hidden="true"
                    />
                    <span>
                      Export crisp PNG diagrams and install as an offline-ready PWA on iOS,
                      Android, and Desktop.
                    </span>
                  </li>
                </ul>
              </div>

              <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 px-4 py-3 text-xs text-slate-600">
                <div className="flex items-center gap-2">
                  <Mail className="h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
                  <span>
                    Support:{' '}
                    <a
                      href={`mailto:${supportEmail}`}
                      className="font-semibold text-[#1565c0] hover:underline"
                    >
                      {supportEmail}
                    </a>
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveTab('pricing')}
                  className="font-semibold text-[#1565c0] hover:underline whitespace-nowrap shrink-0"
                >
                  View Pricing →
                </button>
              </div>
            </div>
          )}

          {activeTab === 'pricing' && (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-baseline justify-between">
                    <h3 className="text-sm font-bold text-slate-900">Free Sandbox</h3>
                    <span className="font-mono text-lg font-bold tabular-nums text-slate-700">
                      $0
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">Try instantly, no sign-up</p>
                  <ul className="mt-3 space-y-1.5 text-xs text-slate-700">
                    <li>• Up to {FREE_MAX_CIRCLES} player circles</li>
                    <li>• Up to {FREE_MAX_LINES} divider lines</li>
                    <li>• Up to {FREE_MAX_ARROWS} tactical arrows</li>
                    <li>• Clear board &amp; 6s Undo</li>
                    <li>• Local device auto-save</li>
                  </ul>
                </div>

                <div className="rounded-xl border-2 border-[#1565c0] bg-blue-50/40 p-4">
                  <div className="flex items-baseline justify-between">
                    <h3 className="text-sm font-bold text-slate-900">Pro License</h3>
                    <span className="font-mono text-lg font-bold tabular-nums text-[#1565c0]">
                      $1.99
                    </span>
                  </div>
                  <p className="mt-1 text-xs font-medium text-[#1565c0]">
                    One-time purchase · No subscription
                  </p>
                  <ul className="mt-3 space-y-1.5 text-xs text-slate-800">
                    <li>• Unlimited circles, lines &amp; arrows</li>
                    <li>• High-resolution PNG export</li>
                    <li>• Offline PWA home-screen install</li>
                    <li>• Lifetime updates on your device</li>
                  </ul>
                </div>
              </div>

              <div className="flex items-center justify-between gap-3 pt-1">
                <p className="text-xs text-slate-500">
                  Digital license key delivered immediately after checkout.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenUpgrade();
                  }}
                  className="inline-flex min-h-[38px] items-center rounded-lg bg-[#1565c0] px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#0d47a1] whitespace-nowrap shrink-0"
                >
                  Unlock Pro ($1.99)
                </button>
              </div>
            </div>
          )}

          {activeTab === 'terms' && (
            <div className="space-y-4 text-xs leading-relaxed text-slate-700">
              <section className="space-y-1">
                <h3 className="flex items-center gap-1.5 text-sm font-bold text-slate-900">
                  <ShieldCheck className="h-4 w-4 text-[#1565c0]" aria-hidden="true" />
                  <span>14-Day Refund Policy</span>
                </h3>
                <p>
                  Pro is a $1.99 one-time digital license. If the app does not work as expected on
                  your device or you are unsatisfied for any reason within 14 days of purchase,
                  email{' '}
                  <a
                    href={`mailto:${supportEmail}?subject=Tactic%20Board%20Refund%20Request`}
                    className="font-semibold text-[#1565c0] hover:underline"
                  >
                    {supportEmail}
                  </a>{' '}
                  with your order receipt or license key for a full refund.
                </p>
              </section>

              <section className="space-y-1">
                <h3 className="text-sm font-bold text-slate-900">Privacy &amp; Data Storage</h3>
                <p>
                  Your tactical diagrams are stored locally in your browser&apos;s on-device
                  storage (<code>localStorage</code>) and never uploaded to a shared server. We do
                  not sell personal data or display third-party ads. When you activate a Pro
                  license key, only the key and device instance label are verified against the
                  licensing provider.
                </p>
              </section>

              <section className="space-y-1">
                <h3 className="text-sm font-bold text-slate-900">Terms of Use</h3>
                <p>
                  A single $1.99 Pro license grants non-exclusive personal or coaching use to unlock
                  unlimited tactical board elements, PNG export, and offline PWA installation. The
                  software is provided &ldquo;as is&rdquo; without warranty beyond applicable
                  consumer protection laws.
                </p>
              </section>

              <section className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="font-semibold text-slate-900">Contact &amp; Merchant Support</p>
                <p className="mt-0.5 text-slate-600">
                  Questions, license recovery, or refund requests:{' '}
                  <a
                    href={`mailto:${supportEmail}`}
                    className="font-semibold text-[#1565c0] hover:underline"
                  >
                    {supportEmail}
                  </a>
                </p>
              </section>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
