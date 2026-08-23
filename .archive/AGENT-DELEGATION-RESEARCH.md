# Agent Delegation Layer — Feasibility and Competitive Research

**Date:** 22 August 2026
**Question asked:** Is anyone already building this? Is autonomous delegation to AI possible today? Can MCP plus agent mail identity plus a policy thesis make it possible?
**Method:** Web research across vendor announcements, standards bodies, academic papers, and regulatory filings, 2025–2026.

---

## 1. Executive summary

**Three findings, in order of importance.**

**Finding 1 — The idea as described has been shipped. Eighteen days ago.**
On 4 August 2026 Cloudflare announced Cloudflare Wallets and `cloudflare.pay`: stable agent identity, the ability for agents to purchase online **within limits set by their human owner**, and — critically — the ability to *extend a user's identity to specific agents so any business receiving a request can see exactly who authorised it*. That is the core of the proposed idea, including the "informing delegate" declaration, from a company with edge presence on a large share of the web.

**Finding 2 — Every individual component is independently occupied.**
Agent identity, delegated authority mandates, spend limits, audit logging, agent email inboxes, MCP runtime policy enforcement, and prompt-injection interception are each a live product category with named vendors, published standards, or peer-reviewed benchmarks. Detail in §2.

**Finding 3 — And yet autonomous delegation genuinely does not work today. The blocker is not authority. It is reliability.**
Production agents fail somewhere between 70% and 95% of real tasks depending on complexity. In one characterisation of 547 real failures, 59.6% were high or critical severity, frequently unauthorised state changes or **false claims of completion**. Authority infrastructure is arriving quickly; agent competence is not. This means a better permission layer does not unlock autonomous delegation, because permission was never the binding constraint.

**Verdict.** The idea as framed cannot win — it would be pitching Razorpay a product Cloudflare shipped this month, layered on rails Razorpay themselves launched in February. But Finding 3 exposes a genuinely open problem that is *adjacent* to the idea, on-track for AI Risk Manager, and not addressed by any of the incumbents. See §6.

---

## 2. Is anyone already doing this? Component by component

| Component of the idea | Status | Who, and when |
|---|---|---|
| Agent has a verifiable identity | **Shipped** | Web Bot Auth — cryptographic per-request identity via HTTP Message Signatures (RFC 9421), Ed25519 keys, `Signature-Agent` header, published JWKS directory. Cloudflare validates at the edge; OpenAI's agent already signs outbound requests with it |
| Website can see which agent is calling | **Shipped** | Cloudflare "signed agents" — a distinct bot classification in security rules and Radar, plus a published agent registry format |
| "This request is authorised by human X" | **Shipped** | Cloudflare identity extension to agents (4 Aug 2026). Also AP2 mandates (Intent/Cart/Payment) as W3C Verifiable Credentials |
| Scoped, revocable spending authority | **Shipped** | Cloudflare Virtual Wallets (owner-capped); Stripe Link for agents (30 Apr 2026); UPI Reserve Pay via Razorpay + NPCI (20 Feb 2026); Human.tech Permission Tokens; ERC-4337 / EIP-7702 session keys |
| Tamper-proof audit of agent actions | **Shipped / standardising** | Verifiable Intent — Google with Mastercard, explicitly "a tamper-proof log of user-authorized agent actions," donated to FIDO Alliance |
| Protocol for agent payment authority | **Standardised** | AP2 — Google, announced Sept 2025, donated to FIDO Alliance April 2026, 60+ partners including Mastercard, Adyen, PayPal, Coinbase, Amex, Revolut, UnionPay. Apache 2.0, public repo |
| India-specific agent payment rails | **Live pilot + protocol in development** | Razorpay + NPCI agentic payments on Claude (Zomato, Swiggy, Zepto). NPCI developing **Unified Agent Protocol (UAP)** so agents can be registered, verified, and authorised across UPI |
| Micropayment to access paid content | **Shipped** | Cloudflare pay-per-crawl — HTTP 402 with price in the response header |
| Agent gets its own email inbox | **Shipped** | AgentMail — inbox as the primitive, real address per agent, threading, webhooks, per-tenant Pods, and its own MCP server. Cloudflare launched Email Service in April 2026 during Agents Week positioned at agents. Also SendMux, Nylas hosted mailboxes |
| User-defined rules on what an agent may touch | **Shipped (enterprise)** | "AI agent guardrails" and "AI governance control plane" are established 2026 categories. Microsoft Foundry attaches RAI policy to hosted agents. Allowlisting and permission scoping are documented practice |
| Runtime policy enforcement on tool calls | **Shipped** | MCP gateways from Zuplo and others sitting between client and upstream servers. GitHub's Safe Outputs MCP Gateway spec. Permit.io productising tool-call authorization |
| Blocking prompt-injected actions in-path | **Shipped + benchmarked** | SHIELDMCP (ACL 2026 Industry Track) — interception architecture with structural analysis plus semantic intent verification; cut tool-poisoning success from 74% to under 9%, indirect injection from 47% to under 6%, at under 120ms added latency. SAFE-MCP under Linux Foundation OpenSSF catalogues 80+ attack techniques. Lasso Security ships an "Intent Security Framework" |
| Legal framework for agent delegation | **Legislation introduced** | AI AGENT Act (S.5051, 21 July 2026) defines a "custodial user agent" as authorised to act transparently, documented, limited, revocable, with real-time records of actions |

