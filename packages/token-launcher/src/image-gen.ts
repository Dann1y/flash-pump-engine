import Replicate, { FileOutput } from "replicate";
import { getEnv, createLogger, type LaunchSignal } from "@flash-pump/shared";
import { withRetry } from "./retry";
import { PUMP_IPFS_URL } from "./constants";

const log = createLogger("image-gen");

let replicateClient: Replicate | null = null;

function getClient(): Replicate {
  if (!replicateClient) {
    replicateClient = new Replicate({ auth: getEnv().REPLICATE_API_TOKEN });
  }
  return replicateClient;
}

/** Generate a meme token profile image with Replicate Flux Schnell */
async function generateImage(signal: LaunchSignal, tokenName: string): Promise<Buffer> {
  const replicate = getClient();

  const prompt = `Create a fun, eye-catching meme coin profile picture for a cryptocurrency called "${tokenName}" inspired by the trend "${signal.keyword}". Style: colorful, cartoon-like, crypto meme aesthetic, simple and bold, suitable as a small profile icon. No text in the image.`;

  const output = await replicate.run("black-forest-labs/flux-schnell", {
    input: {
      prompt,
      num_outputs: 1,
      aspect_ratio: "1:1",
    },
  });

  const results = output as FileOutput[];
  const file = results[0];
  if (!file) {
    throw new Error("Flux Schnell returned no output");
  }

  const blob = await file.blob();
  return Buffer.from(await blob.arrayBuffer());
}

/** Upload image buffer to pump.fun IPFS and return the metadata URI */
async function uploadToIpfs(
  imageBuffer: Buffer,
  tokenName: string,
  ticker: string,
  description: string,
): Promise<string> {
  const formData = new FormData();
  const blob = new Blob([imageBuffer], { type: "image/png" });
  formData.append("file", blob, `${ticker.toLowerCase()}.png`);
  formData.append("name", tokenName);
  formData.append("symbol", ticker);
  formData.append("description", description);
  formData.append("showName", "true");

  const res = await fetch(PUMP_IPFS_URL, {
    method: "POST",
    body: formData,
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`IPFS upload failed (${res.status}): ${body}`);
  }

  const data = (await res.json()) as { metadataUri: string };
  if (!data.metadataUri) {
    throw new Error("IPFS response missing metadataUri");
  }

  return data.metadataUri;
}

export interface ImageResult {
  metadataUri: string;
}

/**
 * Generate a token image and upload to pump.fun IPFS.
 * Returns the metadata URI for the token deployment.
 */
export async function generateAndUploadImage(
  signal: LaunchSignal,
  tokenName: string,
  ticker: string,
  description: string,
): Promise<ImageResult> {
  const env = getEnv();

  if (env.DRY_RUN) {
    const metadataUri = `https://dry-run.local/metadata/${ticker.toLowerCase()}.json`;
    log.info({ tokenName, ticker, metadataUri }, "[DRY_RUN] Skipping image gen + IPFS, returning placeholder URI");
    return { metadataUri };
  }

  return withRetry(
    async () => {
      log.info({ tokenName, ticker }, "Generating token image");
      const imageBuffer = await generateImage(signal, tokenName);
      log.info({ size: imageBuffer.length }, "Image generated, uploading to IPFS");

      const metadataUri = await uploadToIpfs(imageBuffer, tokenName, ticker, description);
      log.info({ metadataUri }, "Image uploaded to IPFS");

      return { metadataUri };
    },
    { maxAttempts: 3, label: "generateAndUploadImage" },
  );
}
