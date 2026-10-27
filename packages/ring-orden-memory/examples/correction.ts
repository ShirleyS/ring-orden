import {extractCorrection,approveMemory,retrieveMemories,buildMemoryContext} from '../src/index.ts';
const candidate=extractCorrection({merchant_id:'your-merchant-id',language:'es-MX',observed_text:'abena',previous_interpretation:{product:'latte',modifier:'unresolved'},corrected_interpretation:{product:'latte',modifier:'oat_milk'},confirmed_by_customer:true});
if(!candidate)throw new Error('No confirmed correction found');
// Your authenticated merchant manager approves this record, then your database stores it.
const stored=[approveMemory(candidate)];
const relevant=retrieveMemories(stored,{merchant_id:'your-merchant-id',query:'dame un late de abena',catalog_item_ids:['latte']});
console.log(buildMemoryContext(relevant));
