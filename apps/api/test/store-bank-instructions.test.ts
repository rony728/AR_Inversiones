import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readApprovedBankAccounts, receiptBankAccounts } from '../src/modules/store-orders/bank-instructions.js';

const config={
  schemaVersion:1,status:'VERIFIED',productionAuthorized:true,checkoutEnabled:true,
  bankAccountPublicationAuthorized:true,paymentInstructionTiming:'AFTER_ORDER_SUBMISSION',
  bankAccounts:[
    {bank:'BANCO_ATLANTIDA',holder:'Titular Ejemplo Uno',accountType:'AHORRO',currency:'HNL',accountNumber:'123456789'},
    {bank:'BANCO_ATLANTIDA',holder:'Titular Ejemplo Dos',accountType:'AHORRO',currency:'HNL',accountNumber:'123456788'},
    {bank:'BANCO_ATLANTIDA',holder:'Titular Ejemplo Tres',accountType:'AHORRO',currency:'HNL',accountNumber:'123456787'},
    {bank:'BANCO_FICOHSA',holder:'Titular Ejemplo Dos',accountType:'AHORRO',currency:'HNL',accountNumber:'123456786'},
    {bank:'BAC_CREDOMATIC',holder:'Titular Ejemplo Dos',accountType:'AHORRO',currency:'HNL',accountNumber:'123456785'},
  ],
};
function withConfig(data:unknown,callback:(path:string)=>void, mode=0o600) {
  const dir=mkdtempSync(join(tmpdir(),'ar-payment-'));
  const path=join(dir,'accounts.json');
  try { writeFileSync(path,JSON.stringify(data),{mode:0o600});chmodSync(path,mode);callback(path); }
  finally { rmSync(dir,{recursive:true,force:true}); }
}
test('devuelve instrucciones solo tras crear pedido bancario y aprobar ambas puertas', () => {
  withConfig(config, path=>{
    assert.equal(receiptBankAccounts('TRANSFERENCIA',true,true,true,path).length,5);
    assert.equal(receiptBankAccounts('DEPOSITO',true,true,true,path).length,5);
    for(const method of ['EFECTIVO','CONTRA_ENTREGA','ENLACE_PAGO'])
      assert.deepEqual(receiptBankAccounts(method,true,true,true,path),[]);
    assert.deepEqual(receiptBankAccounts('TRANSFERENCIA',false,true,true,path),[]);
    assert.deepEqual(receiptBankAccounts('TRANSFERENCIA',true,false,true,path),[]);
    assert.deepEqual(receiptBankAccounts('TRANSFERENCIA',true,true,false,path),[]);
  });
});
test('no lee archivo bancario si publicación desactivada',()=>{
  assert.deepEqual(readApprovedBankAccounts('/ruta/inexistente.json',false),[]);
});
test('rechaza borrador no aprobado y archivo con permisos inseguros',()=>{
  withConfig({...config,bankAccountPublicationAuthorized:false},path=>
    assert.throws(()=>readApprovedBankAccounts(path,true),/sin autorización/));
  withConfig(config,path=>assert.throws(()=>readApprovedBankAccounts(path,true),/0600/),0o644);
});
test('rechaza cuentas duplicadas sin revelar números en los errores',()=>{
  const duplicate=structuredClone(config);
  duplicate.bankAccounts[1].accountNumber=duplicate.bankAccounts[0].accountNumber;
  withConfig(duplicate,path=>{
    assert.throws(()=>readApprovedBankAccounts(path,true),/duplicada/);
    try{readApprovedBankAccounts(path,true)}catch(error){
      assert.ok(!String(error).includes(duplicate.bankAccounts[0].accountNumber));
    }
  });
});
