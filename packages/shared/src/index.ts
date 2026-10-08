// Shared domain types + pricing engine (PRD §4). Single source of truth for API + apps.
export type Role = 'customer' | 'vendor' | 'admin';
export type BookingStatus =
  | 'draft' | 'awaiting_payment' | 'searching_vendor' | 'offered'
  | 'accepted' | 'en_route' | 'arrived' | 'loading'
  | 'adjustment_pending' | 'completed' | 'cancelled' | 'disputed';

export interface LGA {
  id: string;
  name: string;
  surchargeNGN: number;
}

export interface WasteCategory {
  id: string;
  slug: 'bagged' | 'bulky' | 'rubble' | 'recyclable';
  label: string;
  baseRateNGN: number;
  unit: string;
  specialFeeNGN: number;
}

// Pilot scope (PRD §3): only these LGAs allowed in Phase 0.
export const PILOT_LGAS: LGA[] = [
  { id: 'lga-eti-osa', name: 'Eti-Osa', surchargeNGN: 5000 },
  { id: 'lga-ikeja', name: 'Ikeja', surchargeNGN: 3500 },
];

export const WASTE_CATEGORIES: WasteCategory[] = [
  { id: 'cat-bagged', slug: 'bagged', label: 'Excess Bagged Waste', baseRateNGN: 1500, unit: 'bag', specialFeeNGN: 0 },
  { id: 'cat-bulky', slug: 'bulky', label: 'Bulky Items', baseRateNGN: 12000, unit: 'item', specialFeeNGN: 2000 },
  { id: 'cat-rubble', slug: 'rubble', label: 'Renovation Rubble', baseRateNGN: 25000, unit: 'trip', specialFeeNGN: 5000 },
  { id: 'cat-recyclable', slug: 'recyclable', label: 'Recyclables (sorted)', baseRateNGN: 0, unit: 'bag', specialFeeNGN: 0 },
];

export interface PriceBreakdown {
  baseRate: number;
  lgaSurcharge: number;
  specialFee: number;
  total: number;
}

// Total = Base Volume Rate + LGA Flat Surcharge + Special Item Fee (PRD §4.2)
export function estimatePrice(categorySlug: string, qty: number, lgaName: string): PriceBreakdown {
  const cat = WASTE_CATEGORIES.find((c) => c.slug === categorySlug);
  if (!cat) throw new Error(`unknown category: ${categorySlug}`);
  const lga = PILOT_LGAS.find((l) => l.name.toLowerCase() === lgaName.toLowerCase());
  if (!lga) throw new Error(`outside pilot area: ${lgaName}. Pilot: ${PILOT_LGAS.map((l) => l.name).join(', ')}`);
  if (!Number.isFinite(qty) || qty <= 0) throw new Error('qty must be > 0');
  const baseRate = cat.baseRateNGN * qty;
  const specialFee = cat.specialFeeNGN;
  const total = baseRate + lga.surchargeNGN + specialFee;
  return { baseRate, lgaSurcharge: lga.surchargeNGN, specialFee, total };
}

export const CANCELLATION_PENALTY_NGN = 3000;
export const OFFER_TTL_SEC = 60;
export const ARRIVAL_WAIT_SEC = 7 * 60;
export const VENDOR_LATE_THRESHOLD_MIN = 30;
export const TRACKING_HEARTBEAT_SEC_MIN = 30;
export const TRACKING_HEARTBEAT_SEC_MAX = 60;
export const PRIVACY_POLICY_VERSION = 'v1.0-phase0';
