/**
 * Public, non-secret RS256 test keypair for the runtime-token issuer
 * (control-plane-api's self-signed buyer-runtime credentials — see
 * apps/control-plane-api/src/runtime-token-signer-env.ts). Used ONLY as the
 * local/test fallback when no real signer is configured, mirroring
 * @counter/trust-protocol's TEST_KID_B/getTestPrivateKeyB pattern for CTP
 * envelopes. Both the signer (control-plane-api) and the verifier
 * (agent-runtime) import this SAME constant in non-production so a local dev
 * loop works without any secret configuration.
 *
 * SECURITY: this keypair is committed, publicly known, and MUST NEVER be
 * used to sign a real buyer-runtime credential in production/pilot/live. The
 * fail-closed check that enforces this lives in runtime-token-signer-env.ts,
 * not here.
 */
export const RUNTIME_TOKEN_TEST_KID = "runtime-token-test-key-1";

export const RUNTIME_TOKEN_TEST_PRIVATE_KEY_PEM = `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDSFE6uXgW/dsYt
t4b08YnCE4ovFlkh0qsmY9K1tmaoTrapRM1Xc0+PtNi3XW/kVu+vQt5ohbn7LrPR
bZE/t+KFenoOQupNscYm+FanAmD/GKzTY+KUf/88R6K6kQzYv5plKKIeiKrH9+Gv
+B6O4JqTUlo2V3CTTcTwvPfmzQ/drKO7xpe5C+UuUg05Qk3utXkZ9CMbWQebbPi3
ZlIFhU+B3aguHGLrq0iGbNAohD8jM9VnkvsRMDlA9eN8iPd6Js19kqy5JyJDPs3a
o0KR4uxjoGx/3lP/mYjOYQTSl5D1xY05gTxQaN6iZ8zRj+KO4XmiKEsPfiobf0qb
y5xsEbdFAgMBAAECggEAEq2xjTlY43wpBLmTq0WqjPH10Ff5VtOHWiN4AaYVHJPb
E9PFOihLg6h9uFf7cd708q1MXxi8v4OYg19tka/E2T9ZiNkUQhIzXxWnhrPkcen8
u9Leu3th8zcfVd09uivXC3WAbJyUKrF0hJPYC7YWqFCjKr+9h6tbflge5ouHBJuC
qmAnfbXXRgzKsXjIJA9+swYYll+FZ5f8h4XbfuT+7HZURNOg2HZzwHKiBOKtC7jx
vCp7/ZWNINWX0Kt2OHZUDax2JSZ25HtDbWHJ53Z7S8fqPt0umIMV3FTKwN5ZMPCC
Ru6XHcoyDY/7jjKesSL8xnZwdhf0s4GVS1wGv43KBQKBgQD09Ckk/GRG+QM38AVf
f2LFckzri/IxuSw67XeVm+0Cs3SC9CE6S8hnNkPKd9e4RgIrjzK7WMViN0QotW1q
wR+RFin83HonYFlkIZWH/sy9aJFrHZoS++BvZUIqHbBNMNjdwf6XUDK/eropYxJY
glz0VkCmXuFu0b/5STSw2ul8dwKBgQDbjYsAhBkOBghgD2aY50b7a1dzdvhPDA9x
UoEqTQRAndpq5eWlTbe6ZHwJLpm58OuoTX4pIrZfyR/XlidUI85oSxfbgUR15vmg
WQF1dMyxig13cVEmcsG83lmiLeQ7DsowLCBdBW0AXkkzkbefw0A1RiPhHm1soIDa
Zbr8GrulIwKBgQDiDHv3vM7RTDTzJxXeRhEhQtTHPjN4PXkavE/yCZ3UM0VfH+mW
AZ9j2AkBTE0PqdOQ3SolB8vHUlcc9iiOLsBxxLFkvxYfRmPX6sIyaSoJ1Pj1j7DC
uhwo0JoZgaJT6bMIGmFWw9TBLYGkdd/VPCCJ/xrULZT+DqSJaUwttSdpCwKBgQDW
ptoB1STRyyAhGq2KTIPfh6DmaKh4UChA+RMDkmzX5/0FimMtbIB2oYuLRp5RZrRf
xfPUr/VyTKbvFgS5hJBm8xQOLaILS5k/JgYBGgKOiZSE9KsMViIIT7N+ljOPcfRH
iLzTdVyOgaA75PmMH08FRuAJVsBQ9dNEszVPCavv1QKBgHAd4TJMqCnZQZVG7L9i
ET4gZphW5PN+ZjO+LU+4A6FPS5sMt8z9LzHszjVTIbtKU+aWtv01wcUzJ0lFW0qd
Q2OmSPuLF5wlYdb+Aba/Iduq9EfHABTVEoGcgrlS77tfgd4pd7kFPqw9TUONcXKr
TYsGIiYCN68uMqVeOBczRPXj
-----END PRIVATE KEY-----`;

export const RUNTIME_TOKEN_TEST_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0hROrl4Fv3bGLbeG9PGJ
whOKLxZZIdKrJmPStbZmqE62qUTNV3NPj7TYt11v5Fbvr0LeaIW5+y6z0W2RP7fi
hXp6DkLqTbHGJvhWpwJg/xis02PilH//PEeiupEM2L+aZSiiHoiqx/fhr/gejuCa
k1JaNldwk03E8Lz35s0P3ayju8aXuQvlLlINOUJN7rV5GfQjG1kHm2z4t2ZSBYVP
gd2oLhxi66tIhmzQKIQ/IzPVZ5L7ETA5QPXjfIj3eibNfZKsuSciQz7N2qNCkeLs
Y6Bsf95T/5mIzmEE0peQ9cWNOYE8UGjeomfM0Y/ijuF5oihLD34qG39Km8ucbBG3
RQIDAQAB
-----END PUBLIC KEY-----`;
