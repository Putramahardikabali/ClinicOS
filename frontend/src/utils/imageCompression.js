const DEFAULT_OPTIONS = {
  maxWidth: 1800,
  maxHeight: 1800,
  quality: 0.82,
  maxSizeMB: 1.5,
  minQuality: 0.7,
  fallbackMaxWidth: 1600,
  fallbackMaxHeight: 1600,
  fallbackQuality: 0.75,
  outputType: "image/jpeg",
};

export const PHOTO_TOO_LARGE_MESSAGE =
  "Photo is too large. Please try another photo or reduce camera resolution.";

export const UNSUPPORTED_IMAGE_MESSAGE =
  "Unsupported image type. Please use JPG, PNG, or WebP.";

export const HEIC_UNSUPPORTED_MESSAGE =
  "HEIC/HEIF images are not supported. Please use JPG or PNG.";

export const COMPRESSION_FAILED_MESSAGE =
  "Photo is too large. Please try another photo or reduce camera resolution.";

const SUPPORTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const HEIC_TYPES = new Set(["image/heic", "image/heif"]);
const SUPPORTED_EXT = new Set(["jpg", "jpeg", "png", "webp"]);
const HEIC_EXT = new Set(["heic", "heif"]);

export function fileExtension(name = "") {
  const parts = String(name).toLowerCase().split(".");
  return parts.length > 1 ? parts.pop() : "";
}

export function isHeicImage(file) {
  const type = (file?.type || "").toLowerCase();
  const ext = fileExtension(file?.name);
  return HEIC_TYPES.has(type) || HEIC_EXT.has(ext);
}

export function isSupportedImageFile(file) {
  if (!file) return false;
  if (isHeicImage(file)) return false;
  const type = (file.type || "").toLowerCase();
  if (SUPPORTED_TYPES.has(type)) return true;
  return SUPPORTED_EXT.has(fileExtension(file.name));
}

/** @returns {number} EXIF orientation tag (1–8). */
export function readExifOrientation(arrayBuffer) {
  const view = new DataView(arrayBuffer);
  if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return 1;

  let offset = 2;
  while (offset + 4 < view.byteLength) {
    if (view.getUint8(offset) !== 0xff) return 1;
    const marker = view.getUint8(offset + 1);
    if (marker === 0xe1) {
      const exifStart = offset + 4;
      if (exifStart + 6 > view.byteLength) return 1;
      if (view.getUint32(exifStart) !== 0x45786966) return 1;
      const tiffStart = exifStart + 6;
      if (tiffStart + 8 > view.byteLength) return 1;
      const littleEndian = view.getUint16(tiffStart) === 0x4949;
      const getU16 = (pos) => view.getUint16(pos, littleEndian);
      const getU32 = (pos) => view.getUint32(pos, littleEndian);
      const ifd0 = tiffStart + getU32(tiffStart + 4);
      if (ifd0 + 2 > view.byteLength) return 1;
      const entries = getU16(ifd0);
      for (let i = 0; i < entries; i += 1) {
        const entry = ifd0 + 2 + i * 12;
        if (entry + 12 > view.byteLength) return 1;
        if (getU16(entry) === 0x0112) {
          const value = getU16(entry + 8);
          return value >= 1 && value <= 8 ? value : 1;
        }
      }
      return 1;
    }
    if (marker === 0xda || marker === 0xd9) break;
    const segmentLength = view.getUint16(offset + 2);
    if (segmentLength < 2) break;
    offset += 2 + segmentLength;
  }
  return 1;
}

export function computeTargetSize(width, height, maxWidth, maxHeight) {
  const safeW = Math.max(1, width);
  const safeH = Math.max(1, height);
  if (safeW <= maxWidth && safeH <= maxHeight) {
    return { width: safeW, height: safeH, scaled: false };
  }
  const ratio = Math.min(maxWidth / safeW, maxHeight / safeH, 1);
  return {
    width: Math.max(1, Math.round(safeW * ratio)),
    height: Math.max(1, Math.round(safeH * ratio)),
    scaled: ratio < 1,
  };
}

function orientedCanvasSize(width, height, orientation) {
  if (orientation >= 5 && orientation <= 8) {
    return { width: height, height: width };
  }
  return { width, height };
}

function applyOrientationTransform(ctx, orientation, width, height) {
  switch (orientation) {
    case 2:
      ctx.translate(width, 0);
      ctx.scale(-1, 1);
      break;
    case 3:
      ctx.translate(width, height);
      ctx.rotate(Math.PI);
      break;
    case 4:
      ctx.translate(0, height);
      ctx.scale(1, -1);
      break;
    case 5:
      ctx.rotate(0.5 * Math.PI);
      ctx.scale(1, -1);
      break;
    case 6:
      ctx.rotate(0.5 * Math.PI);
      ctx.translate(0, -height);
      break;
    case 7:
      ctx.rotate(0.5 * Math.PI);
      ctx.translate(width, -height);
      ctx.scale(-1, 1);
      break;
    case 8:
      ctx.rotate(-0.5 * Math.PI);
      ctx.translate(-width, 0);
      break;
    default:
      break;
  }
}

function releaseImageSource(source, isBitmap) {
  if (isBitmap && source?.close) {
    try {
      source.close();
    } catch {
      /* ignore */
    }
  }
}

