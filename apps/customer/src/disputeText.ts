// Plain-words dispute outcomes shared by the receipt card and the Dispute
// screen. Pure text logic — web-safe. Reads the resolution JSON the API
// writes on resolve; unknown shapes fall back to a generic resolved line.
export function describeDispute(d: any): string {
  if (!d) return '';
  if (d.status === 'open') return 'Dispute open — waiting for review.';
  let r: any = null;
  try {
    r = JSON.parse(d.resolution ?? '');
  } catch {
    // fall through to generic line
  }
  const m = r?.money ?? {};
  if (m.requires_manual_reversal) {
    return 'Dispute resolved: refund approved. Money will be returned manually.';
  }
  if (m.moved && r?.action === 'refund_customer') {
    return `Dispute resolved: refund approved${m.refund_ngn != null ? ` (₦${Number(m.refund_ngn).toLocaleString()})` : ''}.`;
  }
  if (m.moved && r?.action === 'refund_vendor') {
    return 'Dispute resolved: payment released to the vendor.';
  }
  if (m.moved) return 'Dispute resolved: outcome applied (see receipt).';
  return 'Dispute resolved.';
}
