import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { getEnv, createLogger, type LaunchSignal, type TokenMetadata } from "@flash-pump/shared";
import { withRetry } from "./retry";

const log = createLogger("metadata");

const MetadataResponseSchema = z.object({
  name: z.string().min(1).max(100),
  ticker: z.string().min(2).max(6).transform((s: string) => s.toUpperCase()),
  description: z.string().min(1),
});

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic({ apiKey: getEnv().ANTHROPIC_API_KEY });
  }
  return client;
}

/** Generate token metadata (name, ticker, description) using Claude */
export async function generateMetadata(signal: LaunchSignal): Promise<TokenMetadata> {
  if (getEnv().DRY_RUN) {
    const metadata: TokenMetadata = {
      name: signal.suggestedName || `${signal.keyword} Token`,
      ticker: (signal.suggestedTicker || signal.keyword.slice(0, 6)).toUpperCase(),
      description: `[DRY_RUN] Meme coin inspired by ${signal.keyword} 🚀🔥`,
    };
    log.info({ name: metadata.name, ticker: metadata.ticker }, "[DRY_RUN] Using signal-provided metadata");
    return metadata;
  }

  return withRetry(
    async () => {
      const anthropic = getClient();

      const prompt = `pump.fun에 올릴 밈코인의 메타데이터를 생성하세요.

트렌드: "${signal.keyword}"
컨텍스트: ${JSON.stringify(signal.context)}

요구사항:
- name: 캐치하고 밈적인 이름 (영문, 2~3단어 이내)
- ticker: 3~6자 대문자 (기억하기 쉽게)
- description: 펌프펀 스타일의 유머러스한 설명 (영문 2~3문장, 이모지 포함)

JSON으로 응답: {"name": "", "ticker": "", "description": ""}`;

      const response = await anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 256,
        messages: [{ role: "user", content: prompt }],
      });

      const text =
        response.content[0].type === "text" ? response.content[0].text : "";

      // Extract JSON from response (may be wrapped in markdown code block)
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error(`No JSON found in Claude response: ${text}`);
      }

      const parsed = MetadataResponseSchema.parse(JSON.parse(jsonMatch[0]));
      log.info({ name: parsed.name, ticker: parsed.ticker }, "Metadata generated");
      return parsed;
    },
    { maxAttempts: 3, label: "generateMetadata" },
  );
}
