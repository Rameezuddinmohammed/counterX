/**
 * Enrollment page - invite code entry, identity verification, wallet creation.
 */
export default function EnrollmentPage() {
  return (
    <main>
      <h1>Wallet Enrollment</h1>
      <p>Enroll a new wallet in the Counter platform.</p>

      <section>
        <h2>Step 1: Invite Code</h2>
        <p>Enter the invite code provided by your organization.</p>
        <div>
          <label htmlFor="invite-code">Invite Code</label>
          <input
            id="invite-code"
            type="text"
            placeholder="Enter invite code"
            readOnly
            defaultValue=""
          />
        </div>
      </section>

      <section>
        <h2>Step 2: Identity Verification</h2>
        <p>Verify your identity using your registered credentials.</p>
        <ul>
          <li>WebAuthn / FIDO2 hardware key (recommended)</li>
          <li>Multi-factor authentication</li>
          <li>Organization SSO</li>
        </ul>
        <div>
          <span>Status: </span>
          <span>Pending verification</span>
        </div>
      </section>

      <section>
        <h2>Step 3: Wallet Creation</h2>
        <p>
          Once identity is verified, a new wallet will be created with an
          initial device binding and signing key pair.
        </p>
        <ul>
          <li>Generate Ed25519 device key pair</li>
          <li>Create device pairing request</li>
          <li>Bind wallet to verified identity</li>
          <li>Set initial buyer policy</li>
        </ul>
        <div>
          <span>Status: </span>
          <span>Awaiting verification</span>
        </div>
      </section>
    </main>
  );
}
