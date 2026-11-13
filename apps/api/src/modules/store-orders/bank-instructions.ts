import { readFileSync, statSync } from 'node:fs';
import { z } from 'zod';

const bankAccount = z.object({
  bank:z.enum(['BANCO_ATLANTIDA','BANCO_FICOHSA','BAC_CREDOMATIC']),
  holder:z.string().trim().min(5).max(140),
  accountType:z.literal('AHORRO'),
  currency:z.literal('HNL'),
  accountNumber:z.string().regex(/^[0-9]{6,24}$/),
}).strict();
const paymentConfig = z.object({
  schemaVersion:z.literal(1),
  status:z.enum(['DRAFT_UNVERIFIED','VERIFIED']),
  productionAuthorized:z.boolean(),
  checkoutEnabled:z.boolean(),
  bankAccountPublicationAuthorized:z.boolean(),
  paymentInstructionTiming:z.literal('AFTER_ORDER_SUBMISSION'),
  bankAccounts:z.array(bankAccount).length(5),
}).passthrough();

export type StoreBankAccount = {
  bank: z.infer<typeof bankAccount>['bank'];
  holder:string;
  accountType:'AHORRO';
  currency:'HNL';
  accountNumber:string;
};

export function readApprovedBankAccounts(filePath: string, allowPublishing: boolean): StoreBankAccount[] {
  // No se entrega información bancaria por endpoints de catálogo ni checkout-config.
  // Hay dos aprobaciones independientes: variable de entorno + archivo privado aprobado.
  if (!allowPublishing) return [];
  if (!filePath || !filePath.startsWith('/')) throw new Error('Ruta privada de cuentas no configurada.');
  const stats=statSync(filePath);
  if (!stats.isFile() || (stats.mode & 0o077) !== 0) {
    throw new Error('El archivo bancario debe ser privado (0600).');
  }
  const raw = paymentConfig.parse(JSON.parse(readFileSync(filePath,'utf8')));
  if (raw.status !== 'VERIFIED' || !raw.productionAuthorized ||
      !raw.checkoutEnabled || !raw.bankAccountPublicationAuthorized) {
    throw new Error('Datos bancarios sin autorización comercial de publicación.');
  }
  const keys=new Set<string>();
  for (const account of raw.bankAccounts) {
    const key=account.bank+':'+account.accountNumber;
    if (keys.has(key)) throw new Error('Se detectó una cuenta bancaria duplicada.');
    keys.add(key);
  }
  return raw.bankAccounts;
}

export function receiptBankAccounts(
  paymentMethod:string,
  isNewOrder:boolean,
  checkoutEnabled:boolean,
  publicationEnabled:boolean,
  filePath?:string,
): StoreBankAccount[] {
  if (!isNewOrder || !checkoutEnabled || !['TRANSFERENCIA','DEPOSITO'].includes(paymentMethod) ||
      !publicationEnabled) return [];
  return readApprovedBankAccounts(filePath ?? '',true);
}
