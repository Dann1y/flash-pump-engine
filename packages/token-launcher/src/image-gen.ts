import { GoogleGenAI } from "@google/genai";
import { getEnv, createLogger, type LaunchSignal } from "@flash-pump/shared";
import { withRetry } from "./retry";
import { PUMP_IPFS_URL } from "./constants";

const log = createLogger("image-gen");

let genaiClient: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  if (!genaiClient) {
    genaiClient = new GoogleGenAI({ apiKey: getEnv().GEMINI_API_KEY });
  }
  return genaiClient;
}

/** Generate a meme token profile image with Gemini */
async function generateImage(signal: LaunchSignal, tokenName: string): Promise<Buffer> {
  const ai = getClient();

  const prompt = `Create a fun, eye-catching meme coin profile picture for a cryptocurrency called "${tokenName}" inspired by the trend "${signal.keyword}". Style: colorful, cartoon-like, crypto meme aesthetic, simple and bold, suitable as a small profile icon. No text in the image.`;

  const response = await ai.models.generateContent({
    model: "gemini-3.1-flash-image-preview",
    contents: prompt,
    config: {
      responseModalities: ["IMAGE", "TEXT"],
    },
  });

  const parts = response.candidates?.[0]?.content?.parts;
  if (!parts) {
    throw new Error("Gemini returned no content parts");
  }

  for (const part of parts) {
    if (part.inlineData?.data) {
      return Buffer.from(part.inlineData.data, "base64");
    }
  }

  throw new Error("Gemini returned no image data");
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
