const test = require("node:test");
const assert = require("node:assert/strict");
const { webcrypto } = require("node:crypto");

const Aes = require("../extension/aes-core.js");

test("derives explicit and media-sequence AES-128 IVs", () => {
  assert.deepEqual(
    [...Aes.explicitIv("0x0102")],
    [...new Uint8Array(14), 1, 2]
  );
  assert.deepEqual(
    [...Aes.sequenceIv(258)],
    [...new Uint8Array(14), 1, 2]
  );
  assert.throws(() => Aes.explicitIv("0102"), /0x/);
  assert.throws(() => Aes.sequenceIv(-1), /non-negative/);
});

test("decrypts whole-segment AES-CBC with PKCS7 padding through Web Crypto", async () => {
  const rawKey = Uint8Array.from({ length: 16 }, (_value, index) => index);
  const iv = Aes.sequenceIv(8);
  const plaintext = new TextEncoder().encode("MPEG-TS fixture bytes");
  const encryptionKey = await webcrypto.subtle.importKey(
    "raw",
    rawKey,
    { name: "AES-CBC" },
    false,
    ["encrypt"]
  );
  const ciphertext = new Uint8Array(await webcrypto.subtle.encrypt(
    { name: "AES-CBC", iv },
    encryptionKey,
    plaintext
  ));
  const decryptionKey = await Aes.importKey(rawKey, webcrypto.subtle);

  assert.deepEqual(
    await Aes.decrypt(ciphertext, decryptionKey, iv, webcrypto.subtle),
    plaintext
  );
});

test("validates bounded identity-key metadata", () => {
  const encryption = {
    method: "AES-128",
    url: "https://media.example.test/key.bin",
    keyFormat: "identity"
  };
  assert.equal(Aes.validateSegmentEncryption(encryption, 8), null);
  assert.match(
    Aes.validateSegmentEncryption({ ...encryption, method: "SAMPLE-AES" }, 8),
    /whole-segment/
  );
  assert.match(
    Aes.validateSegmentEncryption({ ...encryption, url: "skd://key" }, 8),
    /HTTP/
  );
});
