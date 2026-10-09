import assert from 'node:assert/strict';
import {test} from 'node:test';
import '../packages/core/src/env';
import {randomUUID} from 'node:crypto';
import {Prisma} from '@prisma/client';
import {loadLotMaterials} from '../apps/etl/src/lot-history';
import {db} from '../apps/etl/src/loader';
test('Material imports reject outside lots, invalid sequences and colliding keys',async()=>{
const row={SOURCE_KEY:'LOT1:1',LOT_NO:'LOT1',SEQ_NO:1,ITEM_NO:'ITEM1'};
await assert.rejects(loadLotMaterials('2','1',[row],'full',new Set(['LOT2']),true),/outside/);
await assert.rejects(loadLotMaterials('2','1',[{...row,SEQ_NO:null}],'full',new Set(['LOT1']),true));
await assert.rejects(loadLotMaterials('2','1',[row,{...row,ITEM_NO:'ITEM2'}],'full',new Set(['LOT1']),true),/different material/);
assert.equal((await loadLotMaterials('2','1',[row],'full',new Set(['LOT1']),true)).stored,1);
});
test('Material storage upserts corrections, preserves nulls and leaves delta records immutable',{skip:process.env.RUN_INTEGRATION!=='true'},async()=>{
const parent=await db.lotRegistry.findFirstOrThrow({where:{assemblySource:'1'}});
const key='integration-material-'+randomUUID();
const row={SOURCE_KEY:key,LOT_NO:parent.lotNo,SEQ_NO:1,ITEM_GROUP:null,SIZE_TYPE:'SMALL',ITEM_NO:'ITEM1',ITEM_LOT_NO:'MATLOT1'};
const allowed=new Set([parent.lotNo]);
try{
await loadLotMaterials('integration','1',[row],'full',allowed);
await loadLotMaterials('integration','1',[{...row,ITEM_LOT_NO:'MATLOT2'}],'delta',allowed);
let records=await db.$queryRaw<any[]>(Prisma.sql`SELECT * FROM fact_lot_material WHERE source='integration' AND source_key=${key}`);
assert.equal(records.length,1);assert.equal(records[0].item_lot_no,'MATLOT1');assert.equal(records[0].item_group,null);
await loadLotMaterials('integration','1',[{...row,ITEM_LOT_NO:'MATLOT2'}],'full',allowed);
records=await db.$queryRaw<any[]>(Prisma.sql`SELECT * FROM fact_lot_material WHERE source='integration' AND source_key=${key}`);
assert.equal(records.length,1);assert.equal(records[0].item_lot_no,'MATLOT2');assert.equal(records[0].raw_payload.SIZE_TYPE,'SMALL');
}finally{await db.$executeRaw(Prisma.sql`DELETE FROM fact_lot_material WHERE source='integration' AND source_key=${key}`)}
});
