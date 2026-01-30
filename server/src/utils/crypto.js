// server/src/utils/crypto.js
import crypto from "crypto";

const algorithm = "aes-256-cbc";
const secret = "your-super-secret-key-32-chars!!"; // must be 32 chars
const ivLength = 16;

export const encrypt = (text) => {
  const iv = crypto.randomBytes(ivLength);
  const cipher = crypto.createCipheriv(
    algorithm,
    Buffer.from(secret),
    iv
  );

  let encrypted = cipher.update(text);
  encrypted = Buffer.concat([encrypted, cipher.final()]);

  return iv.toString("hex") + ":" + encrypted.toString("hex");
};

export const decrypt = (encryptedText) => {
  const [ivHex, encryptedHex] = encryptedText.split(":");

  const iv = Buffer.from(ivHex, "hex");
  const encrypted = Buffer.from(encryptedHex, "hex");

  const decipher = crypto.createDecipheriv(
    algorithm,
    Buffer.from(secret),
    iv
  );

  let decrypted = decipher.update(encrypted);
  decrypted = Buffer.concat([decrypted, decipher.final()]);

  return decrypted.toString();
};
