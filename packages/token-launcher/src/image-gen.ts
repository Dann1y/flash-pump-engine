import OpenAI from "openai";
import { getEnv, createLogger, type LaunchSignal } from "@flash-pump/shared";
import { withRetry } from "./retry";
import { PUMP_IPFS_URL } from "./constants";

const log = createLogger("image-gen");

let openaiClient: OpenAI | null = null;

function getClient(): OpenAI {
  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey: getEnv().OPENAI_API_KEY });
  }
  return openaiClient;
}

/** Generate a meme token profile image with DALL-E 3 */
async function generateImage(signal: LaunchSignal, tokenName: string): Promise<Buffer> {
  const openai = getClient();

  const prompt = `Create a fun, eye-catching meme coin profile picture for a cryptocurrency called "${tokenName}" inspired by the trend "${signal.keyword}". Style: colorful, cartoon-like, crypto meme aesthetic, simple and bold, suitable as a small profile icon. No text in the image.`;

  const response = await openai.images.generate({
    model: "dall-e-3",
    prompt,
    n: 1,
    size: "1024x1024",
    response_format: "url",
  });

  const imageUrl = response.data?.[0]?.url;
  if (!imageUrl) {
    throw new Error("DALL-E 3 returned no image URL");
  }

  // Download the image
  const res = await fetch(imageUrl);
  if (!res.ok) {
    throw new Error(`Failed to download image: ${res.status}`);
  }

  return Buffer.from(await res.arrayBuffer());
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
