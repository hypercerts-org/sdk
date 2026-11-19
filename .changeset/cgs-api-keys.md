---
"@hypercerts-org/sdk": minor
---

- `createSDKContext` takes `cgs.auth: { kind: "apiKey", key }` (`CgsAuth`) to write to a group with a Certified Group Service API key; `client` is then optional and every write needs `{ repo: groupDid }`.
- A context with a key refuses to write without `{ repo }` (`TypeError`) and cannot be created in a browser.
- A key the service refuses throws `WriteRejectedError` (401, 403) naming the missing scope or role and the key as `cgsk_<ref>`, never its secret.
- Writes through the Certified Group Service send `repo` on the querystring as well as in the body.
