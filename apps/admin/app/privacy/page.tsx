export default function Privacy() {
  return (
    <main style={{ padding: 24, maxWidth: 720 }}>
      <h1>Privacy Policy (v1.0-phase0)</h1>
      <p>NDPA-compliant notice per PRD §5.1. Full DPO details to be confirmed before pilot.</p>
      <ul>
        <li>Location collected only during active jobs (accept → complete/cancel), heartbeat every 30–60s.</li>
        <li>Tracking stops for everyone on Job Completed. No background tracking otherwise.</li>
        <li>Photos of waste piles used only for quotes and disputes, retained 1 year.</li>
        <li>Payments held by licensed gateway (Paystack/Flutterwave). We never hold wallet balances.</li>
        <li>Contact DPO: dpo@example.com (placeholder — replace before launch).</li>
      </ul>
    </main>
  );
}
