const card: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #dfe7e0',
  borderRadius: 12,
  padding: 20,
};

export default function Home() {
  return (
    <main style={{ fontFamily: 'system-ui', margin: 0, background: '#f6f8f6', minHeight: '100vh' }}>
      <header style={{ background: '#12351f', color: '#fff', padding: '20px 24px' }}>
        <div style={{ maxWidth: 960, margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 20, fontWeight: 800 }}>Waste Disposal Marketplace</div>
          <nav style={{ display: 'flex', gap: 16 }}>
            <a href="/login" style={{ color: '#fff' }}>Login</a>
            <a href="/privacy" style={{ color: '#fff' }}>Privacy Policy</a>
          </nav>
        </div>
      </header>

      <div style={{ maxWidth: 960, margin: '0 auto', padding: 24, display: 'grid', gap: 16 }}>
        <section style={card}>
          <h1 style={{ marginTop: 0 }}>On-demand waste pickup in Lagos</h1>
          <p>
            Waste Disposal Marketplace connects households and businesses with verified local
            waste collectors. Book a pickup in minutes, pay securely online, and track your
            collector to your door. Currently piloting in <strong>Eti-Osa</strong> and{' '}
            <strong>Ikeja</strong>.
          </p>
        </section>

        <section style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
          <div style={card}>
            <h2 style={{ marginTop: 0 }}>For customers</h2>
            <ol style={{ paddingLeft: 20, lineHeight: 1.7 }}>
              <li>Log in with your phone number (OTP).</li>
              <li>Choose a waste category, quantity and pickup location with photos.</li>
              <li>See the upfront price and pay securely online.</li>
              <li>Track your collector live and raise a dispute if anything goes wrong.</li>
            </ol>
          </div>
          <div style={card}>
            <h2 style={{ marginTop: 0 }}>For vendors</h2>
            <ol style={{ paddingLeft: 20, lineHeight: 1.7 }}>
              <li>Sign up and submit your business, vehicle and documents.</li>
              <li>Get approved by our ops team.</li>
              <li>Accept nearby job offers and travel to the customer.</li>
              <li>Complete the job and get paid out to your account.</li>
            </ol>
          </div>
        </section>

        <section style={card}>
          <h2 style={{ marginTop: 0 }}>Contact us</h2>
          <p>Questions, partnerships or support — reach out:</p>
          <ul style={{ lineHeight: 1.8 }}>
            <li>Business: Springconsole International Limited, RC/BN 1392332</li>
            <li>Registered office: Port Harcourt, Rivers State, Nigeria</li>
            <li>Operations: Lagos (pilot areas: Eti-Osa and Ikeja)</li>
            <li>Address: #1 Ajikere Street Off Chindah Street, Stadium Road, Port Harcourt, Rivers State, Nigeria</li>
            <li>Phone: +2347076222477</li>
            <li>Email: wastedisposalmarketplace@gmail.com</li>
          </ul>
        </section>

        <footer style={{ textAlign: 'center', color: '#5f6f63', fontSize: 14, padding: '8px 0 24px' }}>
          <div style={{ marginBottom: 8 }}>
            <a href="/privacy">Privacy Policy</a> · <a href="/login">Login</a> ·{' '}
            <a href="/admin-tools">Admin tools</a>
          </div>
          <div>Waste Marketplace is a product of Springconsole International Limited</div>
        </footer>
      </div>
    </main>
  );
}
