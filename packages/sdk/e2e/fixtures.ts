import { randomUUID } from "node:crypto";
import type { LocationInput } from "../src/activity/index.js";

// A valid 1x1 PNG. The PDS reads the dimensions of images it stores, so arbitrary bytes labelled
// image/png would be refused.
export const PNG = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
    "base64",
  ),
);

export const png = () => new Blob([PNG], { type: "image/png" });

/** A text that is different on every call, so records left by earlier runs are never mistaken for these. */
export const unique = (label: string) => `${label} ${randomUUID().slice(0, 8)}`;

export const coordinates: LocationInput = {
  lpVersion: "1.0",
  srs: "http://www.opengis.net/def/crs/OGC/1.3/CRS84",
  locationType: "coordinate-decimal",
  location: { string: "90.17,27.47" },
};

export const rights = {
  rightsName: "CC BY 4.0",
  rightsType: "CC-BY",
  rightsDescription: "Share and adapt with credit",
};