async function loadImageSource(file) {
  const buffer = await file.arrayBuffer();
  const orientation = readExifOrientation(buffer);
  const blob = new Blob([buffer], { type: file.type || "image/jpeg" });

  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        orientation: 1,
        isBitmap: true,
      };
    } catch {
      /* fall back to Image */
    }
  }

  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("Could not read image"));
      image.src = url;
    });
    return {
      source: img,
      width: img.naturalWidth,
      height: img.naturalHeight,
      orientation,
      isBitmap: false,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Compression failed"));
      },
      type,
      quality,
    );
  });
}

async function renderCompressedBlob(file, opts, overrides = {}) {
  const maxWidth = overrides.maxWidth ?? opts.maxWidth;
  const maxHeight = overrides.maxHeight ?? opts.maxHeight;
  const quality = overrides.quality ?? opts.quality;
  const outputType = overrides.outputType ?? opts.outputType;

  const loaded = await loadImageSource(file);
  const { source, width, height, orientation, isBitmap } = loaded;

  try {
    const target = computeTargetSize(width, height, maxWidth, maxHeight);
    const canvasSize = orientedCanvasSize(target.width, target.height, orientation);
    const canvas = document.createElement("canvas");
    canvas.width = canvasSize.width;
    canvas.height = canvasSize.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Compression failed");

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (!isBitmap && orientation !== 1) {
      applyOrientationTransform(ctx, orientation, target.width, target.height);
    }

    ctx.drawImage(source, 0, 0, target.width, target.height);
    return canvasToBlob(canvas, outputType, quality);
  } finally {
    releaseImageSource(source, isBitmap);
  }
}

function buildOutputFile(blob, originalName) {
  const baseName = String(originalName || "photo").replace(/\.[^.]+$/, "") || "photo";
  return new File([blob], `${baseName}.jpg`, {
    type: "image/jpeg",
    lastModified: Date.now(),
  });
}

async function probeImageDimensions(file) {
  const loaded = await loadImageSource(file);
  const dims = { width: loaded.width, height: loaded.height };
  releaseImageSource(loaded.source, loaded.isBitmap);
  return dims;
}

/**
 * Resize and compress an image file before upload.
 * @returns {{ file: File, originalSize: number, compressedSize: number, skipped: boolean }}
 */
export async function compressImageBeforeUpload(file, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  if (!file) throw new Error(COMPRESSION_FAILED_MESSAGE);
  if (isHeicImage(file)) throw new Error(HEIC_UNSUPPORTED_MESSAGE);
  if (!isSupportedImageFile(file)) throw new Error(UNSUPPORTED_IMAGE_MESSAGE);

  const maxBytes = opts.maxSizeMB * 1024 * 1024;
  const dims = await probeImageDimensions(file);
  const fitsDimensions = dims.width <= opts.maxWidth && dims.height <= opts.maxHeight;
  const fitsSize = file.size <= maxBytes;

  if (fitsDimensions && fitsSize && (file.type === "image/jpeg" || file.type === "image/jpg")) {
    return {
      file,
      originalSize: file.size,
      compressedSize: file.size,
      skipped: true,
    };
  }

  let blob;
  try {
    blob = await renderCompressedBlob(file, opts);
  } catch {
    throw new Error(COMPRESSION_FAILED_MESSAGE);
  }

  let quality = opts.quality;
  while (blob.size > maxBytes && quality > opts.minQuality) {
    quality = Math.max(opts.minQuality, Math.round((quality - 0.05) * 100) / 100);
    try {
      blob = await renderCompressedBlob(file, opts, { quality });
    } catch {
      throw new Error(COMPRESSION_FAILED_MESSAGE);
    }
  }

  if (blob.size > maxBytes) {
    try {
      blob = await renderCompressedBlob(file, opts, {
        maxWidth: opts.fallbackMaxWidth,
        maxHeight: opts.fallbackMaxHeight,
        quality: opts.fallbackQuality,
      });
    } catch {
      throw new Error(COMPRESSION_FAILED_MESSAGE);
    }
  }

  if (blob.size > maxBytes) {
    throw new Error(PHOTO_TOO_LARGE_MESSAGE);
  }

  return {
    file: buildOutputFile(blob, file.name),
    originalSize: file.size,
    compressedSize: blob.size,
    skipped: false,
  };
}

export function dataUrlToFile(dataUrl, name = "image.jpg") {
  const [header, data] = String(dataUrl).split(",");
  if (!data) throw new Error(COMPRESSION_FAILED_MESSAGE);
  const mime = header.match(/data:([^;]+)/)?.[1] || "image/png";
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], name, { type: mime, lastModified: Date.now() });
}

export async function fileToDataUrl(file) {
  const buffer = await file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error(COMPRESSION_FAILED_MESSAGE));
    reader.readAsDataURL(new Blob([buffer], { type: file.type || "image/jpeg" }));
  });
}

/** Compress a canvas data URL (e.g. mapping export) before API upload. */
export async function compressDataUrlBeforeUpload(dataUrl, options = {}) {
  const file = dataUrlToFile(dataUrl, "mapping.png");
  const result = await compressImageBeforeUpload(file, options);
  const compressedDataUrl = await fileToDataUrl(result.file);
  return { ...result, dataUrl: compressedDataUrl };
}

/** Map API upload errors to user-friendly messages. */
export function photoUploadErrorMessage(error) {
  const status = error?.response?.status;
  const detail = error?.response?.data?.detail;
  const text = typeof detail === "string" ? detail : Array.isArray(detail) ? detail[0]?.msg : "";
  if (status === 413 || /too large/i.test(text || "")) return PHOTO_TOO_LARGE_MESSAGE;
  if (status === 400 && /unsupported/i.test(text || "")) return UNSUPPORTED_IMAGE_MESSAGE;
  if (text) return text;
  return "Upload failed. Please try again.";
}