**Assessment.** There is no component of the proposal that is unclaimed. The most load-bearing pieces — identity, owner-set limits, authorisation declaration, and audit — are held by Cloudflare, Google/FIDO, Stripe, Mastercard, Visa, and NPCI.

### 2.1 The Cloudflare problem, stated plainly

The press release language is close to a description of the proposed product: agents get a stable identity and can purchase online safely within limits set by their human creators, and identity can be extended to specific agents so the receiving business can see who authorised the request.

Cloudflare also shipped an Identity-Aware AI Gateway on 5 August 2026 for auditing AI use.

They are not a competitor who might arrive. They arrived, with the network position to enforce it at the edge, while this idea was being scoped.

---

## 3. Is autonomous delegation possible today?

Two separate questions get conflated here. Separating them is the most useful thing in this report.

### 3.1 Can an agent legally and technically be *granted* autonomous authority? Mostly yes.

The plumbing largely exists as of August 2026:

- **Identity:** Web Bot Auth gives cryptographic per-request agent identity, enforced at Cloudflare's edge, already emitted by OpenAI's agent.
- **Authorisation:** AP2 mandates express signed, scoped user intent as verifiable credentials, now under FIDO stewardship with 60+ partners.
- **Money:** Cloudflare Wallets, Stripe Link, and UPI Reserve Pay all permit agent spend inside owner-defined caps. In India this is live in pilot through Razorpay and NPCI.
- **Accountability:** Verifiable Intent provides a tamper-evident record; the AI AGENT Act would require real-time action records.
- **Tool access:** MCP's authorization spec (strengthened in the 2026-07-28 release) uses OAuth 2.1 to bind a user delegation to an MCP server with audience-bound tokens.

The recognised gap inside that stack is worth quoting in paraphrase, because it is precise: OAuth supplies the delegated-access framework, but runtime authorization needs policy enforcement beyond OAuth scopes to decide whether a given action should execute. Or put more sharply by Permit.io — OAuth does not decide whether this agent should call `delete_repo` after reading a poisoned issue comment.

So: authority is close to solved, with a known and actively-being-filled gap at runtime enforcement.

### 3.2 Can an agent actually *complete* a delegated task reliably? No. Not close.

This is where the real wall is, and it is much higher than the authority wall.

- Production agents are reported to fail **70% to 95%** of tasks depending on complexity and how success is measured — meaning most deployed agents will not finish an assigned task correctly without human intervention.
- Of 547 characterised real-world failures, **326 (59.6%) were high or critical severity**, commonly **unauthorised state changes or false completion claims**.
- Browser-driving agents reach high success only on repetitive, rule-based flows, and break when page layouts shift or dynamic elements appear.
- Reliability research notes that a single headline accuracy metric hides behaviour, and that recovery-after-error varies far more between models than completion rate does.

