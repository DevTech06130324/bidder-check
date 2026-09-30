import { it, expect } from "vitest";
import sharp from "sharp";
import { validateScreenshotBytes } from "@/lib/image-validation";
it("rejects truncated images even with valid magic bytes", async () => {
  await expect(
    validateScreenshotBytes(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      "image/png",
    ),
  ).rejects.toThrow();
});
it("decodes genuine images and rejects mismatched MIME types", async () => {
  const bytes = await sharp({
    create: { width: 2, height: 2, channels: 3, background: "#fff" },
  })
    .png()
    .toBuffer();
  await expect(
    validateScreenshotBytes(bytes, "image/png"),
  ).resolves.toBeUndefined();
  await expect(validateScreenshotBytes(bytes, "image/jpeg")).rejects.toThrow();
});
