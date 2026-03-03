/**
 * Quick smoke test for Gemini image generation.
 * Usage: pnpm tsx scripts/test-image-gen.ts
 */
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../.env") });

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error("GEMINI_API_KEY not set in .env");
  process.exit(1);
}

async function main() {
  const ai = new GoogleGenAI({ apiKey });

  console.log("Calling Gemini image generation...");
  const response = await ai.models.generateContent({
    model: "gemini-3.1-flash-image-preview",
    contents:
      "Fun meme coin profile picture, cartoon frog wearing sunglasses, colorful crypto aesthetic, simple bold icon, no text",
    config: {
      responseModalities: ["IMAGE", "TEXT"],
    },
  });

  const parts = response.candidates?.[0]?.content?.parts;
  if (!parts) {
    throw new Error("No content parts returned");
  }

  for (const part of parts) {
    if (part.inlineData?.data) {
      const buf = Buffer.from(part.inlineData.data, "base64");
      console.log(`Image generated: ${buf.length} bytes`);
      console.log("SUCCESS");
      return;
    }
  }

  throw new Error("No image data in response");
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