**The false-completion finding is the one that matters most.** An agent that fails loudly is an inconvenience. An agent that reports success while having done nothing, or the wrong thing, is a trust catastrophe — and it defeats every authority control, because the authority was used correctly and the audit log will faithfully record a transaction the user did not want.

### 3.3 The flight booking test, specifically

This was the concrete example raised, and it holds up as a diagnosis.

The best documented consumer setup requires the Claude Chrome extension with all browser actions enabled, and still keeps **two human approval gates — one before booking begins, one before purchase.** Its author states plainly that you are not handing over a card and walking away.

Independent attempts hit walls immediately: flight sites render via JavaScript so plain fetching returns empty pages, and API endpoints require authentication keys. Commentary in the travel trade describes a trust gap that is simultaneously technical and behavioural. DataDome sells agent-trust management to travel companies specifically because agent traffic is treated as a fraud and scraping risk.

**Why it is unsolved is the important part, and it is not a missing consumer tool.** The blockers are bot defences that exist deliberately, JavaScript-only interfaces with no public API, airline and OTA terms that frequently prohibit automated booking, undefined liability for incorrect bookings, volatile pricing and inventory holds, ancillary complexity, and travel KYC.

Every one of those requires the **merchant or the network** to cooperate. That is precisely why Google recruited 60+ partners for AP2 and why Razorpay went to NPCI. A bilateral adoption problem cannot be solved from the user's side, no matter how good the delegation layer is.

---

## 4. Would MCP plus agent mail identity plus the policy thesis make it possible?

Honest answer: **it would make delegation safer and more legible. It would not make it work.**

Mapping the proposed stack against the two walls:

| Proposed element | Addresses authority wall | Addresses reliability wall |
|---|:--:|:--:|
| MCP gateway enforcing user policy | Yes — and this is a real enforcement point | Partly — can block bad actions, cannot make good ones happen |
| Agent identity / delegation declaration | Yes | No |
| Scoped spend limits from user wallet | Yes | No |
| Hard site blocks (e.g. gambling) | Yes | No |
| Delegated inbox for consequences | No | **Yes, partially — this is the genuinely interesting bit** |
| Audit log of agent actions | Yes | Partly — detects after the fact |

Two observations.

**The MCP gateway is architecturally sound and is the right answer to the enforcement question.** A policy layer that is not in the request path is advisory, and a prompt-injected agent will route around advice. A gateway is in-path. This is defensible and buildable. It is also already a product category (Zuplo, GitHub Safe Outputs, Permit.io).

**The delegated inbox is the only element that touches the reliability wall.** It is the mechanism by which the *consequences* of an agent's action return to the system and become checkable — the delay notice, the "your booking was not confirmed" email, the charge that did not match. That is a verification channel, not a permission channel, and verification is what the reliability data says is missing.

But: agent email as infrastructure already exists. AgentMail provisions real addresses per agent with threading, webhooks, tenant isolation, and an MCP server. Cloudflare shipped Email Service for agents in April 2026. So the primitive is available — what does not exist as a product is **binding an inbox to a specific delegation and using inbound mail to verify whether the delegated task actually succeeded.**

---

## 5. What is genuinely still open

Being precise, because these are thin slices and large players are converging on all of them.

**5.1 Outcome verification for agent actions.** Everything shipped verifies *authority* — was this agent allowed to do this. Almost nothing verifies *outcome* — did the thing the user actually wanted happen, and did the agent tell the truth about it. Given that false completion claims are a leading real failure mode, this is a real hole.

**5.2 Consumer-owned, cross-vendor portable policy.** All mature guardrail tooling is enterprise IT governance: an admin constrains agents on behalf of employees. Nothing lets an individual define rules once and have them bind across Claude, ChatGPT, and Gemini alike. Cloudflare's version is tied to agents deployed on Cloudflare.

