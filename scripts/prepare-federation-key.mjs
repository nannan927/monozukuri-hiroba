// Creates a private SQL provisioning file, never prints keys. INSERT OR IGNORE
// protects an established identity if this is accidentally run again.
import {mkdirSync,writeFileSync,existsSync} from 'node:fs';
import {generateCryptoKeyPair} from '@fedify/fedify';
const file='.admin-private/federation-key.sql';
if(existsSync(file))throw new Error('Provisioning file already exists; do not overwrite identity keys.');
const pair=await generateCryptoKeyPair('RSASSA-PKCS1-v1_5');
const quote=value=>"'"+JSON.stringify(value).replaceAll("'","''")+"'";
const publicKey=await crypto.subtle.exportKey('jwk',pair.publicKey),privateKey=await crypto.subtle.exportKey('jwk',pair.privateKey);
mkdirSync('.admin-private',{recursive:true,mode:0o700});
writeFileSync(file,`INSERT OR IGNORE INTO ap_keys(id,public_jwk,private_jwk) VALUES(1,${quote(publicKey)},${quote(privateKey)});\n`,{mode:0o600,flag:'wx'});
console.log('Created private federation provisioning file. Do not commit or share it.');
