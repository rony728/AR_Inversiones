import { createHash } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { z } from 'zod';

const proofInputSchema=z.object({
  token:z.string().min(30).max(2000),
  fileName:z.string().trim().min(1).max(140),
  mimeType:z.enum(['image/jpeg','image/png']),
  dataBase64:z.string().min(100).max(820000),
}).strict();

const paymentMethods=new Set(['TRANSFERENCIA','DEPOSITO','ENLACE_PAGO','CONTRA_ENTREGA']);
const MAX_BYTES=614400;

export type PaymentProofInput=z.infer<typeof proofInputSchema>;
export function createProofToken(orderId:string,reference:string,secret:string):string {
  return jwt.sign({orderId,reference,purpose:'PAYMENT_PROOF'},secret,
    {algorithm:'HS256',audience:'ar-store-proof',issuer:'ar-store',expiresIn:'48h'});
}
export function validateProofToken(token:string,orderId:string,reference:string,secret:string):boolean {
  try {
    const payload=jwt.verify(token,secret,{algorithms:['HS256'],
      audience:'ar-store-proof',issuer:'ar-store'});
    return typeof payload==='object' && payload.purpose==='PAYMENT_PROOF' &&
      payload.orderId===orderId && payload.reference===reference;
  } catch {return false;}
}
export function parseProofUpload(payload:unknown) {
  const parsed=proofInputSchema.parse(payload);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(parsed.dataBase64) ||
      parsed.dataBase64.length%4!==0) throw new Error('Archivo mal codificado.');
  const content=Buffer.from(parsed.dataBase64,'base64');
  if (content.length<100 || content.length>MAX_BYTES ||
      content.toString('base64')!==parsed.dataBase64) throw new Error('Tamaño o codificación inválidos.');
  const jpeg=content[0]===0xff && content[1]===0xd8 && content[2]===0xff;
  const png=content.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  if (parsed.mimeType==='image/jpeg' && !jpeg) throw new Error('Contenido JPEG inválido.');
  if (parsed.mimeType==='image/png' && !png) throw new Error('Contenido PNG inválido.');
  const extension=parsed.mimeType==='image/jpeg'?'jpg':'png';
  return {
    token:parsed.token,content,mimeType:parsed.mimeType,
    fileName:'comprobante.'+extension,
    sha256:createHash('sha256').update(content).digest('hex'),
  };
}
export function canUploadProof(method:string,state:string):boolean {
  return paymentMethods.has(method) && ['PENDIENTE','CONFIRMADO'].includes(state);
}
