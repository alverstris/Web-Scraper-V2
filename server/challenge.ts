/** Server-side challenge verification complements identity and atomic entitlement accounting. */
export async function validateChallenge(token:string,http:typeof fetch=fetch):Promise<boolean>{
 const secret=process.env.TURNSTILE_SECRET;
 const allowed=(process.env.TURNSTILE_ALLOWED_HOSTNAMES??'').split(',').map(v=>v.trim().toLowerCase()).filter(Boolean);
 if(!secret||!allowed.length||!token||token.length>2048)return false;
 try{
  const response=await http('https://challenges.cloudflare.com/turnstile/v0/siteverify',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({secret,response:token}),signal:AbortSignal.timeout(10000),redirect:'error'});
  if(!response.ok)return false;
  const result=await response.json() as {success?:boolean;action?:string;hostname?:string;challenge_ts?:string};
  const timestamp=Date.parse(result.challenge_ts??'');
  return result.success===true&&result.action==='custom-run'&&allowed.includes((result.hostname??'').toLowerCase())&&Number.isFinite(timestamp)&&timestamp<=Date.now()+30000&&timestamp>=Date.now()-300000;
 }catch{return false}
}
