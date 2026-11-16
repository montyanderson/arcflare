const encoder=new TextEncoder();
const hex=bytes=>Array.from(new Uint8Array(bytes),n=>n.toString(16).padStart(2,'0')).join('');
export async function sha1(password){return hex(await crypto.subtle.digest('SHA-1',encoder.encode(password)));}
// Match the output of the openssl subprocess used by official app.arc.
export async function arcPasswordHash(password){return 'SHA1(stdin)= '+await sha1(password);}
export async function hashPassword(password,salt=hex(crypto.getRandomValues(new Uint8Array(24)))){
  const key=await crypto.subtle.importKey('raw',encoder.encode(password),'PBKDF2',false,['deriveBits']);
  const digest=await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',iterations:100000,salt:encoder.encode(salt)},key,256);
  return `pbkdf2-sha256$100000$${salt}$${hex(digest)}`;
}
function equal(a,b){let mismatch=a.length^b.length;for(let i=0;i<a.length;i++)mismatch|=a.charCodeAt(i)^(b.charCodeAt(i)||0);return mismatch===0;}
export async function verifyPassword(password,stored){
  if(typeof password!=='string'||typeof stored!=='string')return false;
  const parts=stored.split('$');
  if(parts.length===4&&parts[0]==='pbkdf2-sha256'&&parts[1]==='100000')return equal(await hashPassword(password,parts[2]),stored);
  // Arc's shash stored the output of openssl dgst, including its prefix.
  const legacy=stored.match(/^(?:(?:SHA1|SHA-1|\(stdin\))[^=]*=\s*)?([a-f0-9]{40})$/i);
  return !!legacy&&equal(await sha1(password),legacy[1].toLowerCase());
}
