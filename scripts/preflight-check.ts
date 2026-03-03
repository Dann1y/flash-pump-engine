/**
 * Pre-flight check: validate wallet balance and API keys before mainnet launch.
 *
 * Usage: pnpm tsx scripts/preflight-check.ts
 */

import { Connection, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import bs58 from "bs58";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../.env") });

function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val) {
    console.error(`  ❌ Missing env var: ${key}`);
    return "";
  }
  return val;
}

async function checkWallet() {
  console.log("\n=== Wallet Check ===");
  const rpcUrl = requireEnv("SOLANA_RPC_URL");
  const masterKey = requireEnv("MASTER_WALLET_PRIVATE_KEY");

  if (!rpcUrl || !masterKey) return false;

  const connection = new Connection(rpcUrl, "confirmed");
  const keypair = Keypair.fromSecretKey(bs58.decode(masterKey));
  const balance = await connection.getBalance(keypair.publicKey);
  const solBalance = balance / LAMPORTS_PER_SOL;

  console.log(`  Address: ${keypair.publicKey.toBase58()}`);
  console.log(`  Balance: ${solBalance.toFixed(4)} SOL`);

  if (solBalance < 0.5) {
    console.log(`  ⚠️  Low balance! Need at least 0.5 SOL for testing.`);
    return false;
  }
  console.log(`  ✅ Sufficient balance`);
  return true;
}

async function checkHelius() {
  console.log("\n=== Helius RPC Check ===");
  const rpcUrl = requireEnv("SOLANA_RPC_URL");
  if (!rpcUrl) return false;

  try {
    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getHealth",
      }),
    });
    const data = await res.json();
    if (data.result === "ok") {
      console.log(`  ✅ Helius RPC healthy`);
      return true;
    }
    console.log(`  ❌ Helius RPC unhealthy: ${JSON.stringify(data)}`);
    return false;
  } catch (err) {
    console.log(`  ❌ Helius RPC error: ${err}`);
    return false;
  }
}

async function checkAnthropic() {
  console.log("\n=== Anthropic API Check ===");
  const apiKey = requireEnv("ANTHROPIC_API_KEY");
  if (!apiKey) return false;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 10,
        messages: [{ role: "user", content: "Say OK" }],
      }),
    });

    if (res.ok) {
      console.log(`  ✅ Anthropic API working`);
      return true;
    }
    const err = await res.text();
    console.log(`  ❌ Anthropic API error (${res.status}): ${err.slice(0, 200)}`);
    return false;
  } catch (err) {
    console.log(`  ❌ Anthropic API error: ${err}`);
    return false;
  }
}

async function checkOpenAI() {
  console.log("\n=== OpenAI API Check ===");
  const apiKey = requireEnv("OPENAI_API_KEY");
  if (!apiKey) return false;

  try {
    const res = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (res.ok) {
      console.log(`  ✅ OpenAI API working`);
      return true;
    }
    const err = await res.text();
    console.log(`  ❌ OpenAI API error (${res.status}): ${err.slice(0, 200)}`);
    return false;
  } catch (err) {
    console.log(`  ❌ OpenAI API error: ${err}`);
    return false;
  }
}

async function main() {
  console.log("🔍 Pre-flight checks for Mainnet token launch\n");

  const results = await Promise.all([
    checkWallet(),
    checkHelius(),
    checkAnthropic(),
    checkOpenAI(),
  ]);

  const allPassed = results.every(Boolean);

  console.log("\n=== Summary ===");
  console.log(`  Wallet:    ${results[0] ? "✅" : "❌"}`);
  console.log(`  Helius:    ${results[1] ? "✅" : "❌"}`);
  console.log(`  Anthropic: ${results[2] ? "✅" : "❌"}`);
  console.log(`  OpenAI:    ${results[3] ? "✅" : "❌"}`);
  console.log(`\n${allPassed ? "✅ All checks passed — ready for launch!" : "❌ Some checks failed — fix before proceeding."}`);

  process.exit(allPassed ? 0 : 1);
}

main();
