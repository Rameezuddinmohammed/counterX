import { describe, expect, it, afterEach } from "vitest";
import { SignJWT, generateKeyPair, exportJWK, createLocalJWKSet } from "jose";
import { createServer } from "./index.js";
import type {
  MerchantApplicationProvisionerLike,
  ProvisionApplicationResult,
  MerchantApplicationSnapshot,
  BusinessBasicsInput,
  ManualCatalogItem,
  ManualCatalogItemInput,
} from "./merchant-application-store.js";
import { MerchantApplicationValidationError } from "./merchant-application-store.js";
import type { FastifyInstance } from "fastify";

// --- Test helpers ---

const TEST_ISSUER = "https://dev-jzw3etjxnn3svs56.us.auth0.com/";
const TEST_AUDIENCE = "https://api.counter.dev";
const CLAIMS_NAMESPACE = "https://counter.dev/";
const TEST_MERCHANT_ID = "ctr_merchant_AAAAAAAAAAAAAAAAAAAAAA";
const OTHER_MERCHANT_ID = "ctr_merchant_BBBBBBBBBBBBBBBBBBBBBB";

interface TestKeyPair {
  privateKey: Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];
  jwks: ReturnType<typeof createLocalJWKSet>;
}

let testKeys: TestKeyPair | undefined;

async function getTestKeys(): Promise<TestKeyPair> {
  if (testKeys !== undefined) return testKeys;
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const publicJwk = await exportJWK(publicKey);
  const jwks = createLocalJWKSet({ keys: [{ ...publicJwk, alg: "RS256", use: "sig" }] });
  testKeys = { privateKey, jwks };
  return testKeys;
}

/** A brand-new merchant-console user: a real, valid session with NO Counter custom claims at all. */
async function createClaimsLessSessionToken(sub: string): Promise<string> {
  const { privateKey } = await getTestKeys();
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ sub })
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(TEST_ISSUER)
    .setAudience(TEST_AUDIENCE)
    .setExpirationTime(now + 3600)
    .setIssuedAt(now)
    .sign(privateKey);
}

/** Mirrors the claims the future "provision merchant + stamp session" Post-Login Action would stamp. */
async function createOnboardingServiceToken(claims: Record<string, unknown> = {}): Promise<string> {
  const { privateKey } = await getTestKeys();
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    sub: "counter-onboarding-provisioner@clients",
    [`${CLAIMS_NAMESPACE}actor_kind`]: "service",
    [`${CLAIMS_NAMESPACE}environment`]: "test",
    [`${CLAIMS_NAMESPACE}scope`]: { kind: "platform" },
    [`${CLAIMS_NAMESPACE}roles`]: ["service.onboarding"],
    [`${CLAIMS_NAMESPACE}assurance`]: "service_authenticated",
    ...claims,
  })
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(TEST_ISSUER)
    .setAudience(TEST_AUDIENCE)
    .setExpirationTime(now + 3600)
    .setIssuedAt(now)
    .sign(privateKey);
}

async function createMerchantOwnerToken(
  merchantId: string,
  claims: Record<string, unknown> = {},
): Promise<string> {
  const { privateKey } = await getTestKeys();
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    sub: "auth0|test-merchant-user",
    [`${CLAIMS_NAMESPACE}actor_kind`]: "merchant_user",
    [`${CLAIMS_NAMESPACE}environment`]: "test",
    [`${CLAIMS_NAMESPACE}scope`]: { kind: "merchant", merchantId },
    [`${CLAIMS_NAMESPACE}roles`]: ["merchant.owner"],
    [`${CLAIMS_NAMESPACE}assurance`]: "session",
    ...claims,
  })
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(TEST_ISSUER)
    .setAudience(TEST_AUDIENCE)
    .setExpirationTime(now + 3600)
    .setIssuedAt(now)
    .sign(privateKey);
}

class FakeMerchantApplicationProvisioner implements MerchantApplicationProvisionerLike {
  #merchantsBySubject = new Map<string, string>();
  #applications = new Map<string, MerchantApplicationSnapshot>();

