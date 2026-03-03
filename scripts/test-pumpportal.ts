/**
 * Test PumpPortal bundle: create(amount=0) + separate buy.
 */

import { Keypair, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";

const PUMP_PORTAL_URL = "https://pumpportal.fun/api/trade-local";

async function main() {
  const mintKeypair = Keypair.generate();
  const deployerAddress = "CKAssrAbJvLrW1UQyAJzfn68i8HZb712UkBuSBXk5rL7";

  console.log("Mint:", mintKeypair.publicKey.toBase58());
  console.log("Deployer:", deployerAddress);

  // Test: Bundle array [create(0), buy(0.05 SOL)]
  console.log("\n=== Bundle: create(0) + buy(0.05) ===");
  const bundledTxArgs = [
    {
      publicKey: deployerAddress,
      action: "create",
      tokenMetadata: {
        name: "PPTest",
        symbol: "TEST",
        uri: "https://ipfs.io/ipfs/QmaUVR47mXPKTusY99EJuiVy9vNXeB1gZHd5Bgncp8DCRH",
      },
      mint: mintKeypair.publicKey.toBase58(),
      denominatedInSol: "true",
      amount: 0,
      slippage: 10,
      priorityFee: 0.0005,
      pool: "pump",
    },
    {
      publicKey: deployerAddress,
      action: "buy",
      mint: mintKeypair.publicKey.toBase58(),
      denominatedInSol: "true",
      amount: 0.05,
      slippage: 50,
      priorityFee: 0.0001,
      pool: "pump",
    },
  ];

  const res = await fetch(PUMP_PORTAL_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(bundledTxArgs),
  });

  console.log(`Status: ${res.status} ${res.statusText}`);
  const contentType = res.headers.get("content-type");
  console.log(`Content-Type: ${contentType}`);

  if (!res.ok) {
    const errBody = await res.text();
    console.log(`Error: "${errBody}"`);
    return;
  }

  // Response should be JSON array of bs58-encoded transactions
  const transactions: string[] = await res.json();
  console.log(`Got ${transactions.length} transactions`);

  for (let i = 0; i < transactions.length; i++) {
    const txBytes = bs58.decode(transactions[i]);
    const tx = VersionedTransaction.deserialize(txBytes);
    console.log(`  tx[${i}]: ${txBytes.length} bytes, ${tx.message.compiledInstructions.length} instructions, needs ${tx.signatures.length} sigs`);
  }
}

main().catch(console.error);
