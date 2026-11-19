import { ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { buildMessageContext, imageContextReference } from "~/lib/composerContextRecords";
import { formatInlineContextReference } from "~/lib/composerContextReferences";
import { composerContextRecordsFromDraft } from "./composerContextPresentation";

describe("composerContextRecordsFromDraft", () => {
  it("resolves each wire reference to its own backing draft even when producer ids collide", () => {
    const id = "same.id:1";
    const terminal = {
      id,
      threadId: ThreadId.make("t1"),
      terminalId: "default",
      terminalLabel: "Terminal",
      lineStart: 1,
      lineEnd: 1,
      text: "output",
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    const image = {
      type: "image" as const,
      id,
      name: "shot.png",
      mimeType: "image/png",
      sizeBytes: 1,
      file: new File(["x"], "shot.png"),
      previewUrl: "blob:shot",
    };
    const file = {
      type: "file" as const,
      id,
      name: "file.txt",
      mimeType: "text/plain",
      sizeBytes: 1,
      file: null,
    };
    const draftRecords = composerContextRecordsFromDraft({
      terminalContexts: [terminal],
      images: [image],
      files: [file],
    });
    const message = buildMessageContext({
      terminalContexts: [terminal],
      reviewComments: [],
      previewAnnotations: [],
      attachments: [
        { attachment: image, attachmentId: "uploaded-image" },
        { attachment: file, attachmentId: "uploaded-file" },
      ],
    })!;
    expect(draftRecords.size).toBe(3);
    for (const record of message.records) {
      expect(draftRecords.get(record.contextId)?.kind).toBe(record.kind);
    }
  });

  it("assigns sequential 1-based displayIndex to regular images and renumbers when an earlier image is removed", () => {
    const first = {
      type: "image" as const,
      id: "img-a",
      name: "first.png",
      mimeType: "image/png",
      sizeBytes: 10,
      file: new File(["a"], "first.png"),
      previewUrl: "blob:first",
    };
    const second = {
      type: "image" as const,
      id: "img-b",
      name: "second.png",
      mimeType: "image/png",
      sizeBytes: 12,
      file: new File(["b"], "second.png"),
      previewUrl: "blob:second",
    };
    const promptWithBoth = `${formatInlineContextReference(imageContextReference(first))} ${formatInlineContextReference(imageContextReference(second))}`;
    const bothRecords = composerContextRecordsFromDraft({
      terminalContexts: [],
      images: [first, second],
      prompt: promptWithBoth,
    });
    const firstEntry = bothRecords.get(imageContextReference(first).contextId);
    const secondEntry = bothRecords.get(imageContextReference(second).contextId);
    expect(firstEntry?.kind === "image" ? firstEntry.displayIndex : null).toBe(1);
    expect(secondEntry?.kind === "image" ? secondEntry.displayIndex : null).toBe(2);

    const afterDelete = composerContextRecordsFromDraft({
      terminalContexts: [],
      images: [second],
      prompt: formatInlineContextReference(imageContextReference(second)),
    });
    const remainingEntry = afterDelete.get(imageContextReference(second).contextId);
    expect(remainingEntry?.kind === "image" ? remainingEntry.displayIndex : null).toBe(1);
  });
});
