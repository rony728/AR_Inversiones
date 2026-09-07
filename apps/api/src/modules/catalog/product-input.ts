import { z } from 'zod';

const editableProductFields = {
  codigo: z.string().trim().min(1).max(80),
  nombre: z.string().trim().min(2).max(180),
  categoriaId: z.string().uuid().nullable(),
  precioVenta: z.coerce.number().min(0).max(999999999999.99),
  activo: z.boolean()
};

export const productCreateInput = z.object(editableProductFields).strict();

export const productUpdateInput = z.object({
  codigo: editableProductFields.codigo.optional(),
  nombre: editableProductFields.nombre.optional(),
  categoriaId: editableProductFields.categoriaId.optional(),
  precioVenta: editableProductFields.precioVenta.optional(),
  activo: editableProductFields.activo.optional()
}).strict().refine((value) => Object.keys(value).length > 0, 'Debe indicar al menos un campo editable.');

export const categoryCreateInput = z.object({ nombre: z.string().trim().min(2).max(120) }).strict();
export const categoryUpdateInput = z.object({
  nombre: z.string().trim().min(2).max(120).optional(),
  activo: z.boolean().optional()
}).strict().refine((value) => Object.keys(value).length > 0, 'Debe indicar al menos un campo editable.');
