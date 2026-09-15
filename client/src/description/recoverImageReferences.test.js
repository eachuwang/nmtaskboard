import { expect, it } from "vitest";
import { recoverImageReferences } from "./recoverImageReferences.js";

const attachment = { id: "image-1", filename: "IMG_9195.png", contentType: "image/png" };
const attrs = '{size="medium" align="center" caption=""}';
it("recovers the uniquely matching attachment without changing other text", () => {
  const broken = "说明\n\nIMG\\\\\\_9195" + attrs;
  expect(recoverImageReferences(broken, [attachment])).toEqual({ count: 1, markdown: "说明\n\n![IMG_9195](attachment://image-1)" + attrs });
});
it("does not guess missing or ambiguous attachments or rewrite code", () => {
  const broken = "IMG_9195" + attrs;
  expect(recoverImageReferences(broken, []).count).toBe(0);
  expect(recoverImageReferences(broken, [attachment, { ...attachment, id: "image-2" }]).count).toBe(0);
  expect(recoverImageReferences("    " + broken, [attachment]).count).toBe(0);
});
