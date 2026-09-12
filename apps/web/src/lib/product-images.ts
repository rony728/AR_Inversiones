import { apiBlob } from './api';

export const PRODUCT_IMAGE_MAX_DIMENSION = 1400;
export const PRODUCT_IMAGE_MAX_BYTES = 1_500_000;
const imageUrls = new Map<string, Promise<string>>();

async function decodeImage(file: File): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void }> {
  if ('createImageBitmap' in globalThis) {
    const bitmap = await createImageBitmap(file);
    return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
  }
  const url = URL.createObjectURL(file); const image = new Image();
  try {
    await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('No se pudo leer la imagen seleccionada.')); image.src = url; });
    return { source: image, width: image.naturalWidth, height: image.naturalHeight, close: () => URL.revokeObjectURL(url) };
  } catch (error) { URL.revokeObjectURL(url); throw error; }
}

export async function optimizeProductImage(file: File): Promise<Blob> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Selecciona una imagen JPEG, PNG o WebP.');
  const decoded = await decodeImage(file);
  const scale = Math.min(1, PRODUCT_IMAGE_MAX_DIMENSION / Math.max(decoded.width, decoded.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(decoded.width * scale));
  canvas.height = Math.max(1, Math.round(decoded.height * scale));
  const context = canvas.getContext('2d');
  if (!context) { decoded.close(); throw new Error('El navegador no pudo preparar la imagen.'); }
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(decoded.source, 0, 0, canvas.width, canvas.height);
  decoded.close();
  const optimized = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.84));
  if (!optimized) throw new Error('No se pudo optimizar la imagen.');
  if (optimized.size > PRODUCT_IMAGE_MAX_BYTES) throw new Error('La imagen optimizada supera 1.5 MB. Prueba con otra fotografía.');
  return optimized;
}

export function loadProductImage(productId: string, version: string | null | undefined) {
  const key = `${productId}:${version ?? 'current'}`;
  let pending = imageUrls.get(key);
  if (!pending) {
    pending = apiBlob(`/catalogo/productos/${productId}/imagen`).then((blob) => URL.createObjectURL(blob)).catch((error) => { imageUrls.delete(key); throw error; });
    imageUrls.set(key, pending);
  }
  return pending;
}

export function clearProductImageCache(productId: string) {
  for (const [key, pending] of imageUrls) {
    if (!key.startsWith(`${productId}:`)) continue;
    void pending.then((url) => URL.revokeObjectURL(url)).catch(() => undefined);
    imageUrls.delete(key);
  }
}
