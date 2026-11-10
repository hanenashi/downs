(function initDownsAes(root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.DownsAes = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";

  const BLOCK_BYTES = 16;

  function sequenceIv(sequence) {
    if (!Number.isSafeInteger(sequence) || sequence < 0) {
      throw new Error("The media sequence number is not a safe non-negative integer.");
    }
    let value = BigInt(sequence);
    const iv = new Uint8Array(BLOCK_BYTES);
    for (let index = BLOCK_BYTES - 1; index >= 0; index -= 1) {
      iv[index] = Number(value & 0xffn);
      value >>= 8n;
    }
    return iv;
  }

  function explicitIv(value) {
    const match = String(value || "").trim().match(/^0x([0-9a-f]{1,32})$/i);
    if (!match) throw new Error("The AES-128 IV must be 0x followed by at most 32 hexadecimal digits.");
    const hex = match[1].padStart(32, "0");
    return new Uint8Array(hex.match(/../g).map((pair) => Number.parseInt(pair, 16)));
  }

  function ivForSegment(value, sequence) {
    return value ? explicitIv(value) : sequenceIv(sequence);
  }

  function validateSegmentEncryption(encryption, sequence) {
    if (!encryption) return null;
    if (String(encryption.method || "").toUpperCase() !== "AES-128") {
      return "Only whole-segment AES-128 encryption is supported.";
    }
    if (String(encryption.keyFormat || "identity").toLowerCase() !== "identity") {
      return "Only identity AES-128 key files are supported.";
    }
    if (encryption.keyFormatVersions && encryption.keyFormatVersions !== "1") {
      return "Only identity key format version 1 is supported.";
    }
    try {
      const url = new URL(encryption.url || "");
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        return "The AES-128 key URI is not HTTP(S).";
      }
    } catch (_error) {
      return "The AES-128 key URI is missing or invalid.";
    }
    try {
      ivForSegment(encryption.iv, sequence);
    } catch (error) {
      return error.message;
    }
    return null;
  }

  async function importKey(rawKey, subtle = globalThis.crypto?.subtle) {
    const bytes = rawKey instanceof Uint8Array ? rawKey : new Uint8Array(rawKey || 0);
    if (bytes.byteLength !== BLOCK_BYTES) throw new Error("AES-128 key files must contain exactly 16 bytes.");
    if (!subtle) throw new Error("Web Crypto is unavailable in this browser.");
    return subtle.importKey("raw", bytes, { name: "AES-CBC" }, false, ["decrypt"]);
  }

  async function decrypt(ciphertext, key, iv, subtle = globalThis.crypto?.subtle) {
    const bytes = ciphertext instanceof Uint8Array ? ciphertext : new Uint8Array(ciphertext || 0);
    if (!bytes.byteLength || bytes.byteLength % BLOCK_BYTES !== 0) {
      throw new Error("Encrypted segment length is not a positive multiple of 16 bytes.");
    }
    if (!(iv instanceof Uint8Array) || iv.byteLength !== BLOCK_BYTES) {
      throw new Error("AES-128 IV must contain exactly 16 bytes.");
    }
    if (!subtle) throw new Error("Web Crypto is unavailable in this browser.");
    return new Uint8Array(await subtle.decrypt({ name: "AES-CBC", iv }, key, bytes));
  }

  return {
    BLOCK_BYTES,
    decrypt,
    explicitIv,
    importKey,
    ivForSegment,
    sequenceIv,
    validateSegmentEncryption
  };
});
