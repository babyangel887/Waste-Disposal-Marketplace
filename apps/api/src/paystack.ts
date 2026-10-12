import crypto from 'node:crypto';

// Real Paystack integration (live when PAYSTACK_MODE is not 'mock').
// The secret key is read from the environment only and is never logged.
export function paystackMode(): string {
  return process.env.PAYSTACK_MODE ?? 'mock';
}

export function isPaystackLive(): boolean {
  return paystackMode() !== 'mock';
}

function paystackBaseUrl(): string {
  return process.env.PAYSTACK_BASE_URL ?? 'https://api.paystack.co';
}

function secretKey(): string {
  return process.env.PAYSTACK_SECRET_KEY ?? '';
}

// Users have no email column — build a valid-format placeholder address from
// the phone digits so Paystack initialize always has an email. The domain must
// be a normal public domain: reserved TLDs like .local are rejected by
// Paystack with a 400. Override with PAYSTACK_EMAIL_DOMAIN when you own one.
export function placeholderEmail(
  phone: string,
  fallbackId: string,
  domain: string = process.env.PAYSTACK_EMAIL_DOMAIN ?? 'wastemarketplace.com'
): string {
  const digits = (phone ?? '').replace(/[^0-9]/g, '').slice(0, 40);
  const local = digits || fallbackId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 40) || 'customer';
  return `${local}@${domain}`;
}

export interface PaystackInitResult {
  authorization_url: string;
  reference: string;
}

// Calls Paystack transaction/initialize. In mock mode returns a stub so local
// dev/tests never touch the network. Throws on misconfiguration or provider
// errors (callers map this to a 502 without leaking details).
export async function initializeTransaction(
  email: string,
  amountKobo: number,
  reference: string
): Promise<PaystackInitResult> {
  if (!isPaystackLive()) {
    return { authorization_url: `mock://paystack/${reference}`, reference };
  }
  const secret = secretKey();
  if (!secret) throw new Error('PAYSTACK_MODE live requires PAYSTACK_SECRET_KEY');
  let res: Response;
  try {
    res = await fetch(`${paystackBaseUrl()}/transaction/initialize`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, amount: amountKobo, reference, metadata: { reference } }),
    });
  } catch {
    throw new Error('Payment provider unreachable');
  }
  // Log only the HTTP status — never the secret, email, or body.
  console.log(`[paystack] initialize status=${res.status}`);
  if (!res.ok) {
    // Surface Paystack's own error message (status + message only — never the
    // key, headers, or request body) so live failures are diagnosable.
    const errBody: any = await res.json().catch(() => null);
    const errMsg = errBody?.message ? String(errBody.message).slice(0, 200) : 'no message';
    console.log(`[paystack] initialize failed status=${res.status} message=${errMsg}`);
    throw new Error(`Payment provider error (status ${res.status})`);
  }
  const data: any = await res.json().catch(() => null);
  if (!data?.status || !data?.data?.authorization_url || !data?.data?.reference) {
    throw new Error('Payment provider bad response');
  }
  return { authorization_url: data.data.authorization_url, reference: data.data.reference };
}

export interface PaystackRefundResult {
  ok: boolean;
  mock: boolean;
  paystack_ref?: string;
}

// Refunds a captured transaction by its stored gateway reference. Amount is
// optional: omit it for a full refund, pass kobo for a partial one.
// Mock mode returns a success stub and never touches the network, so existing
// mock behavior is unchanged. Throws on provider failure — callers must keep
// their records unchanged in that case. Logs status + message only.
export async function createRefund(reference: string, amountKobo?: number): Promise<PaystackRefundResult> {
  if (!isPaystackLive()) {
    return { ok: true, mock: true };
  }
  const secret = secretKey();
  if (!secret) throw new Error('PAYSTACK_MODE live requires PAYSTACK_SECRET_KEY');
  const body: any = { transaction: reference };
  if (amountKobo !== undefined) body.amount = amountKobo;
  let res: Response;
  try {
    res = await fetch(`${paystackBaseUrl()}/refund`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('Payment provider unreachable');
  }
  console.log(`[paystack] refund status=${res.status}`);
  const data: any = await res.json().catch(() => null);
  if (!res.ok || !data?.status) {
    const errMsg = data?.message ? String(data.message).slice(0, 200) : 'no message';
    console.log(`[paystack] refund failed status=${res.status} message=${errMsg}`);
    throw new Error(`Payment provider refund failed (status ${res.status})`);
  }
  return { ok: true, mock: false, paystack_ref: data?.data?.id ? String(data.data.id) : undefined };
}

// Verifies the x-paystack-signature header: HMAC SHA512 of the raw request
// body using PAYSTACK_SECRET_KEY. Returns false on any mismatch (callers 401).
export function verifyWebhookSignature(rawBody: Buffer, signature: string | undefined): boolean {
  const secret = secretKey();
  if (!secret || !signature) return false;
  const digest = crypto.createHmac('sha512', secret).update(rawBody).digest('hex');
  const a = Buffer.from(digest, 'utf8');
  const b = Buffer.from(signature, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
