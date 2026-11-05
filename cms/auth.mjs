export const SESSION_SECONDS=12*60*60;
const encoder=new TextEncoder();
export const hex=bytes=>Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
export const randomToken=()=>hex(crypto.getRandomValues(new Uint8Array(32)));
export const digest=async value=>hex(await crypto.subtle.digest('SHA-256',encoder.encode(value)));
export function equal(a,b){if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0;}
export function validPassword(password){return typeof password==='string'&&password.length>=14&&password.length<=256;}
export async function passwordHash(password,salt){
 const key=await crypto.subtle.importKey('raw',encoder.encode(password),'PBKDF2',false,['deriveBits']);
 return hex(await crypto.subtle.deriveBits({name:'PBKDF2',salt:encoder.encode(salt),iterations:100000,hash:'SHA-256'},key,256));
}
export function cookie(token,maxAge=SESSION_SECONDS){return `__Host-hiroba_session=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;}
export async function session(request,db){
 const token=request.headers.get('cookie')?.split(';').map(v=>v.trim()).find(v=>v.startsWith('__Host-hiroba_session='))?.split('=')[1];
 if(!token||!/^\w{64}$/.test(token))return null;
 const hash=await digest(token);
 return db.prepare('SELECT token_hash,csrf,expires FROM sessions WHERE token_hash=? AND expires>?').bind(hash,Math.floor(Date.now()/1000)).first();
}
export async function newSession(db){
 const token=randomToken(),csrf=randomToken(),now=Math.floor(Date.now()/1000);
 await db.batch([
  db.prepare('DELETE FROM sessions WHERE expires<=?').bind(now),
  db.prepare('INSERT INTO sessions(token_hash,csrf,expires) VALUES(?,?,?)').bind(await digest(token),csrf,now+SESSION_SECONDS),
 ]);
 return {token,csrf};
}
export async function rateLimit(request,db){
 const now=Math.floor(Date.now()/1000),window=Math.floor(now/900);
 const ip=request.headers.get('CF-Connecting-IP')||'local';
 const key=await digest(ip);
 const buckets=[`ip:${key}:${window}`,`all:${window}`];
 const results=await db.batch([
  db.prepare('DELETE FROM login_limits WHERE expires<?').bind(now),
  ...buckets.map(bucket=>db.prepare('INSERT INTO login_limits(bucket,attempts,expires) VALUES(?,1,?) ON CONFLICT(bucket) DO UPDATE SET attempts=attempts+1 RETURNING attempts').bind(bucket,now+1800)),
 ]);
 return results[1].results[0].attempts<=10&&results[2].results[0].attempts<=100;
}
