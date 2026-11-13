import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { canUploadProof,createProofToken,parseProofUpload,validateProofToken } from '../src/modules/store-orders/payment-proof.js';
const secret='testing-a-strong-secret-with-32-chars';
const id=randomUUID(),ref=randomUUID();
test('token está firmado, tiene propósito y no permite otros pedidos',()=>{
 const token=createProofToken(id,ref,secret);
 assert.equal(validateProofToken(token,id,ref,secret),true);
 assert.equal(validateProofToken(token,randomUUID(),ref,secret),false);
 assert.equal(validateProofToken(token,id,randomUUID(),secret),false);
 assert.equal(validateProofToken(token+'x',id,ref,secret),false);
});
test('solo acepta contenido JPEG/PNG válido, tamaño acotado y base64 canónico',()=>{
 const bytes=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.alloc(200)]);
 const input={token:'x'.repeat(32),fileName:'captura.png',mimeType:'image/png',dataBase64:bytes.toString('base64')};
 const output=parseProofUpload(input);
 assert.equal(output.content.length,208);
 assert.equal(output.fileName,'comprobante.png');
 assert.equal(output.sha256.length,64);
 assert.throws(()=>parseProofUpload({...input,mimeType:'image/jpeg'}));
 assert.throws(()=>parseProofUpload({...input,dataBase64:Buffer.alloc(614401).toString('base64')}));
 assert.throws(()=>parseProofUpload({...input,dataBase64:'A'.repeat(100)+'-'}));
});
test('solo se admite comprobante en pedidos no terminales de pago',()=>{
 assert.equal(canUploadProof('TRANSFERENCIA','PENDIENTE'),true);
 assert.equal(canUploadProof('DEPOSITO','CONFIRMADO'),true);
 assert.equal(canUploadProof('EFECTIVO','PENDIENTE'),false);
 assert.equal(canUploadProof('TRANSFERENCIA','CANCELADO'),false);
});