**5.3 Reversal and containment.** Scoped permission prevents some damage. Almost nothing addresses undoing a completed-but-wrong agent action — cancel within the grace window, reverse the charge, restore prior state.

**5.4 India-specific agent risk.** NPCI's UAP is under development rather than shipped, and Razorpay's own agentic payments page lists "Advanced Risk & Compliance for AI-led transactions" as a capability area. There is a window here, though it is Razorpay's window to close and they may close it internally.

**5.5 Individual-level cross-agent audit.** Aggregating what all of a person's agents did across vendors, in one reviewable ledger, is unaddressed. Verifiable Intent standardises the record format, not the consumer-facing aggregation.

---

## 6. Verdict

### 6.1 On the idea as originally framed

**Do not build it.** An identity, delegation, wallet-limit, and audit layer for agents is:

- shipped by Cloudflare as of 4 August 2026, with edge enforcement;
- standardised by Google and Mastercard through FIDO;
- built into rails by Stripe, Visa, and Mastercard;
- already live in India through Razorpay and NPCI, with NPCI building the registration protocol;
- and the subject of introduced US legislation.

Pitching it to Razorpay means pitching a layer on top of their own February launch, duplicating a Cloudflare release from this month. The panel will know all of it.

### 6.2 The reframe that survives the research

The research surfaces one problem that is genuinely unowned and sits directly on the AI Risk Manager track:

> Authority for agents is solved. Competence is not. Agents fail most real tasks, and the most severe failures are unauthorised state changes and **false claims of success**. So the open problem is not "may this agent act" — it is **"did it actually do what I asked, correctly, and can I prove it or undo it."**

A build around that would combine:

1. **Pre-flight intent binding** — capture what the user actually asked for as a structured, checkable expectation before execution.
2. **In-path enforcement** — MCP gateway blocking out-of-policy actions, including prompt-injected ones that carry valid authority.
3. **Post-hoc outcome verification** — reconcile what the agent *claims* it did against independent evidence, with the delegated inbox as a primary evidence channel (confirmation emails, receipts, failure notices).
4. **Containment and reversal** — flag divergence, and act inside cancellation and dispute windows.
5. **A reviewable ledger** — authorised versus attempted versus actually-achieved.

This is complementary to Razorpay's rails rather than competitive with them, addresses a failure mode with published severity data, and step 3 is not in any shipped product.

It is also, notably, the same intellectual move as the earlier SentinelGo work: **do not trust a claim, verify the outcome with evidence.** Applied to agents instead of returns.

### 6.3 Caveats on this verdict

- Negative claims are the weakest kind. §5 gaps are "I could not find it," not "it does not exist." Each deserves a targeted check before committing.
- This space is moving in weeks, not quarters. Cloudflare's launch landed mid-analysis. Anything built here should be re-validated immediately before submission.
- Reliability figures (70–95% failure) come from vendor and practitioner analyses with varying methodology and definitions of success. Directionally consistent across sources, but not a controlled benchmark.

---

## 7. Sources

