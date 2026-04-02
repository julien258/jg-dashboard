// gmail-sync.js — v2 — statuts, blacklist, contacts appris
const OAUTH_URL  = 'https://oauth2.googleapis.com/token';
const GMAIL_API  = 'https://gmail.googleapis.com/gmail/v1/users/me';
const SB_URL     = process.env.SUPABASE_URL;
const SB_KEY     = process.env.SUPABASE_SERVICE_KEY;

const ACCOUNT_MAP = {
  'sas-living':   { token: 'GMAIL_TOKEN_LIVING',   email: 'julien@sas-living.com' },
  'sarl-guiraud': { token: 'GMAIL_TOKEN_SARL',     email: 'jguiraudeurl@gmail.com' },
  'meulette':     { token: 'GMAIL_TOKEN_MEULETTE', email: 'sarllameulette@gmail.com' },
  'real-gains':   { token: 'GMAIL_TOKEN_MONIKAZA', email: 'julien.guiraud@monikaza.com' },
  'perso':        { token: 'GOOGLE_REFRESH_TOKEN', email: 'jguiraud.rca@gmail.com' },
};

const SENDER_TAGS = {
  'urssaf':      { tag:'👥 URSSAF',          priority:'high',   type_contact:'admin' },
  'dgfip':       { tag:'🏛️ DGFiP',          priority:'high',   type_contact:'admin' },
  'impots.gouv': { tag:'🏛️ Impôts',         priority:'high',   type_contact:'admin' },
  'tggv':        { tag:'⚖️ Huissier',        priority:'high',   type_contact:'huissier' },
  'huissier':    { tag:'⚖️ Huissier',        priority:'high',   type_contact:'huissier' },
  'recci':       { tag:'⚖️ Avocat',          priority:'high',   type_contact:'avocat' },
  'avocat':      { tag:'⚖️ Avocat',          priority:'high',   type_contact:'avocat' },
  'karsenty':    { tag:'⚖️ Avocat adv.',     priority:'high',   type_contact:'avocat' },
  'decker':      { tag:'⚖️ Avocat adv.',     priority:'high',   type_contact:'avocat' },
  'financo':     { tag:'🏦 Financo',         priority:'high',   type_contact:'banque' },
  'synergie':    { tag:'⚠️ Recouvrement',    priority:'high',   type_contact:'huissier' },
  'waterlot':    { tag:'⚠️ Recouvrement',    priority:'high',   type_contact:'huissier' },
  'carrefour':   { tag:'🛒 Carrefour',       priority:'high',   type_contact:'client' },
  'cgw':         { tag:'💼 CGW',             priority:'normal', type_contact:'client' },
  '451f':        { tag:'📊 Comptable',       priority:'normal', type_contact:'comptable' },
  'velomotion':  { tag:'🚗 Velomotion',      priority:'normal', type_contact:'client' },
  'leasecom':    { tag:'🚗 Leasecom',        priority:'normal', type_contact:'client' },
  'bpifrance':   { tag:'🏦 BPI',            priority:'normal', type_contact:'banque' },
  'pecastaing':  { tag:'⚖️ Huissier',       priority:'high',   type_contact:'huissier' },
};

// ── Supabase helpers ──────────────────────────────────────────────────────────
const sbHeaders = () => ({ apikey:SB_KEY, Authorization:`Bearer ${SB_KEY}`, 'Content-Type':'application/json' });

async function sbGet(table, qs=''){
  if(!SB_URL||!SB_KEY)return[];
  try{
    const r=await fetch(`${SB_URL}/rest/v1/${table}${qs}`,{headers:sbHeaders()});
    return r.ok?await r.json():[];
  }catch{return[];}
}

async function sbUpsert(table,data,conflict){
  if(!SB_URL||!SB_KEY||!data)return;
  try{
    await fetch(`${SB_URL}/rest/v1/${table}?on_conflict=${conflict}`,{
      method:'POST',
      headers:{...sbHeaders(),'Prefer':'resolution=merge-duplicates,return=minimal'},
      body:JSON.stringify(data)
    });
  }catch{}
}

async function sbPatch(table,qs,data){
  if(!SB_URL||!SB_KEY)return;
  try{
    await fetch(`${SB_URL}/rest/v1/${table}?${qs}`,{
      method:'PATCH',
      headers:{...sbHeaders(),'Prefer':'return=minimal'},
      body:JSON.stringify(data)
    });
  }catch{}
}

// ── Blacklist ─────────────────────────────────────────────────────────────────
async function loadBlacklist(){
  return sbGet('mail_blacklist','?select=pattern,type_pattern');
}

