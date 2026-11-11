import { l } from "@atproto/lex";
import * as organization from "@hypercerts-org/lexicon/app/certified/actor/organization";
import { optionalMedia, optionalText, strictObject } from "../internal/input.js";
import {
  type LeafletDocument,
  longDescription,
  longDescriptionReference,
  longDescriptionTransform,
} from "../internal/long-description.js";
import { mediaTransform } from "../internal/media.js";
import { type RecordKind, recordKind, references } from "../internal/record-kind.js";
import type { ExistingRecord } from "../internal/slots.js";
import { type LocationInput, locationKind } from "../location/build-location.js";

/** A labeled URL of an organization. */
export interface OrganizationUrl {
  /** The URL. At most 2048 graphemes. */
  url: string;
  /** A human-readable label, for example `Donation page`. At most 64 graphemes. */
  label?: string | undefined;
}

/**
 * The data of the `app.certified.actor.organization` record of an account.
 *
 * @remarks
 * Only what belongs to the organization is here. The name, short description, website, avatar and
 * banner belong to the account's profile: see `profileIfMissing` in {@link CreateOrganizationInput}.
 */
export interface OrganizationInput {
  /** The organization's registered legal name. At most 256 graphemes. */
  legalName?: string | undefined;
  /** A contact address to show publicly. Records are public, so never an internal one. At most 254 characters. */
  publicEmail?: string | undefined;
  /**
   * The organization's legal or operational structures, for example `nonprofit` or `cooperative`. At
   * most 10, each at most 100 graphemes.
   */
  organizationType?: readonly string[] | undefined;
  /**
   * Further reference links, each with an optional label: social media, a donation page. The main
   * website belongs to the profile.
   */
  urls?: readonly OrganizationUrl[] | undefined;
  /**
   * The full logo (a wordmark, or the symbol with the name): an image `Blob` or `File` (JPEG, PNG
   * or WebP, up to 5 MB) that the SDK uploads, or a URL string that is stored as it is. The square
   * symbol alone belongs to the profile's `avatar`.
   */
  logo?: Blob | string | undefined;
  /**
   * The primary location, where the organization is based: the data of a new location, or `{ uri }`
   * of an existing one, which is reused unchanged.
   */
  location?: LocationInput | ExistingRecord | undefined;
  /**
   * Further locations, such as branches or field offices, at most 1000: each entry is the data of a
   * new location or `{ uri }` of an existing one. Do not repeat the primary `location` here; the
   * order is kept and nothing is deduplicated.
   */
  additionalLocations?: readonly (LocationInput | ExistingRecord)[] | undefined;
  /**
   * When the organization was established, as an ISO 8601 date-time. Use midnight UTC, for example
   * `2005-01-01T00:00:00.000Z`: only the date is meaningful.
   */
  foundedDate?: string | undefined;
  /**
   * A long description: plain text or Markdown, a {@link LeafletDocument} stored inline, or `{ uri }`
   * of an existing document record of any type, stored as a reference to it. The SDK never creates a
   * document record.
   */
  longDescription?: string | LeafletDocument | ExistingRecord | undefined;
  /** Languages of the text fields as BCP-47 tags (up to three), for example `["en"]`. */
  langs?: readonly string[] | undefined;
  /** Whether the organization may be listed: `public` or `unlisted`. Other values are accepted. */
  visibility?: string | undefined;
  /** An ISO 8601 date-time. Defaults to the time of the call. */
  createdAt?: string | undefined;
}

const urlItem = strictObject({ url: l.string(), label: optionalText });

export const organizationKind: RecordKind<OrganizationInput> = recordKind(
  organization.main,
  {
    legalName: optionalText,
    publicEmail: optionalText,
    organizationType: l.optional(l.array(l.string())),
    urls: l.optional(l.array(urlItem)),
    logo: optionalMedia,
    foundedDate: optionalText,
    longDescription: l.optional(longDescription),
    langs: l.optional(l.array(l.string())),
    visibility: optionalText,
  },
  { logo: mediaTransform("image"), longDescription: longDescriptionTransform },
  {
    references: {
      location: references.one(() => locationKind),
      additionalLocations: references.many(() => locationKind),
      longDescription: longDescriptionReference,
    },
  },
);
