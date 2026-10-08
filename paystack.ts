export async function initializeTransaction(email: string, amountInKobo: number): Promise<{ success: boolean; authorizationUrl?: string; reference?: string }> {
  const secretKey = process.env.PAYSTACK_SECRET_KEY || '';
  const baseUrl = process.env.PAYSTACK_BASE_URL || 'https://paystack.co';
  const isMock = (process.env.PAYSTACK_MODE ?? 'mock') === 'mock';

  const reference = `tx-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  if (isMock) {
    console.log(`[paystack] MOCK MODE: Initializing transaction for ${email} of amount ${amountInKobo} Kobo.`);
    return {
      success: true,
      authorizationUrl: `https://paystack.com{reference}`,
      reference,
    };
  }

  if (!secretKey || secretKey === 'sk_sandbox_dummy_paystack_key') {
    throw new Error('PAYSTACK_MODE=live but PAYSTACK_SECRET_KEY is not set correctly.');
  }

  try {
    const response = await fetch(`${baseUrl}/transaction/initialize`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${secretKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, amount: amountInKobo, reference }),
    });

    console.log(`[paystack] initialize status=${response.status}`);
    if (!response.ok) return { success: false };

    const data = await response.json();
    if (data && data.status && data.data) {
      return { success: true, authorizationUrl: data.data.authorization_url, reference: data.data.reference };
    }
    return { success: false };
  } catch (error) {
    console.error('[paystack] Network connectivity issue.');
    return { success: false };
  }
}
