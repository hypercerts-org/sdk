/** Environment variables the end-to-end tests read. Documented in docs/e2e-testing.md. */
export const E2E_VARIABLES = [
  "SDK_E2E_PDS_URL",
  "SDK_E2E_PLC_URL",
  "SDK_E2E_USER1",
  "SDK_E2E_USER1_PASSWORD",
  "SDK_E2E_USER2",
  "SDK_E2E_USER2_PASSWORD",
] as const;

export interface Credentials {
  /** A handle, DID or email address accepted by `com.atproto.server.createSession`. */
  identifier: string;
  password: string;
}

export interface E2eEnv {
  /** Origin of the PDS under test, for example `https://pds1.sdkbox.test`. */
  pdsUrl: string;
  /** Origin of the PLC directory that holds the PDS's accounts. */
  plcUrl: string;
  user1: Credentials;
  user2: Credentials;
}

/**
 * Reads the end-to-end configuration from the environment.
 *
 * @throws {@link Error} Naming every variable that is missing, so a run never skips or half-runs
 * silently.
 */
export function readE2eEnv(env: NodeJS.ProcessEnv = process.env): E2eEnv {
  const missing = E2E_VARIABLES.filter((name) => !env[name]);
  if (missing.length > 0) {
    throw new Error(
      `The end-to-end tests need a running PDS and two accounts, but these environment variables are not set:\n${missing.map((name) => `  ${name}`).join("\n")}\n` +
        "docs/e2e-testing.md shows how to start Atmosphere in a Box and set them. " +
        "If the PDS uses the sandbox's private CA, also set NODE_EXTRA_CA_CERTS to its root certificate.",
    );
  }
  const value = (name: (typeof E2E_VARIABLES)[number]) => env[name] as string;
  return {
    pdsUrl: value("SDK_E2E_PDS_URL"),
    plcUrl: value("SDK_E2E_PLC_URL"),
    user1: { identifier: value("SDK_E2E_USER1"), password: value("SDK_E2E_USER1_PASSWORD") },
    user2: { identifier: value("SDK_E2E_USER2"), password: value("SDK_E2E_USER2_PASSWORD") },
  };
}
