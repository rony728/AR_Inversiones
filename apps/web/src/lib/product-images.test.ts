// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PRODUCT_IMAGE_MAX_DIMENSION, optimizeProductImage } from './product-images';

describe('optimización de imagen de producto', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
  it('reduce el lado mayor y genera JPEG antes de subir', async () => {
    const close = vi.fn(); vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 3000, height: 2000, close }));
    const drawImage = vi.fn(); const fillRect = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage, fillRect, fillStyle: '' } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback, type) => callback(new Blob(['optimized'], { type: String(type) })));
    const result = await optimizeProductImage(new File(['large'], 'foto.png', { type: 'image/png' }));
    expect(result.type).toBe('image/jpeg'); expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 1400, 933); expect(close).toHaveBeenCalled();
    const canvas = document.querySelector('canvas'); expect(canvas).toBeNull();
    expect(PRODUCT_IMAGE_MAX_DIMENSION).toBe(1400);
  });

  it('rechaza archivos que no son imágenes compatibles', async () => {
    await expect(optimizeProductImage(new File(['text'], 'archivo.txt', { type: 'text/plain' }))).rejects.toThrow('JPEG, PNG o WebP');
  });
});
