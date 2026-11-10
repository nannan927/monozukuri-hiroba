import {readFileSync} from 'node:fs';
const configs=['wrangler.jsonc','wrangler.federation.jsonc'].map(file=>JSON.parse(readFileSync(file,'utf8')));
const ids=configs.map(config=>config.kv_namespaces.find(k=>k.binding==='FEDERATION_KV')?.id);
if(ids.some(id=>!id||/^0+$/.test(id))||ids[0]!==ids[1])throw new Error('Provision the federation KV namespace and set the same real ID in both Wrangler configs before deploying.');
console.log('Federation deployment bindings match.');
