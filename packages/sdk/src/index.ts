// Public entry point for @hypercerts-org/sdk.
// Operations are added by the domain cards and imported through their own subpath exports.
// Keep this file free of imports that pull in operations, so the root entry stays tree-shakeable.
export type { CreateSDKContextOptions, DidDocumentResolver, SDKContext } from "./context.js";
export { createSDKContext } from "./context.js";
