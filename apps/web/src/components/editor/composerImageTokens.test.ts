import { describe, expect, it } from "vite-plus/test";
import { formatInlineContextReference } from "~/lib/composerContextReferences";
import {
  decodeEditorImageTokens,
  encodeEditorImageTokens,
  nextAvailableImageAlias,
} from "./composerImageTokens";

describe("composerImageTokens", () => {
  it("encodes canonical image references to stable [image N] aliases, preserves mappings across deletion, and avoids literal collisions", () => {
    const img1 = formatInlineContextReference({
      kind: "image",
      contextId: "image_a",
      label: "CleanShot 1.png",
    });
    const img2 = formatInlineContextReference({
      kind: "image",
      contextId: "image_b",
      label: "CleanShot 2.png",
    });
    const canonical = `Look ${img1} and ${img2} done`;
    const encoded = encodeEditorImageTokens(canonical);

    expect(encoded.displayText).toBe("Look [image 1] and [image 2] done");
    expect(encoded.mapCanonicalToDisplay(canonical.indexOf(" done"))).toBe(
      encoded.displayText.indexOf(" done"),
    );

    const decoded = decodeEditorImageTokens(encoded.displayText, encoded.aliasToBinding);
    expect(decoded.canonicalText).toBe(canonical);
    expect(decoded.mapDisplayToCanonical(encoded.displayText.indexOf(" done"))).toBe(
      canonical.indexOf(" done"),
    );

    // Deleting [image 1] leaves [image 2] bound to image_b when existing aliases are preserved,
    // so Vim undo/paste can restore [image 1] -> image_a without colliding with image_b.
    const afterDeleteDisplay = "Look  and [image 2] done";
    const decodedAfterDelete = decodeEditorImageTokens(afterDeleteDisplay, encoded.aliasToBinding);
    expect(decodedAfterDelete.canonicalText).toBe(`Look  and ${img2} done`);

    const reencoded = encodeEditorImageTokens(
      decodedAfterDelete.canonicalText,
      encoded.aliasToBinding,
    );
    expect(reencoded.displayText).toBe("Look  and [image 2] done");
    expect(reencoded.aliasToBinding.get("[image 1]")?.contextId).toBe("image_a");
    expect(reencoded.aliasToBinding.get("[image 2]")?.contextId).toBe("image_b");

    // Literal `[image 1]` typed by the user must never be hijacked by an attachment alias.
    const withLiteral = encodeEditorImageTokens(`Literal [image 1] and ${img1}`);
    expect(withLiteral.displayText).toBe("Literal [image 1] and [image 2]");
    expect(
      decodeEditorImageTokens(withLiteral.displayText, withLiteral.aliasToBinding).canonicalText,
    ).toBe(`Literal [image 1] and ${img1}`);
    expect(nextAvailableImageAlias(new Map(), "Keep [image 1] text")).toBe("[image 2]");
  });
});
