import * as NodeAssert from "node:assert/strict";
import * as NodeTest from "node:test";
import { selectSigningIdentity } from "./signing.mjs";

NodeTest.test(
  "local updates keep a certificate identity and refuse ambiguous or missing signers",
  () => {
    const development =
      '1) AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA "Apple Development: Local User (TEAM)"';
    const distribution =
      '2) BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB "Developer ID Application: Local User (TEAM)"';
    NodeAssert.equal(selectSigningIdentity(development).hash, "A".repeat(40));
    NodeAssert.equal(
      selectSigningIdentity(development, "Apple Development: Local User (TEAM)").hash,
      "A".repeat(40),
    );
    NodeAssert.equal(
      selectSigningIdentity(development + "\n" + distribution, undefined, "A".repeat(40)).hash,
      "A".repeat(40),
    );
    NodeAssert.throws(() => selectSigningIdentity("0 valid identities found"));
    NodeAssert.throws(() => selectSigningIdentity(development, "-"));
    NodeAssert.throws(() => selectSigningIdentity(development + "\n" + distribution));
    NodeAssert.throws(() => selectSigningIdentity(distribution, undefined, "A".repeat(40)));
  },
);