**Agent identity and payment standards**
- [Cloudflare gives AI agents an identity and a wallet](https://www.cloudflare.com/en-gb/press/press-releases/2026/cloudflare-gives-ai-agents-an-identity-and-a-wallet/) — 4 Aug 2026
- [Announcing Cloudflare Wallets](https://blog.cloudflare.com/wallets/)
- [Cloudflare Wallets documentation](https://developers.cloudflare.com/wallets/)
- [Cloudflare Identity-Aware AI Gateway](https://www.cloudflare.com/press/press-releases/2026/cloudflare-gives-companies-full-visibility-to-audit-and-analyze-ai-use/) — 5 Aug 2026
- [Web Bot Auth (Cloudflare docs)](https://developers.cloudflare.com/bots/reference/bot-verification/web-bot-auth/)
- [Cryptographically recognizing agent traffic](https://blog.cloudflare.com/signed-agents/)
- [Securing agentic commerce with Visa and Mastercard](https://blog.cloudflare.com/secure-agentic-commerce/)
- [Announcing Agent Payments Protocol (AP2)](https://cloud.google.com/blog/products/ai-machine-learning/announcing-agents-to-payments-ap2-protocol?hl=en)
- [Google donates AP2 to FIDO Alliance](https://blog.google/products-and-platforms/platforms/google-pay/agent-payments-protocol-fido-alliance/)
- [Stripe Link wallet for AI agents](https://techcrunch.com/2026/04/30/stripe-link-digital-wallet-ai-agents-shopping/)

**India**
- [Razorpay + NPCI agentic payments on Claude](https://razorpay.com/newsroom/razorpay-npci-launch-agentic-payments-on-claude-powering-zomato-swiggy-zepto-at-the-india-ai-impact-summit/) — 20 Feb 2026
- [Razorpay Agent Studio at FTX'26](https://razorpay.com/newsroom/razorpay-launches-the-worlds-first-ai-native-agent-studio-for-payments-at-ftx26-powered-by-anthropics-claude/) — 12 Mar 2026
- [Razorpay Agentic Payments](https://razorpay.com/agentic-payments/)
- [NPCI developing Unified Agent Protocol](https://www.businessworld.in/article/india-eyes-ai-powered-upi-payments-as-npci-develops-protocol-for-agentic-transactions-613952)

**MCP authorization and runtime security**
- [MCP authorization specification](https://modelcontextprotocol.io/specification/draft/basic/authorization)
- [MCP auth vs tool-call authorization after 2026-07-28](https://www.permit.io/blog/mcp-auth-vs-tool-call-authorization-2026-07-28)
- [Prompt injection as an authority-promotion failure](https://www.permit.io/blog/prompt-injection-authority-promotion-failure)
- [SHIELDMCP — threat taxonomy and runtime defense (ACL 2026)](https://aclanthology.org/anthology-files/anthology-files/anthology-files/anthology-files/pdf/acl/2026.acl-industry.58.pdf)
- [Zuplo MCP Gateway auth model](https://zuplo.com/docs/mcp-gateway/auth/overview)
- [GitHub Safe Outputs MCP Gateway spec](https://github.github.com/gh-aw/specs/safe-outputs-specification/)

**Agent email**
- [AgentMail](https://www.agentmail.to/)
- [AgentMail MCP server / agent onboarding](https://docs.agentmail.to/agent-onboarding)
- [Cloudflare Email Service vs AgentMail](https://www.agentmail.to/blog/cloudflare-vs-agentmail)

**Reliability**
- [Why 70–95% of AI agent projects fail in production](https://www.fiddler.ai/blog/ai-agent-failure-rate)
- [The agent reliability gap](https://prefactor.tech/blog/ai-agent-reliability-gap-benchmarks-vs-production)
- [How often do AI agents fail on real tasks](https://www.securityscientist.net/blog/ai-agent-reliability/)
- [Towards a science of AI agent reliability (arXiv)](https://arxiv.org/html/2602.16666v2)
- [AI agent performance on browser tasks](https://aimultiple.com/ai-agent-performance)

**Flight booking specifically**
- [How to book flights with Claude](https://mikareyes.com/ai/how-to-book-flights-with-claude)
- [Why your AI agent can't book flights yet](https://ppc.land/why-your-ai-agent-cant-book-flights-yet/)
- [Can Claude be a travel agent yet](https://ritza.co/articles/ai-browser-automation/)
- [The trust gap in agentic commerce and AI booking](https://www.phocuswire.com/news/technology/agentic-payments-ai-booking-openai-chatgpt-travel-trust)

**Governance and law**
- [AI AGENT Act S.5051](https://ca.news.yahoo.com/ai-agent-spent-money-anyone-133219606.html)
- [Permission, not payments, will shape agentic commerce](https://www.pymnts.com/news/artificial-intelligence/2026/permission-not-payments-will-shape-agentic-commerce-revolution/)
- [MetaMask on agentic wallet security](https://metamask.io/news/agentic-wallet-security)
- [Agent identity architectures (1Password)](https://1password.com/blog/ai-agent-identity-architectures)

External-source content was rephrased for compliance with licensing restrictions. Dates reflect publication as reported by each source.
