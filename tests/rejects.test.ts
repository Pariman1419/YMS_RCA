import assert from 'node:assert/strict';
import {test} from 'node:test';
import '../packages/core/src/env';
import {randomUUID} from 'node:crypto';
import {db} from '../apps/etl/src/loader';
import {loadLotHistory} from '../apps/etl/src/lot-history';
test('Reject storage updates quantities and preserves operation and external reject fields',{skip:process.env.RUN_INTEGRATION!=='true'},async()=>{
const parent=await db.lotRegistry.findFirstOrThrow({where:{assemblySource:'1'}}),key='reject-test-'+randomUUID(),name='reject-process-'+randomUUID();
const row={SOURCE_KEY:key,LOT_NO:parent.lotNo,PROCESS_NAME:name,MACHINE_ID:'UNASSIGNED',OPERATION_SEQUENCE:4,OPERATION_CODE:'WB',WIP_OPTN_CODE:'WB1',PROCESS_AREA_CODE:'ASSY',DEFECT_CODE:'R1',DEFECT_DESCRIPTION:'Wire lift',QTY:3,REWORK_QTY:2,EXT_REJ_CODE:'EXT1',EXT_REJ_DESC:'External wire lift'};
try{await loadLotHistory('integration','1','FACT_LOT_DEFECT',[row],'full',new Set([parent.lotNo]));
let d=await db.lotDefect.findFirstOrThrow({where:{source:'integration',sourceKey:key}});assert.equal(d.qty,3n);assert.equal(d.reworkQty,2n);assert.equal(d.operationSequence?.toNumber(),4);assert.equal((d.rawPayload as any).EXT_REJ_DESC,'External wire lift');assert.equal(d.qualityStatus,'valid');
await loadLotHistory('integration','1','FACT_LOT_DEFECT',[{...row,QTY:5,REWORK_QTY:1}],'full',new Set([parent.lotNo]));d=await db.lotDefect.findFirstOrThrow({where:{source:'integration',sourceKey:key}});assert.equal(d.qty,5n);assert.equal(d.reworkQty,1n);assert.equal(await db.lotDefect.count({where:{source:'integration',sourceKey:key}}),1);
const validation=await loadLotHistory('integration','1','FACT_LOT_DEFECT',[{...row,QTY:null}],'full',new Set([parent.lotNo]),true);assert.equal(validation.invalid,1);
}finally{await db.lotDefect.deleteMany({where:{source:'integration',sourceKey:key}});await db.process.deleteMany({where:{name}});}
});
