export const FREE_MAX_CIRCLES = 4;
export const FREE_MAX_LINES = 2;
export const FREE_MAX_ARROWS = 2;

const STORAGE_LICENSE_KEY = 'tactic_board_pro_license_v2';
const LEGACY_STORAGE_PRO_KEY = 'tactic_board_pro_unlocked_v1';

export interface StoredProLicense {
  unlocked: boolean;
  mode: 'live' | 'preview';
  licenseKey?: string;
  instanceId?: string;
  activatedAt: string;
}

export function getCheckoutUrl(): string {
  return (import.meta.env.VITE_CHECKOUT_URL || '').trim();
}

export function isLiveCheckoutConfigured(): boolean {
  return getCheckoutUrl().length > 0;
}

export function loadStoredLicense(): StoredProLicense | null {
  try {
    const raw = localStorage.getItem(STORAGE_LICENSE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<StoredProLicense>;
      if (parsed && parsed.unlocked) {
        return {
          unlocked: true,
          mode: parsed.mode === 'live' ? 'live' : 'preview',
          licenseKey: parsed.licenseKey,
          instanceId: parsed.instanceId,
          activatedAt: parsed.activatedAt || new Date().toISOString(),
        };
      }
    }
    // Migrate legacy boolean key only in unconfigured preview mode
    if (!isLiveCheckoutConfigured() && localStorage.getItem(LEGACY_STORAGE_PRO_KEY) === 'true') {
      return {
        unlocked: true,
        mode: 'preview',
        activatedAt: new Date().toISOString(),
      };
    }
  } catch {
    // ignore storage read errors
  }
  return null;
}

export function saveStoredLicense(license: StoredProLicense | null): void {
  try {
    if (!license) {
      localStorage.removeItem(STORAGE_LICENSE_KEY);
      localStorage.removeItem(LEGACY_STORAGE_PRO_KEY);
      return;
    }
    localStorage.setItem(STORAGE_LICENSE_KEY, JSON.stringify(license));
  } catch {
    // ignore storage write errors
  }
}

export interface ActivationResult {
  ok: boolean;
  license?: StoredProLicense;
  error?: string;
}

export async function activateLicenseKey(rawKey: string): Promise<ActivationResult> {
  const key = rawKey.trim();
  if (!key) {
    return {ok: false, error: 'Please enter a license key.'};
  }

  // Allow test unlock only when no live checkout URL is configured
  if (!isLiveCheckoutConfigured() && key.toUpperCase() === 'PREVIEW-PRO') {
    const previewLicense: StoredProLicense = {
      unlocked: true,
      mode: 'preview',
      licenseKey: 'PREVIEW-PRO',
      activatedAt: new Date().toISOString(),
    };
    saveStoredLicense(previewLicense);
    return {ok: true, license: previewLicense};
  }

  // Call Lemon Squeezy public License Activation API
  try {
    const res = await fetch('https://api.lemonsqueezy.com/v1/licenses/activate', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        license_key: key,
        instance_name: 'TacticBoard PWA',
      }),
    });

    const data = (await res.json()) as {
      activated?: boolean;
      error?: string;
      license_key?: {status?: string};
      instance?: {id?: string};
      meta?: {product_id?: number};
    };

    if (!res.ok || !data.activated) {
      return {
        ok: false,
        error: data.error || 'License key could not be activated. Check the key and try again.',
      };
    }

    const expectedProductId = (import.meta.env.VITE_LEMON_SQUEEZY_PRODUCT_ID || '').trim();
    if (
      expectedProductId &&
      data.meta?.product_id !== undefined &&
      String(data.meta.product_id) !== expectedProductId
    ) {
      return {
        ok: false,
        error: 'This license key belongs to a different product.',
      };
    }

    const liveLicense: StoredProLicense = {
      unlocked: true,
      mode: 'live',
      licenseKey: key,
      instanceId: data.instance?.id,
      activatedAt: new Date().toISOString(),
    };
    saveStoredLicense(liveLicense);
    return {ok: true, license: liveLicense};
  } catch {
    return {
      ok: false,
      error: 'Unable to reach license server. Connect to the internet to activate your key.',
    };
  }
}

export async function revalidateStoredLicenseInBackground(
  license: StoredProLicense,
): Promise<boolean> {
  if (license.mode !== 'live' || !license.licenseKey || !navigator.onLine) {
    return true;
  }

  try {
    const params = new URLSearchParams({license_key: license.licenseKey});
    if (license.instanceId) {
      params.set('instance_id', license.instanceId);
    }
    const res = await fetch('https://api.lemonsqueezy.com/v1/licenses/validate', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params,
    });
    if (!res.ok) return true; // avoid revoking on transient network/5xx errors

    const data = (await res.json()) as {
      valid?: boolean;
      license_key?: {status?: string};
    };
    if (data.valid === false || data.license_key?.status === 'disabled') {
      saveStoredLicense(null);
      return false;
    }
    return true;
  } catch {
    return true;
  }
}
