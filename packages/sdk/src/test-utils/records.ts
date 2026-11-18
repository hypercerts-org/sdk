import { type LexMap, lexParse } from "@atproto/lex";
import { cidForLex } from "@atproto/lex-cbor";
import { DID } from "./fake-pds.js";

/** The AT-URI of a record owned by the test account. */
export const uriOf = (collection: string, rkey = "3k2a4b5c6d7e8") =>
  `at://${DID}/${collection}/${rkey}`;

/** A small PNG-typed blob. */
export const png = () => new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });

/** The CID a PDS reports for a stored record, as it computes it from the stored value. */
export const cidOf = async (value: LexMap) =>
  (await cidForLex(lexParse(JSON.stringify(value)))).toString();

/** A coordinate location input with the given name. */
export const location = (name: string) => ({
  lpVersion: "1.0",
  srs: "http://www.opengis.net/def/crs/OGC/1.3/CRS84",
  locationType: "coordinate-decimal",
  location: { string: "90.17,27.47" },
  name,
});
