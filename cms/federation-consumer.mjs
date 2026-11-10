import {buildFederation,deliverPublication,flushPublications,ORIGIN} from './federation.mjs';
import {WorkersMessageQueue} from '@fedify/cfworkers';

export default {
 async scheduled(_controller,env){await flushPublications(env);},
 async queue(batch,env){
  const federation=await buildFederation(env);
  const ctx=federation.createContext(new URL(ORIGIN),env);
  const queue=new WorkersMessageQueue(env.FEDERATION_QUEUE);
  for(const message of batch.messages){
   let processed;
   try{
    // The adapter wraps payloads even when no ordering key is configured.
    processed=await queue.processMessage(message.body);
    if(!processed.shouldProcess){message.retry();continue;}
    const body=processed.message;
    if(body.type==='hiroba:publication')await deliverPublication(ctx,body);
    else if(['inbox','outbox','fanout','task'].includes(body.type))await federation.processQueuedTask(env,body);
    else throw new Error('Unknown federation queue message');
    message.ack();
   }catch(error){
    console.error('Federation delivery failed',error?.name);
    if(message.attempts>=8){
     // Keep failed jobs durably for inspection/replay without logging private data.
     await env.DB.prepare('INSERT OR IGNORE INTO ap_failures(id,message,failed_at) VALUES(?,?,?)')
      .bind(message.id,JSON.stringify(message.body),new Date().toISOString()).run();
     message.ack();
    }else message.retry({delaySeconds:Math.min(10800,60*3**(message.attempts-1))});
   }finally{await processed?.release?.();}
  }
 }
};
