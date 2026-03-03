/**
 * Quick smoke test for GPT Image Mini.
 * Usage: pnpm tsx scripts/test-image-gen.ts
 */
import OpenAI from "openai";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../.env") });

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  console.error("OPENAI_API_KEY not set in .env");
  process.exit(1);
}

async function main() {
  const openai = new OpenAI({ apiKey });

  console.log("Calling GPT Image Mini...");
  const response = await openai.images.generate({
    model: "gpt-image-1-mini",
    prompt:
      "Fun meme coin profile picture, cartoon frog wearing sunglasses, colorful crypto aesthetic, simple bold icon, no text",
    n: 1,
    size: "1024x1024",
  });

  const b64 = response.data?.[0]?.b64_json;
  if (!b64) {
    throw new Error("No image data returned");
  }

  const buf = Buffer.from(b64, "base64");
  console.log(`Image generated: ${buf.length} bytes`);
  console.log("SUCCESS");
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
