// Paystack integration placeholder (work in progress).
// Kept as a valid module so the build passes; throws until implemented.
export async function initializeTransaction(email: string, amount: number): Promise<never> {
  void email;
  void amount;
  throw new Error('Paystack initializeTransaction not implemented yet');
}