function isBlacklisted(from,blacklist){
  const f=(from||'').toLowerCase();
  return blacklist.some(b=>{
    const p=b.pattern.toLowerCase();
    if(b.type_pattern==='email')return f.includes('<'+p+'>')||f===p;
    if(b.type_pattern==='domain')return f.includes('@'+p)||f.includes('.'+p);
    if(b.type_pattern==='keyword')return f.includes(p);
    return false;
  });
}

// ── Contacts ──────────────────────────────────────────────────────────────────
function parseEmail(from){
  const m=(from||'').match(/<([^>]+)>/);
  const email=(m?m[1]:from||'').toLowerCase().trim();
  const nom=(from||'').replace(/<[^>]+>/,'').replace(/"/g,'').trim();
  const domain=email.includes('@')?email.split('@')[1]:'';
  return{email,nom,domain};
}

function classifySender(from){
  const f=(from||'').toLowerCase();
  for(const[k,v]of Object.entries(SENDER_TAGS)){if(f.includes(k))return v;}
  return{tag:'📧 Autre',priority:'normal',type_contact:'autre'};
}

async function upsertContacts(messages){
  const rows=messages.map(m=>{
    const{email,nom,domain}=parseEmail(m.from);
    const cls=classifySender(m.from);
    if(!email||!email.includes('@'))return null;
    return{email,nom,domain,type_contact:cls.type_contact,nb_mails:1,updated_at:new Date().toISOString()};
  }).filter(Boolean);
  if(rows.length)await sbUpsert('mail_contacts',rows,'email');
}

async function loadContacts(emails){
  if(!emails.length)return{};
  const list=emails.map(e=>`"${e}"`).join(',');
  const data=await sbGet('mail_contacts',`?email=in.(${list})&select=email,nom,type_contact,societe_liee,dossier_lie,priorite`);
  const map={};(data||[]).forEach(c=>{map[c.email]=c;});
  return map;
}

async function loadStatuts(messageIds){
  if(!messageIds.length)return{};
  const list=messageIds.map(id=>`"${id}"`).join(',');
  const data=await sbGet('mail_statuts',`?message_id=in.(${list})&select=message_id,statut,dossier,notes`);
  const map={};(data||[]).forEach(s=>{map[s.message_id]=s;});
  return map;
}

// ── Urgence avancée ───────────────────────────────────────────────────────────
function detectUrgence(from,subject,snippet){
  const txt=[(from||''),(subject||''),(snippet||'')].join(' ').toLowerCase();
  if(txt.match(/huissier|recouvrement|saisie|injonction|commandement de payer/))return true;
  if(txt.match(/r[eé]pondre avant le|r[eé]ponse sous|sous huitaine|mise en demeure/))return true;
  if(txt.match(/urssaf|dgfip|impôts|tggv|pecastaing|synergie|waterlot/))return true;
  return false;
}

// ── OAuth ─────────────────────────────────────────────────────────────────────
async function getAccessToken(societe){
  const account=ACCOUNT_MAP[societe];
  if(!account)throw new Error(`Société inconnue : ${societe}`);
  const refreshToken=process.env[account.token];
  if(!refreshToken)throw new Error(`Token manquant pour ${societe} (${account.token})`);
  const candidates=[
    {id:process.env.GMAIL_CLIENT_ID,   secret:process.env.GMAIL_CLIENT_SECRET},
    {id:process.env.GOOGLE_CLIENT_ID,  secret:process.env.GOOGLE_CLIENT_SECRET},
  ].filter(c=>c.id&&c.secret);
  for(const cred of candidates){
    const r=await fetch(OAUTH_URL,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
      body:new URLSearchParams({client_id:cred.id,client_secret:cred.secret,refresh_token:refreshToken,grant_type:'refresh_token'})});
    const d=await r.json();
    if(d.access_token)return d.access_token;
  }
  throw new Error('Token Google invalide : aucun client_id compatible');
}

async function gmailGet(token,endpoint){
  const r=await fetch(`${GMAIL_API}${endpoint}`,{headers:{Authorization:`Bearer ${token}`}});
  if(!r.ok){const e=await r.text();throw new Error(`Gmail API ${r.status}: ${e.substring(0,200)}`);}
  return r.json();
}

