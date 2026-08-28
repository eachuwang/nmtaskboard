import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import http from "node:http";
import { createEntraOidcAdapter } from "../lib/oidc.js";

const tenantId = "11111111-2222-3333-4444-555555555555";
const clientId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

function encoded(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function signedJwt(privateKey, kid, claims) {
  const signed = `${encoded({ alg: "RS256", typ: "JWT", kid })}.${encoded(claims)}`;
  return `${signed}.${crypto.sign("RSA-SHA256", Buffer.from(signed), privateKey).toString("base64url")}`;
}

async function fakeIdentityProvider() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const kid = "fake-key";
  let tokenClaims = {};
  const requests = [];
  const server = http.createServer(async (req, res) => {
    const base = `http://127.0.0.1:${server.address().port}`;
    requests.push({ method: req.method, url: req.url });
    res.setHeader("content-type", "application/json");
    if (req.url.includes(".well-known/openid-configuration")) return res.end(JSON.stringify({
      issuer: `${base}/${tenantId}/v2.0`,
      authorization_endpoint: `${base}/authorize`,
      token_endpoint: `${base}/token`,
      jwks_uri: `${base}/keys`
    }));
    if (req.url === "/keys") {
      return res.end(JSON.stringify({ keys: [{ ...publicKey.export({ format: "jwk" }), kid, alg: "RS256", use: "sig" }] }));
    }
    if (req.url === "/token") {
      let body = "";
      for await (const chunk of req) body += chunk;
      requests.at(-1).body = body;
      return res.end(JSON.stringify({ id_token: signedJwt(privateKey, kid, tokenClaims) }));
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not found" }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    requests,
    setTokenClaims(value) { tokenClaims = value; },
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

function memoryOidcRepository(baseUrl) {
  const flows = new Map();
  const profiles = [];
  return {
    flows,
    profiles,
    repository: {
      async getAuthConfiguration() {
        return {
          provider: "entra", tenantId, clientId, clientSecretEncrypted: "encrypted-secret",
          redirectUri: `${baseUrl}/callback`, administratorSubject: "99999999-8888-7777-6666-555555555555"
        };
      },
      async createOidcFlow(flow) { flows.set(flow.stateHash, flow); },
      async consumeOidcFlow(stateHash) {
        const flow = flows.get(stateHash);
        flows.delete(stateHash);
        return flow || null;
      },
      async bindExternalIdentity(profile) {
        profiles.push(profile);
        return { id: "identity-1", displayName: profile.displayName, disabledAt: null, isSystemAdmin: false };
      }
    }
  };
}

test("Entra OIDC 适配器验证 discovery、PKCE、state、nonce、签名、发行者和受众", async (t) => {
  const provider = await fakeIdentityProvider();
  t.after(() => provider.close());
  const memory = memoryOidcRepository(provider.baseUrl);
  const adapter = createEntraOidcAdapter({
    repository: memory.repository,
    decryptSecret: () => "client-secret",
    authorityBase: provider.baseUrl
  });

  const connection = await adapter.testConnection({ tenantId, clientId, redirectUri: `${provider.baseUrl}/callback`, administratorSubject: "99999999-8888-7777-6666-555555555555" });
  assert.equal(connection.ok, true);
  assert.equal(provider.requests.some((request) => request.url === "/keys" && request.body), false);

  const authorizationUrl = new URL(await adapter.startLogin());
  assert.equal(authorizationUrl.pathname, "/authorize");
  assert.equal(authorizationUrl.searchParams.get("response_type"), "code");
  assert.equal(authorizationUrl.searchParams.get("code_challenge_method"), "S256");
  assert.ok(authorizationUrl.searchParams.get("state"));
  assert.ok(authorizationUrl.searchParams.get("nonce"));
  const nowSeconds = Math.floor(Date.now() / 1000);
  provider.setTokenClaims({
    iss: `${provider.baseUrl}/${tenantId}/v2.0`, aud: clientId, tid: tenantId,
    oid: "entra-object-1", name: "Entra 用户", preferred_username: "user@example.com",
    nonce: authorizationUrl.searchParams.get("nonce"), iat: nowSeconds, nbf: nowSeconds - 1, exp: nowSeconds + 300
  });

  const identity = await adapter.completeLogin({ state: authorizationUrl.searchParams.get("state"), code: "authorization-code" });
  assert.equal(identity.id, "identity-1");
  assert.deepEqual(memory.profiles, [{
    provider: "entra", subject: "entra-object-1", tenantId,
    email: "user@example.com", displayName: "Entra 用户"
  }]);
  const tokenRequest = provider.requests.find((request) => request.url === "/token");
  assert.match(tokenRequest.body, /client_secret=client-secret/);
  assert.match(tokenRequest.body, /code_verifier=/);

  await assert.rejects(
    adapter.completeLogin({ state: authorizationUrl.searchParams.get("state"), code: "replay" }),
    (error) => error.code === "OIDC_STATE_INVALID"
  );
});

test("Entra OIDC 拒绝 nonce 不匹配的身份令牌", async (t) => {
  const provider = await fakeIdentityProvider();
  t.after(() => provider.close());
  const memory = memoryOidcRepository(provider.baseUrl);
  const adapter = createEntraOidcAdapter({ repository: memory.repository, decryptSecret: () => "secret", authorityBase: provider.baseUrl });
  const authorizationUrl = new URL(await adapter.startLogin());
  const nowSeconds = Math.floor(Date.now() / 1000);
  provider.setTokenClaims({
    iss: `${provider.baseUrl}/${tenantId}/v2.0`, aud: clientId, tid: tenantId, sub: "subject",
    nonce: "wrong-nonce", nbf: nowSeconds - 1, exp: nowSeconds + 300
  });
  await assert.rejects(
    adapter.completeLogin({ state: authorizationUrl.searchParams.get("state"), code: "code" }),
    (error) => error.code === "OIDC_NONCE_INVALID"
  );
});
