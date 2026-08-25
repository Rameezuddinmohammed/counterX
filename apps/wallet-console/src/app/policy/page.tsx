/**
 * Policy editor page with simulation panel.
 */
export default function PolicyPage() {
  const constraints = [
    { name: "Merchant Allowlist", value: "3 merchants configured" },
    { name: "Amount Limits", value: "Max 50,000 INR per transaction" },
    { name: "Count Limits", value: "Max 10 transactions per day" },
    { name: "Currency", value: "INR only" },
    { name: "Geography", value: "India only" },
    { name: "Approval Threshold", value: "Above 25,000 INR requires approval" },
  ];

  return (
    <main>
      <h1>Buyer Policy Editor</h1>
      <p>
        Configure the buyer policy that governs what your wallet agent can do
        autonomously and what requires approval.
      </p>

      <section>
        <h2>Current Policy Constraints</h2>
        <table>
          <thead>
            <tr>
              <th>Constraint</th>
              <th>Value</th>
            </tr>
          </thead>
          <tbody>
            {constraints.map((c) => (
              <tr key={c.name}>
                <td>{c.name}</td>
                <td>{c.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2>Policy Widening Detection</h2>
        <p>
          Any change that increases the scope of autonomous action is detected
          as a widening and requires step-up authentication (high assurance).
        </p>
      </section>

      <section>
        <h2>Simulation Panel</h2>
        <p>
          Test a proposed transaction against the current policy to see the
          decision (allow, deny, or require approval).
        </p>
        <div>
          <label htmlFor="sim-merchant">Merchant ID</label>
          <input id="sim-merchant" type="text" placeholder="merchant-001" readOnly defaultValue="" />
        </div>
        <div>
          <label htmlFor="sim-amount">Amount (paise)</label>
          <input id="sim-amount" type="text" placeholder="25000" readOnly defaultValue="" />
        </div>
        <div>
          <label htmlFor="sim-currency">Currency</label>
          <input id="sim-currency" type="text" placeholder="INR" readOnly defaultValue="" />
        </div>
        <div>
          <span>Simulation result: </span>
          <span>Run simulation to see result</span>
        </div>
      </section>
    </main>
  );
}