  async provisionForAuth0Subject(auth0Subject: string): Promise<ProvisionApplicationResult> {
    const existing = this.#merchantsBySubject.get(auth0Subject);
    if (existing !== undefined) {
      const app = this.#applications.get(existing);
      return {
        merchantId: existing,
        merchantUserActorId: `actor_${existing}`,
        created: false,
        lifecycleState: app?.lifecycleState ?? "DRAFT",
        approvalStatus: app?.approvalStatus ?? "pending",
      };
    }
    const merchantId = `ctr_merchant_generated_${this.#merchantsBySubject.size}`;
    this.#merchantsBySubject.set(auth0Subject, merchantId);
    const now = new Date().toISOString();
    this.#applications.set(merchantId, {
      merchantId,
      auth0Subject,
      merchantUserActorId: `actor_${merchantId}`,
      legalEntityName: null,
      contactEmail: null,
      contactPhone: null,
      goodsTypes: [],
      approvalStatus: "pending",
      lifecycleState: "DRAFT",
      lifecycleVersion: 0,
      createdAt: now,
      updatedAt: now,
      catalogConfirmedAt: null,
    });
    return {
      merchantId,
      merchantUserActorId: `actor_${merchantId}`,
      created: true,
      lifecycleState: "DRAFT",
      approvalStatus: "pending",
    };
  }

  async getApplication(merchantId: string): Promise<MerchantApplicationSnapshot | undefined> {
    return this.#applications.get(merchantId);
  }

  async getApplicationByAuth0Subject(
    auth0Subject: string,
  ): Promise<MerchantApplicationSnapshot | undefined> {
    const merchantId = this.#merchantsBySubject.get(auth0Subject);
    return merchantId === undefined ? undefined : this.#applications.get(merchantId);
  }

  async updateBusinessBasics(
    merchantId: string,
    input: BusinessBasicsInput,
  ): Promise<MerchantApplicationSnapshot> {
    const existing = this.#applications.get(merchantId);
    if (existing === undefined) {
      throw new MerchantApplicationValidationError(`No such merchant application: ${merchantId}`);
    }
    const updated: MerchantApplicationSnapshot = {
      ...existing,
      legalEntityName: input.legalEntityName,
      contactEmail: input.contactEmail,
      contactPhone: input.contactPhone ?? null,
      goodsTypes: input.goodsTypes,
      lifecycleState: "CONNECTING",
      lifecycleVersion: existing.lifecycleVersion + 1,
      updatedAt: new Date().toISOString(),
    };
    this.#applications.set(merchantId, updated);
    return updated;
  }

  #manualItems = new Map<string, ManualCatalogItem[]>();
  /** Test helper: mirrors the real store's "an active Shopify connection exists" check. */
  shopifyConnectedMerchantIds = new Set<string>();

  async addManualCatalogItem(
    merchantId: string,
    input: ManualCatalogItemInput,
  ): Promise<ManualCatalogItem> {
    const existing = this.#applications.get(merchantId);
    if (existing === undefined) {
      throw new MerchantApplicationValidationError(`No such merchant: ${merchantId}`);
    }
    const items = this.#manualItems.get(merchantId) ?? [];
    const item: ManualCatalogItem = {
      itemId: String(items.length + 1),
      merchantId,
      name: input.name,
      description: input.description ?? null,
      priceMinor: input.priceMinor,
      currency: input.currency,
      createdAt: new Date().toISOString(),
      reviewed: false,
    };
    items.push(item);
    this.#manualItems.set(merchantId, items);
    return item;
  }

  async listManualCatalogItems(merchantId: string): Promise<readonly ManualCatalogItem[]> {
    return this.#manualItems.get(merchantId) ?? [];
  }

  async markCatalogConnected(merchantId: string): Promise<MerchantApplicationSnapshot> {
    const existing = this.#applications.get(merchantId);
    if (existing === undefined) {
      throw new MerchantApplicationValidationError(`No such merchant application: ${merchantId}`);
    }
    if (existing.lifecycleState !== "CONNECTING") {
      return existing;
    }
    const hasManualItems = (this.#manualItems.get(merchantId)?.length ?? 0) > 0;
    const hasShopify = this.shopifyConnectedMerchantIds.has(merchantId);
    if (!hasManualItems && !hasShopify) {
      throw new MerchantApplicationValidationError(
        "No catalog connection found — connect Shopify or add at least one item first",
      );
    }
    const updated: MerchantApplicationSnapshot = {
      ...existing,
      lifecycleState: "MAPPING",
      lifecycleVersion: existing.lifecycleVersion + 1,
      updatedAt: new Date().toISOString(),
    };
    this.#applications.set(merchantId, updated);
    return updated;
  }

  async confirmManualCatalogItems(merchantId: string): Promise<readonly ManualCatalogItem[]> {
    const items = this.#manualItems.get(merchantId) ?? [];
    const reviewed = items.map((item) => ({ ...item, reviewed: true }));
    this.#manualItems.set(merchantId, reviewed);
    return reviewed;
  }

  async confirmCatalog(merchantId: string): Promise<MerchantApplicationSnapshot> {
    const existing = this.#applications.get(merchantId);
    if (existing === undefined) {
      throw new MerchantApplicationValidationError(`No such merchant application: ${merchantId}`);
    }
    if (existing.lifecycleState !== "MAPPING") {
      return existing;
    }
    const hasManualItems = (this.#manualItems.get(merchantId)?.length ?? 0) > 0;
    const hasShopify = this.shopifyConnectedMerchantIds.has(merchantId);
    if (!hasManualItems && !hasShopify) {
      throw new MerchantApplicationValidationError(
        "No catalog to review yet — connect Shopify or add at least one item first",
      );
    }
    await this.confirmManualCatalogItems(merchantId);
    const now = new Date().toISOString();
    const updated: MerchantApplicationSnapshot = {
      ...existing,
      lifecycleState: "VERIFYING",
      lifecycleVersion: existing.lifecycleVersion + 1,
      updatedAt: now,
      catalogConfirmedAt: now,
    };
    this.#applications.set(merchantId, updated);
    return updated;
  }

  /** Test helper: seed an application directly, bypassing provisionForAuth0Subject. */
  seed(snapshot: MerchantApplicationSnapshot): void {
    this.#applications.set(snapshot.merchantId, snapshot);
    this.#merchantsBySubject.set(snapshot.auth0Subject, snapshot.merchantId);
  }
}

// --- Tests ---

describe("merchant-application routes", () => {
  let server: FastifyInstance | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  describe("POST /merchant-applications/provision", () => {
    it("unauthenticated request returns 401", async () => {
      const { jwks } = await getTestKeys();
      server = createServer({
        jwks,
        environment: "test",
        merchantApplicationProvisioner: new FakeMerchantApplicationProvisioner(),
      });
      await server.ready();

      const response = await server.inject({
        method: "POST",
        url: "/control/v1/merchant-applications/provision",
      });
      expect(response.statusCode).toBe(401);
    });

    it("a plain claims-less session provisions for ITS OWN subject (201), ignoring any body-supplied auth0Subject", async () => {
      const { jwks } = await getTestKeys();
      server = createServer({
        jwks,
        environment: "test",
        merchantApplicationProvisioner: new FakeMerchantApplicationProvisioner(),
      });
      await server.ready();

      const token = await createClaimsLessSessionToken("auth0|real-caller");
      const response = await server.inject({
        method: "POST",
        url: "/control/v1/merchant-applications/provision",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        payload: { auth0Subject: "auth0|someone-else-entirely" },
      });
      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body) as {
        merchantId: string;
        created: boolean;
        lifecycleState: string;
        approvalStatus: string;
      };
      expect(body.created).toBe(true);
      expect(body.lifecycleState).toBe("DRAFT");
      expect(body.approvalStatus).toBe("pending");

      // Idempotent for the SAME real subject, regardless of the ignored body field.
      // No content-type/payload here on purpose: an empty body declared as
      // JSON would fail Fastify's own body parser before this route even
      // runs — this route accepts a request with no body at all.
      const second = await server.inject({
        method: "POST",
        url: "/control/v1/merchant-applications/provision",
        headers: { authorization: `Bearer ${token}` },
      });
      expect(second.statusCode).toBe(200);
      const secondBody = JSON.parse(second.body) as { merchantId: string; created: boolean };
      expect(secondBody.merchantId).toBe(body.merchantId);
      expect(secondBody.created).toBe(false);
    });

    it("a plain merchant_user session (already has claims) also provisions for its own subject", async () => {
      const { jwks } = await getTestKeys();
      server = createServer({
        jwks,
        environment: "test",
        merchantApplicationProvisioner: new FakeMerchantApplicationProvisioner(),
      });
      await server.ready();

      const token = await createMerchantOwnerToken(TEST_MERCHANT_ID);
      const response = await server.inject({
        method: "POST",
        url: "/control/v1/merchant-applications/provision",
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.statusCode).toBe(201);
    });

    it("a service.onboarding token may provision an arbitrary body-supplied auth0Subject", async () => {
      const { jwks } = await getTestKeys();
      server = createServer({
        jwks,
        environment: "test",
        merchantApplicationProvisioner: new FakeMerchantApplicationProvisioner(),
      });
      await server.ready();

      const token = await createOnboardingServiceToken();
      const response = await server.inject({
        method: "POST",
        url: "/control/v1/merchant-applications/provision",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        payload: { auth0Subject: "auth0|someone-provisioned-by-the-service" },
      });
      expect(response.statusCode).toBe(201);
    });

    it("a service.onboarding token without a body auth0Subject returns 400", async () => {
      const { jwks } = await getTestKeys();
      server = createServer({
        jwks,
        environment: "test",
        merchantApplicationProvisioner: new FakeMerchantApplicationProvisioner(),
      });
      await server.ready();

      const token = await createOnboardingServiceToken();
      const response = await server.inject({
        method: "POST",
        url: "/control/v1/merchant-applications/provision",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        payload: {},
      });
      expect(response.statusCode).toBe(400);
    });
  });

  describe("GET /merchant-applications/:merchantId", () => {
    it("a merchant-owner token scoped to a DIFFERENT merchant gets 404, not 403 (existence-hiding)", async () => {
      const { jwks } = await getTestKeys();
      const provisioner = new FakeMerchantApplicationProvisioner();
      server = createServer({
        jwks,
        environment: "test",
        merchantApplicationProvisioner: provisioner,
      });
      await server.ready();

      const token = await createMerchantOwnerToken(OTHER_MERCHANT_ID);
      const response = await server.inject({
        method: "GET",
        url: `/control/v1/merchant-applications/${TEST_MERCHANT_ID}`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body) as { error: { code: string } };
      expect(body.error.code).toBe("NOT_FOUND");
    });

    it("a merchant-owner token scoped to its OWN merchant fetches the application (200)", async () => {
      const { jwks } = await getTestKeys();
      const provisioner = new FakeMerchantApplicationProvisioner();
      provisioner.seed({
        merchantId: TEST_MERCHANT_ID,
        auth0Subject: "auth0|test-merchant-user",
        merchantUserActorId: "actor_x",
        legalEntityName: null,
        contactEmail: null,
        contactPhone: null,
        goodsTypes: [],
        approvalStatus: "pending",
        lifecycleState: "DRAFT",
        lifecycleVersion: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        catalogConfirmedAt: null,
      });
      server = createServer({
        jwks,
        environment: "test",
        merchantApplicationProvisioner: provisioner,
      });
      await server.ready();

      const token = await createMerchantOwnerToken(TEST_MERCHANT_ID);
      const response = await server.inject({
        method: "GET",
        url: `/control/v1/merchant-applications/${TEST_MERCHANT_ID}`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { merchantId: string; lifecycleState: string };
      expect(body.merchantId).toBe(TEST_MERCHANT_ID);
      expect(body.lifecycleState).toBe("DRAFT");
    });

    it("a nonexistent application returns 404", async () => {
      const { jwks } = await getTestKeys();
      server = createServer({
        jwks,
        environment: "test",
        merchantApplicationProvisioner: new FakeMerchantApplicationProvisioner(),
      });
      await server.ready();

      const token = await createMerchantOwnerToken(TEST_MERCHANT_ID);
      const response = await server.inject({
        method: "GET",
        url: `/control/v1/merchant-applications/${TEST_MERCHANT_ID}`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.statusCode).toBe(404);
    });
  });

  describe("PATCH /merchant-applications/:merchantId/business-basics", () => {
    it("requires step-up assurance (identity.scope.manage) — a plain session token is denied 403", async () => {
      const { jwks } = await getTestKeys();
      server = createServer({
        jwks,
        environment: "test",
        merchantApplicationProvisioner: new FakeMerchantApplicationProvisioner(),
      });
      await server.ready();

      const token = await createMerchantOwnerToken(TEST_MERCHANT_ID); // assurance: "session"
      const response = await server.inject({
        method: "PATCH",
        url: `/control/v1/merchant-applications/${TEST_MERCHANT_ID}/business-basics`,
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        payload: {
          legalEntityName: "Acme",
          contactEmail: "owner@acme.example",
          goodsTypes: ["fulfillment.physical.ship"],
        },
      });
      expect(response.statusCode).toBe(403);
    });

    it("a step-up-assured merchant-owner token scoped to its OWN merchant updates business basics (200)", async () => {
      const { jwks } = await getTestKeys();
      const provisioner = new FakeMerchantApplicationProvisioner();
      const { merchantId } = await provisioner.provisionForAuth0Subject("auth0|test-merchant-user");
      server = createServer({
        jwks,
        environment: "test",
        merchantApplicationProvisioner: provisioner,
      });
      await server.ready();

      const token = await createMerchantOwnerToken(merchantId, {
        [`${CLAIMS_NAMESPACE}assurance`]: "step_up",
      });
      const response = await server.inject({
        method: "PATCH",
        url: `/control/v1/merchant-applications/${merchantId}/business-basics`,
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        payload: {
          legalEntityName: "Acme Pvt Ltd",
          contactEmail: "owner@acme.example",
          goodsTypes: ["fulfillment.physical.ship", "fulfillment.digital.deliver"],
        },
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        legalEntityName: string;
        lifecycleState: string;
        goodsTypes: string[];
      };
      expect(body.legalEntityName).toBe("Acme Pvt Ltd");
      expect(body.lifecycleState).toBe("CONNECTING");
      expect(body.goodsTypes).toEqual(["fulfillment.physical.ship", "fulfillment.digital.deliver"]);
    });

    it("a DIFFERENT merchant's step-up token gets 404, not 403 (existence-hiding)", async () => {
      const { jwks } = await getTestKeys();
      const provisioner = new FakeMerchantApplicationProvisioner();
      const { merchantId } = await provisioner.provisionForAuth0Subject("auth0|test-merchant-user");
      server = createServer({
        jwks,
        environment: "test",
        merchantApplicationProvisioner: provisioner,
      });
      await server.ready();

      const token = await createMerchantOwnerToken(OTHER_MERCHANT_ID, {
        [`${CLAIMS_NAMESPACE}assurance`]: "step_up",
      });
      const response = await server.inject({
        method: "PATCH",
        url: `/control/v1/merchant-applications/${merchantId}/business-basics`,
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        payload: {
          legalEntityName: "Acme",
          contactEmail: "owner@acme.example",
          goodsTypes: ["fulfillment.physical.ship"],
        },
      });
      expect(response.statusCode).toBe(404);
    });

    it("missing goodsTypes returns 400", async () => {
      const { jwks } = await getTestKeys();
      const provisioner = new FakeMerchantApplicationProvisioner();
      const { merchantId } = await provisioner.provisionForAuth0Subject("auth0|test-merchant-user");
      server = createServer({
        jwks,
        environment: "test",
        merchantApplicationProvisioner: provisioner,
      });
      await server.ready();

      const token = await createMerchantOwnerToken(merchantId, {
        [`${CLAIMS_NAMESPACE}assurance`]: "step_up",
      });
      const response = await server.inject({
        method: "PATCH",
        url: `/control/v1/merchant-applications/${merchantId}/business-basics`,
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        payload: { legalEntityName: "Acme", contactEmail: "owner@acme.example" },
      });
      expect(response.statusCode).toBe(400);
    });
  });

  describe("manual catalog items + catalog-connected", () => {
    async function provisionAndAdvanceToConnecting(
      provisioner: FakeMerchantApplicationProvisioner,
    ): Promise<string> {
      const { merchantId } = await provisioner.provisionForAuth0Subject("auth0|test-merchant-user");
      await provisioner.updateBusinessBasics(merchantId, {
        legalEntityName: "Acme",
        contactEmail: "owner@acme.example",
        goodsTypes: ["fulfillment.physical.ship"],
      });
      return merchantId;
    }

    it("adds a manual catalog item (201) and lists it back", async () => {
      const { jwks } = await getTestKeys();
      const provisioner = new FakeMerchantApplicationProvisioner();
      const merchantId = await provisionAndAdvanceToConnecting(provisioner);
      server = createServer({
        jwks,
        environment: "test",
        merchantApplicationProvisioner: provisioner,
      });
      await server.ready();

      const token = await createMerchantOwnerToken(merchantId, {
        [`${CLAIMS_NAMESPACE}assurance`]: "step_up",
      });
      const created = await server.inject({
        method: "POST",
        url: `/control/v1/merchant-applications/${merchantId}/manual-catalog-items`,
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        payload: { name: "Hand-thrown mug", priceMinor: 45000, currency: "INR" },
      });
      expect(created.statusCode).toBe(201);

      const list = await server.inject({
        method: "GET",
        url: `/control/v1/merchant-applications/${merchantId}/manual-catalog-items`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(list.statusCode).toBe(200);
      const body = JSON.parse(list.body) as { items: Array<{ name: string }> };
      expect(body.items).toHaveLength(1);
      expect(body.items[0]?.name).toBe("Hand-thrown mug");
    });

    it("catalog-connected fails with no Shopify connection and no manual items", async () => {
      const { jwks } = await getTestKeys();
      const provisioner = new FakeMerchantApplicationProvisioner();
      const merchantId = await provisionAndAdvanceToConnecting(provisioner);
      server = createServer({
        jwks,
        environment: "test",
        merchantApplicationProvisioner: provisioner,
      });
      await server.ready();

      const token = await createMerchantOwnerToken(merchantId, {
        [`${CLAIMS_NAMESPACE}assurance`]: "step_up",
      });
      const response = await server.inject({
        method: "POST",
        url: `/control/v1/merchant-applications/${merchantId}/catalog-connected`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.statusCode).toBe(400);
    });

    it("catalog-connected succeeds (CONNECTING -> MAPPING) once a manual item exists", async () => {
      const { jwks } = await getTestKeys();
      const provisioner = new FakeMerchantApplicationProvisioner();
      const merchantId = await provisionAndAdvanceToConnecting(provisioner);
      await provisioner.addManualCatalogItem(merchantId, {
        name: "Hand-thrown mug",
        priceMinor: 45000,
        currency: "INR",
      });
      server = createServer({
        jwks,
        environment: "test",
        merchantApplicationProvisioner: provisioner,
      });
      await server.ready();

      const token = await createMerchantOwnerToken(merchantId, {
        [`${CLAIMS_NAMESPACE}assurance`]: "step_up",
      });
      const response = await server.inject({
        method: "POST",
        url: `/control/v1/merchant-applications/${merchantId}/catalog-connected`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { lifecycleState: string };
      expect(body.lifecycleState).toBe("MAPPING");
    });

    it("catalog-connected succeeds once a Shopify connection is active, without any manual item", async () => {
      const { jwks } = await getTestKeys();
      const provisioner = new FakeMerchantApplicationProvisioner();
      const merchantId = await provisionAndAdvanceToConnecting(provisioner);
      provisioner.shopifyConnectedMerchantIds.add(merchantId);
      server = createServer({
        jwks,
        environment: "test",
        merchantApplicationProvisioner: provisioner,
      });
      await server.ready();

      const token = await createMerchantOwnerToken(merchantId, {
        [`${CLAIMS_NAMESPACE}assurance`]: "step_up",
      });
      const response = await server.inject({
        method: "POST",
        url: `/control/v1/merchant-applications/${merchantId}/catalog-connected`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { lifecycleState: string };
      expect(body.lifecycleState).toBe("MAPPING");
    });

    it("a DIFFERENT merchant's token cannot add a manual item (404, existence-hiding)", async () => {
      const { jwks } = await getTestKeys();
      const provisioner = new FakeMerchantApplicationProvisioner();
      const merchantId = await provisionAndAdvanceToConnecting(provisioner);
      server = createServer({
        jwks,
        environment: "test",
        merchantApplicationProvisioner: provisioner,
      });
      await server.ready();

      const token = await createMerchantOwnerToken(OTHER_MERCHANT_ID, {
        [`${CLAIMS_NAMESPACE}assurance`]: "step_up",
      });
      const response = await server.inject({
        method: "POST",
        url: `/control/v1/merchant-applications/${merchantId}/manual-catalog-items`,
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        payload: { name: "Mug", priceMinor: 100, currency: "INR" },
      });
      expect(response.statusCode).toBe(404);
    });
  });

  describe("POST /merchant-applications/:merchantId/catalog/confirm", () => {
    async function provisionAndAdvanceToMapping(
      provisioner: FakeMerchantApplicationProvisioner,
    ): Promise<string> {
      const { merchantId } = await provisioner.provisionForAuth0Subject("auth0|test-merchant-user");
      await provisioner.updateBusinessBasics(merchantId, {
        legalEntityName: "Acme",
        contactEmail: "owner@acme.example",
        goodsTypes: ["fulfillment.physical.ship"],
      });
      await provisioner.addManualCatalogItem(merchantId, {
        name: "Hand-thrown mug",
        priceMinor: 45000,
        currency: "INR",
      });
      await provisioner.markCatalogConnected(merchantId);
      return merchantId;
    }

    it("confirms the catalog and transitions MAPPING -> VERIFYING (200)", async () => {
      const { jwks } = await getTestKeys();
      const provisioner = new FakeMerchantApplicationProvisioner();
      const merchantId = await provisionAndAdvanceToMapping(provisioner);
      server = createServer({
        jwks,
        environment: "test",
        merchantApplicationProvisioner: provisioner,
      });
      await server.ready();

      const token = await createMerchantOwnerToken(merchantId, {
        [`${CLAIMS_NAMESPACE}assurance`]: "step_up",
      });
      const response = await server.inject({
        method: "POST",
        url: `/control/v1/merchant-applications/${merchantId}/catalog/confirm`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { lifecycleState: string };
      expect(body.lifecycleState).toBe("VERIFYING");
    });

    it("a DIFFERENT merchant's token gets 404, not 403 (existence-hiding)", async () => {
      const { jwks } = await getTestKeys();
      const provisioner = new FakeMerchantApplicationProvisioner();
      const merchantId = await provisionAndAdvanceToMapping(provisioner);
      server = createServer({
        jwks,
        environment: "test",
        merchantApplicationProvisioner: provisioner,
      });
      await server.ready();

      const token = await createMerchantOwnerToken(OTHER_MERCHANT_ID, {
        [`${CLAIMS_NAMESPACE}assurance`]: "step_up",
      });
      const response = await server.inject({
        method: "POST",
        url: `/control/v1/merchant-applications/${merchantId}/catalog/confirm`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.statusCode).toBe(404);
    });
  });
});
