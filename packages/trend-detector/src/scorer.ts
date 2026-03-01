import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { createLogger, getEnv, type TrendScoreResult } from "@flash-pump/shared";
import { withRetry } from "./retry";

const log = createLogger("scorer");

const ScoreResponseSchema = z.object({
  score: z.number().min(0).max(1),
  reasoning: z.string().min(1),
  suggested_name: z.string().min(1),
  suggested_ticker: z.string().min(1).max(10).transform((s: string) => s.toUpperCase()),
});

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic({ apiKey: getEnv().ANTHROPIC_API_KEY });
  }
  return client;
}

/** Score a trend's meme-coin viability using Claude */
export async function scoreTrend(
  keyword: string,
  context: Record<string, unknown>,
): Promise<TrendScoreResult> {
  return withRetry(
    async () => {
      const anthropic = getClient();

      const prompt = `당신은 크립토 밈코인 트렌드 분석가입니다.
다음 트렌드/키워드의 pump.fun 밈코인화 가능성을 0.0~1.0으로 스코어링하세요.

평가 기준:
1. 바이럴 잠재력 (밈화 가능성, 유머/감정 호소)
2. 크립토 커뮤니티 관련성 (CT에서 이미 언급되는지)
3. 토큰 네이밍 적합성 (짧고 캐치한 이름으로 변환 가능한지)
4. 타이밍 (아직 초기인지, 이미 식은 트렌드인지)
5. 이미지/밈 동반 여부 (비주얼 요소가 있으면 토큰 이미지 제작 용이)

트렌드: "${keyword}"
컨텍스트: ${JSON.stringify(context)}

JSON으로 응답: {"score": 0.0~1.0, "reasoning": "한줄 이유", "suggested_name": "토큰명 제안", "suggested_ticker": "티커 제안"}`;

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

      const parsed = ScoreResponseSchema.parse(JSON.parse(jsonMatch[0]));

      log.info(
        { keyword, score: parsed.score, ticker: parsed.suggested_ticker },
        "Trend scored",
      );

      return {
        score: parsed.score,
        reasoning: parsed.reasoning,
        suggestedName: parsed.suggested_name,
        suggestedTicker: parsed.suggested_ticker,
      };
    },
    { maxAttempts: 3, label: "scoreTrend" },
  );
}
