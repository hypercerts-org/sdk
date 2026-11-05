import { describeError } from "../src/internal/describe.js";
import { readE2eEnv } from "./env.js";
import { login } from "./session.js";

/**
 * Runs once before the tests and stops the run with one message that says what to fix when the
 * environment is incomplete, the PDS cannot be reached, or an account cannot sign in.
 */
export default async function setup(): Promise<void> {
  try {
    await preflight();
  } catch (error) {
    // Printed here and not thrown: Vitest 5.0.5 crashes (`code.charCodeAt is not a function`) while
    // printing an error thrown from a global setup file, which hides the message.
    console.error(`\n${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}

async function preflight(): Promise<void> {
  const env = readE2eEnv();
  await check(
    `reach the PDS at SDK_E2E_PDS_URL (${env.pdsUrl}). Is the sandbox running, and does this machine resolve its hostname? ` +
      "If the error is about a certificate, set NODE_EXTRA_CA_CERTS to the sandbox's root certificate (state/ca/root.crt)",
    async () => {
      const response = await fetch(new URL("/xrpc/com.atproto.server.describeServer", env.pdsUrl));
      if (!response.ok) throw new Error(`the PDS answered HTTP ${response.status}`);
    },
  );
  for (const [user, credentials] of [
    ["SDK_E2E_USER1", env.user1],
    ["SDK_E2E_USER2", env.user2],
  ] as const) {
    await check(
      `sign in as ${user} (${credentials.identifier}). Check ${user} and ${user}_PASSWORD, and that the account was seeded`,
      () => login(env.pdsUrl, credentials),
    );
  }
}

async function check(goal: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (error) {
    throw new Error(`The end-to-end tests could not ${goal}.\nCause: ${describeError(error)}`, {
      cause: error,
    });
  }
}
