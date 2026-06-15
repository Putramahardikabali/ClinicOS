import {
  computeTargetSize,
  fileExtension,
  isHeicImage,
  isSupportedImageFile,
  readExifOrientation,
} from "./imageCompression";

describe("imageCompression helpers", () => {
  test("computeTargetSize keeps small images", () => {
    expect(computeTargetSize(800, 600, 1800, 1800)).toEqual({
      width: 800,
      height: 600,
      scaled: false,
    });
  });

  test("computeTargetSize scales large images proportionally", () => {
    const result = computeTargetSize(4000, 3000, 1800, 1800);
    expect(result.width).toBe(1800);
    expect(result.height).toBe(1350);
    expect(result.scaled).toBe(true);
  });

  test("does not upscale tiny images", () => {
    const result = computeTargetSize(200, 100, 1800, 1800);
    expect(result).toEqual({ width: 200, height: 100, scaled: false });
  });

  test("detects HEIC files", () => {
    expect(isHeicImage({ name: "photo.heic", type: "image/heic" })).toBe(true);
    expect(isSupportedImageFile({ name: "photo.heic", type: "image/heic" })).toBe(false);
  });

  test("accepts common image types", () => {
    expect(isSupportedImageFile({ name: "a.jpg", type: "image/jpeg" })).toBe(true);
    expect(isSupportedImageFile({ name: "a.webp", type: "image/webp" })).toBe(true);
    expect(isSupportedImageFile({ name: "a.png", type: "" })).toBe(true);
  });

  test("readExifOrientation returns 1 for non-jpeg", () => {
    const buf = new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer;
    expect(readExifOrientation(buf)).toBe(1);
  });

  test("fileExtension", () => {
    expect(fileExtension("photo.JPG")).toBe("jpg");
    expect(fileExtension("noext")).toBe("");
  });
});
