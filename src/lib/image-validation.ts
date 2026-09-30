import sharp from "sharp";

export async function validateScreenshotBytes(bytes: Uint8Array, mime: string) {
  try {
    const image = sharp(Buffer.from(bytes), {
      failOn: "warning",
      limitInputPixels: 40_000_000,
    });
    const metadata = await image.metadata();
    if (`image/${metadata.format}` !== mime || (metadata.pages ?? 1) > 1)
      throw new Error("Unsupported image");
    // Metadata alone accepts truncated images. Decode pixels before trusting proof.
    await image.resize({ width: 1, height: 1 }).raw().toBuffer();
  } catch {
    throw new Error(
      "The screenshot is invalid or damaged. Choose a valid PNG, JPEG or WebP image.",
    );
  }
}
