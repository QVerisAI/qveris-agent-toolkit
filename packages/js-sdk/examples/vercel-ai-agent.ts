/**
 * Vercel AI SDK agent: let a model discover and call QVeris capabilities.
 *
 * `getQverisTools` exposes the discover / inspect / call workflow as Vercel AI
 * SDK tools, so one QVeris API key gives an agent access to thousands of
 * external capabilities. Bring your own model provider (any `ai` provider):
 *
 *   npm i @ai-sdk/openai
 *   QVERIS_API_KEY=sk-... OPENAI_API_KEY=sk-... npx tsx examples/vercel-ai-agent.ts
 *
 * Without a provider installed the example still runs: it prints the wired
 * tool set instead of driving a model.
 */

import { generateText, stepCountIs } from 'ai';

import { getQverisTools } from '@qverisai/sdk/ai';
import { getClientOrExplain } from './_shared.js';

// Derive the provider's model type from `generateText` itself, so this stays
// correct across `ai` major versions without importing a named type.
type ModelArg = Parameters<typeof generateText>[0]['model'];

/** Load an optional model provider; return null if none is installed. */
async function loadModel(): Promise<ModelArg | null> {
  // A non-literal specifier keeps this type-checking whether or not the optional
  // provider is installed; install @ai-sdk/openai (or any `ai` provider) to run.
  const providerSpecifier: string = '@ai-sdk/openai';
  try {
    const provider = (await import(providerSpecifier)) as { openai: (id: string) => ModelArg };
    return provider.openai('gpt-4o');
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const qveris = getClientOrExplain();
  if (!qveris) return;

  const tools = getQverisTools(qveris);

  const model = await loadModel();
  if (!model) {
    console.log('No model provider installed. Run `npm i @ai-sdk/openai` (or any `ai` provider) to drive the agent.');
    console.log(`Wired QVeris tools: ${Object.keys(tools).join(', ')}`);
    return;
  }

  const { text } = await generateText({
    model,
    tools,
    stopWhen: stepCountIs(6),
    prompt: 'Find a capability that returns a public stock quote, quote AAPL, and explain your choice and its cost.',
  });
  console.log(text);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
