import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3";
import crypto from "crypto";
import dotenv from "dotenv";

dotenv.config();

const R2_ENDPOINT = process.env.R2_ENDPOINT;
const R2_BUCKET = process.env.R2_BUCKET_NAME;
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL;

// Create R2 client
export const r2 = new S3Client({
  region: "auto",
  endpoint: R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

/**
 * Generate a file hash using SHA256
 */
export function generateHash(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

/**
 * Upload file to R2
 * Note: In 'Isolated Storage' mode, the 'hash' argument passed here
 * contains a unique suffix (e.g., hash-accountId-timestamp) ensuring
 * every upload creates a separate file.
 */
export async function uploadToR2WithHash(buffer, contentType, hash) {
  // We keep "dedup/" folder name for backward compatibility with cleanup scripts
  // even though we are now storing unique copies.
  const key = `dedup/${hash}`;

  try {
    await r2.send(
      new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: key,
        Body: buffer,
        ContentType: contentType,
      })
    );

    return `${R2_PUBLIC_URL}/${key}`;
  } catch (err) {
    console.error("❌ R2 upload error:", err);
    throw err; // Better to throw so the calling function knows it failed
  }
}

/**
 * (Old upload) — still used by manual file uploads if required
 */
export async function uploadToR2(
  key,
  buffer,
  contentType = "application/octet-stream"
) {
  try {
    await r2.send(
      new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: key,
        Body: buffer,
        ContentType: contentType,
      })
    );

    return `${R2_PUBLIC_URL}/${key}`;
  } catch (err) {
    console.error("❌ R2 Upload Error:", err);
    return null;
  }
}

export async function deleteFromR2(key) {
  try {
    await r2.send(
      new DeleteObjectCommand({
        Bucket: R2_BUCKET,
        Key: key,
      })
    );
    console.log("🗑 Deleted from R2:", key);
  } catch (err) {
    console.error("❌ Delete error:", err);
    // We don't throw here to prevent crashing cleanup loops
  }
}

/**
 * Delete all objects with matching prefix
 */
export async function deleteFromR2ByPrefix(prefix) {
  if (!prefix) return;

  try {
    const list = await r2.send(
      new ListObjectsV2Command({
        Bucket: R2_BUCKET,
        Prefix: prefix,
      })
    );

    if (!list.Contents?.length) return;

    await r2.send(
      new DeleteObjectsCommand({
        Bucket: R2_BUCKET,
        Delete: {
          Objects: list.Contents.map((item) => ({ Key: item.Key })),
        },
      })
    );

    console.log("🗑 Deleted objects with prefix:", prefix);
  } catch (err) {
    console.error("❌ Failed to delete prefix:", err);
  }
}