async function gmailPost(token,endpoint,body){
  const r=await fetch(`${GMAIL_API}${endpoint}`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
  if(!r.ok){const e=await r.text();throw new Error(`Gmail POST ${r.status}: ${e.substring(0,200)}`);}
  return r.json();
}

function decodeBase64(s){return Buffer.from(s.replace(/-/g,'+').replace(/_/g,'/'),'base64').toString('utf-8');}

function extractBody(payload){
  if(!payload)return'';
  if(payload.body?.data)return decodeBase64(payload.body.data);
  if(payload.parts){
    for(const p of payload.parts){if(p.mimeType==='text/plain'&&p.body?.data)return decodeBase64(p.body.data);}
    for(const p of payload.parts){if(p.mimeType==='text/html'&&p.body?.data)return decodeBase64(p.body.data).replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();}
  }
  return'';
}

function extractAttachments(payload){
  const atts=[];
  function scan(parts){if(!parts)return;for(const p of parts){if(p.filename&&p.body?.attachmentId)atts.push({id:p.body.attachmentId,name:p.filename,mimeType:p.mimeType,size:p.body.size});if(p.parts)scan(p.parts);}}
  scan(payload?.parts);return atts;
}

// ── listMessages enrichi ──────────────────────────────────────────────────────
async function listMessages(accessToken,maxResults=30,query=''){
  const blacklist=await loadBlacklist();
  const q=encodeURIComponent(`is:unread -in:spam -in:promotions -in:trash after:2026/03/01 ${query}`.trim());
  const data=await gmailGet(accessToken,`/messages?maxResults=${maxResults}&q=${q}`);
  const messages=data.messages||[];

  const details=await Promise.all(messages.slice(0,maxResults).map(async m=>{
    try{
      const msg=await gmailGet(accessToken,`/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`);
      const h={};(msg.payload?.headers||[]).forEach(hh=>{h[hh.name.toLowerCase()]=hh.value;});
      if(isBlacklisted(h.from||'',blacklist))return null;
      const cls=classifySender(h.from||'');
      const urgence=detectUrgence(h.from,h.subject,msg.snippet)||cls.priority==='high';
      return{id:m.id,threadId:msg.threadId,subject:h.subject||'(sans objet)',from:h.from||'',date:h.date||'',
        snippet:msg.snippet||'',unread:(msg.labelIds||[]).includes('UNREAD'),
        hasAttachment:(msg.labelIds||[]).includes('HAS_ATTACHMENT')||msg.payload?.parts?.some(p=>p.filename),
        priority:urgence?'high':'normal',tag:cls.tag,type_contact:cls.type_contact};
    }catch{return null;}
  }));

  const valid=details.filter(Boolean);
  valid.sort((a,b)=>{if(a.priority==='high'&&b.priority!=='high')return-1;if(b.priority==='high'&&a.priority!=='high')return 1;return 0;});

  // Apprentissage contacts (fire & forget)
  upsertContacts(valid).catch(()=>{});

  // Charger statuts et contacts connus
  const msgIds=valid.map(m=>m.id);
  const emails=valid.map(m=>parseEmail(m.from).email).filter(Boolean);
  const[statuts,contacts]=await Promise.all([loadStatuts(msgIds),loadContacts(emails)]);

  return valid.map(m=>{
    const{email}=parseEmail(m.from);
    const statut=statuts[m.id]||{statut:'a_traiter',dossier:null,notes:null};
    const contact=contacts[email]||null;
    return{...m,statut:statut.statut,dossier:statut.dossier,notes:statut.notes,
      contact_type:contact?.type_contact||m.type_contact,contact_dossier:contact?.dossier_lie||null,
      contact_societe:contact?.societe_liee||null};
  });
}

// ── getThread ─────────────────────────────────────────────────────────────────
async function getThread(token,threadId){
  const data=await gmailGet(token,`/threads/${threadId}?format=full`);
  return(data.messages||[]).map(msg=>{
    const h={};(msg.payload?.headers||[]).forEach(hh=>{h[hh.name.toLowerCase()]=hh.value;});
    return{id:msg.id,from:h.from||'',to:h.to||'',subject:h.subject||'',date:h.date||'',
      body:extractBody(msg.payload).substring(0,3000),attachments:extractAttachments(msg.payload),
      messageId:h['message-id']||'',references:h.references||''};
  });
}

async function getAttachment(token,messageId,attachmentId){
  const d=await gmailGet(token,`/messages/${messageId}/attachments/${attachmentId}`);return d.data;
}

function buildMimeMessage({from,to,subject,body,inReplyTo,references}){
  const lines=[`From: ${from}`,`To: ${to}`,`Subject: ${subject}`,'MIME-Version: 1.0','Content-Type: text/plain; charset=UTF-8','Content-Transfer-Encoding: quoted-printable'];
  if(inReplyTo)lines.push(`In-Reply-To: ${inReplyTo}`);
  if(references)lines.push(`References: ${references}`);
  lines.push('',body);
  return Buffer.from(lines.join('\r\n')).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}

// ── Handler ───────────────────────────────────────────────────────────────────
export default async(req)=>{
  const H={'Content-Type':'application/json'};
  if(req.method==='OPTIONS')return new Response('',{status:200,headers:H});

  try{
    const url=new URL(req.url);
    const societe=url.searchParams.get('societe')||'sas-living';
    const action=url.searchParams.get('action')||'list';

    // Actions sans token Gmail
    if(req.method==='POST'){
      const body=await req.json();

      if(body.action==='set_statut'){
        await sbUpsert('mail_statuts',{
          message_id:body.messageId,thread_id:body.threadId,societe:body.societe,
          subject:body.subject,from_email:body.fromEmail,from_name:body.fromName,
          statut:body.statut,dossier:body.dossier||null,notes:body.notes||null,
          updated_at:new Date().toISOString()
        },'message_id');
        return new Response(JSON.stringify({ok:true}),{headers:H});
      }

      if(body.action==='blacklist'){
        await sbUpsert('mail_blacklist',{pattern:body.pattern,type_pattern:body.type_pattern||'email',raison:body.raison||null},'pattern');
        return new Response(JSON.stringify({ok:true}),{headers:H});
      }

      if(body.action==='update_contact'){
        await sbPatch('mail_contacts',`email=eq.${encodeURIComponent(body.email)}`,{
          type_contact:body.type_contact,societe_liee:body.societe_liee||null,
          dossier_lie:body.dossier_lie||null,updated_at:new Date().toISOString()
        });
        return new Response(JSON.stringify({ok:true}),{headers:H});
      }
    }

    if(action==='get_contacts'){
      const search=url.searchParams.get('q')||'';
      const qs=search?`?or=(email.ilike.*${search}*,nom.ilike.*${search}*)&order=nb_mails.desc&limit=50`:'?order=nb_mails.desc&limit=100';
      const data=await sbGet('mail_contacts',qs);
      return new Response(JSON.stringify({ok:true,contacts:data}),{headers:H});
    }

    // Actions avec token Gmail
    const account=ACCOUNT_MAP[societe];
    if(!account)return new Response(JSON.stringify({ok:false,error:`Société inconnue : ${societe}`,messages:[]}),{headers:H});
    if(!process.env[account.token])return new Response(JSON.stringify({ok:false,error:`Token Gmail manquant pour ${societe}`,messages:[]}),{headers:H});

    const token=await getAccessToken(societe);

    if(req.method==='GET'){
      if(action==='list'){
        const max=parseInt(url.searchParams.get('max')||'30');
        const q=url.searchParams.get('q')||'';
        const messages=await listMessages(token,max,q);
        return new Response(JSON.stringify({ok:true,societe,email:account.email,messages}),{headers:H});
      }
      if(action==='thread'){
        const threadId=url.searchParams.get('threadId');
        if(!threadId)return new Response(JSON.stringify({error:'threadId requis'}),{status:400,headers:H});
        const thread=await getThread(token,threadId);
        return new Response(JSON.stringify({ok:true,thread}),{headers:H});
      }
      if(action==='attachment'){
        const messageId=url.searchParams.get('messageId');
        const attachmentId=url.searchParams.get('attachmentId');
        if(!messageId||!attachmentId)return new Response(JSON.stringify({error:'messageId et attachmentId requis'}),{status:400,headers:H});
        const base64=await getAttachment(token,messageId,attachmentId);
        return new Response(JSON.stringify({ok:true,base64}),{headers:H});
      }
    }

    if(req.method==='POST'){
      const body=await req.json();
      if(body.action==='draft'){
        const raw=buildMimeMessage({from:account.email,to:body.to,subject:body.subject,body:body.body,inReplyTo:body.inReplyTo,references:body.references});
        const draft=await gmailPost(token,'/drafts',{message:{raw}});
        return new Response(JSON.stringify({ok:true,draftId:draft.id}),{headers:H});
      }
      if(body.action==='read'){
        await fetch(`${GMAIL_API}/messages/${body.messageId}/modify`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({removeLabelIds:['UNREAD']})});
        return new Response(JSON.stringify({ok:true}),{headers:H});
      }
      if(body.action==='ged'){
        const base64=await getAttachment(token,body.messageId,body.attachmentId);
        return new Response(JSON.stringify({ok:true,base64,fileName:body.fileName}),{headers:H});
      }
    }

    return new Response(JSON.stringify({error:'Action inconnue'}),{status:400,headers:H});
  }catch(e){
    return new Response(JSON.stringify({error:e.message}),{status:500,headers:H});
  }
};

export const config={path:'/api/gmail-sync'};
