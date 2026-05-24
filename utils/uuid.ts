// Declare global msCrypto for legacy IE support
declare global {
  interface Window {
    msCrypto?: Crypto;
  }
  var msCrypto: Crypto | undefined;
}

const uuidv4 = (): string => {
  const getRandomValues = (() => {
    if (typeof crypto !== "undefined" && crypto.getRandomValues) {
      return crypto.getRandomValues.bind(crypto);
    }
    if (typeof window !== "undefined" && window.msCrypto && window.msCrypto.getRandomValues) {
      return window.msCrypto.getRandomValues.bind(window.msCrypto);
    }
    throw new Error("crypto.getRandomValues() not supported.");
  })();
  const bytes = new Uint8Array(16);
  getRandomValues(bytes);
  // Set version (4) and variant bits
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex: string[] = [];
  for (let i = 0; i < 256; i++) {
    hex[i] = (i + 256).toString(16).slice(1);
  }
  return [
    hex[bytes[0]], hex[bytes[1]], hex[bytes[2]], hex[bytes[3]], '-',
    hex[bytes[4]], hex[bytes[5]], '-',
    hex[bytes[6]], hex[bytes[7]], '-',
    hex[bytes[8]], hex[bytes[9]], '-',
    hex[bytes[10]], hex[bytes[11]], hex[bytes[12]], hex[bytes[13]], hex[bytes[14]], hex[bytes[15]]
  ].join('');
};

export default uuidv4;
