const types=['FAC','MTI','LTI'];
function bad(message,status=400){const e=new Error(message);e.status=status;throw e;}
const text=(v,label,required=false,max=2000)=>{if(v==null)v='';if(typeof v!=='string'||v.trim().length>max||required&&!v.trim())bad('Enter valid '+label);return v.trim();};
const date=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
const today=()=>new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'});
function validate(b){
 if(!types.includes(b.category)||!date(b.date)||b.date>today()||!/^([01]\d|2[0-3]):[0-5]\d$/.test(b.time||''))bad('Enter classification, incident date and time');
 const out={category:b.category,date:b.date,time:b.time};
 for(const [k,label,max]of [['location','location',200],['injuredPerson','injured person',120],['description','incident description',2000],['assignedTo','responsible person',120]])out[k]=text(b[k],label,true,max);
 if(!date(b.targetDate)||b.targetDate<b.date)bad('Target date must be on/after incident date');out.targetDate=b.targetDate;
 for(const k of ['cause','correctiveAction','firstAid','attendedBy','treatment','hospitalDoctor','workRestrictions'])out[k]=text(b[k],k,false,['attendedBy','hospitalDoctor'].includes(k)?200:2000);
 for(const k of ['followUpDate','absenceStart','returnToWork']){out[k]=b[k]||'';if(out[k]&&(!date(out[k])||out[k]<b.date))bad('Invalid '+k);}
 if(out.returnToWork&&(!out.absenceStart||out.returnToWork<out.absenceStart||out.returnToWork>today()))bad('Return-to-work date must be between absence start and today');
 if(out.absenceStart&&out.absenceStart>today())bad('Absence start cannot be in the future');
 if(b.category==='FAC'&&!out.firstAid)bad('First aid details are required');
 if(b.category==='MTI'&&!out.treatment)bad('Treatment details are required');
 if(b.category==='LTI'&&!out.absenceStart)bad('Absence start is required');
 if(b.daysLost===''||b.daysLost==null)out.daysLost=null;else{const n=Number(b.daysLost);if(!Number.isInteger(n)||n<0||n>100000)bad('Lost days must be a non-negative whole number');out.daysLost=n;}
 out.lostDaysBasis=text(b.lostDaysBasis,'lost-day counting basis',out.daysLost!==null,500);
 return out;
}
function mountInjuryWorkflow(app,mongoose){
 const col=()=>mongoose.connection.collection('safety'),id=s=>{if(!mongoose.Types.ObjectId.isValid(s))bad('Invalid incident ID');return new mongoose.Types.ObjectId(s);};
 const view=r=>({...r,incidentVersion:r.incidentVersion||0,actionStatus:r.actionStatus||'Open'});
 const handle=fn=>async(req,res)=>{try{await fn(req,res);}catch(e){console.error('INJURY WORKFLOW',e);res.status(e.status||500).json({message:e.status?e.message:'Request failed. Refresh before retrying.'});}};
 app.get('/injury-incidents',handle(async(req,res)=>res.json((await col().find({category:{$in:types},indicatorType:'Lagging'}).sort({date:-1}).toArray()).map(view))));
 app.get('/injury-incidents/:id/history',handle(async(req,res)=>{const _id=id(req.params.id),row=await col().findOne({_id,category:{$in:types}});if(!row)bad('Incident not found',404);const legacy=await mongoose.connection.collection('safety_history').find({safetyId:_id}).sort({updatedAt:-1}).toArray();res.json({events:row.incidentEvents||[],legacy});}));
 app.post('/injury-incidents',handle(async(req,res)=>{const by=text(req.body.updatedBy,'your name',true,120),fields=validate(req.body),now=new Date();const row={...fields,indicatorType:'Lagging',actionStatus:'Open',incidentVersion:1,createdAt:now,updatedAt:now,updatedBy:by,incidentEvents:[{action:'Created',by,at:now,after:fields}]};const r=await col().insertOne(row);res.status(201).json(view({...row,_id:r.insertedId}));}));
 app.put('/injury-incidents/:id',handle(async(req,res)=>{
  const _id=id(req.params.id),old=await col().findOne({_id,category:{$in:types}});if(!old)bad('Incident not found',404);const version=old.incidentVersion||0;if(req.body.version!==version)bad('Incident changed. Cancel, refresh and retry.',409);
  const by=text(req.body.updatedBy,'your name',true,120),action=req.body.action,now=new Date();let changes={},note='',reviewer='';
  if(action==='edit'||action==='reclassify'){
   if((old.actionStatus||'Open')==='Closed')bad('Reopen action follow-up before editing',409);
   changes=validate(req.body);
   if(changes.category!==old.category){if(action!=='reclassify')bad('Use Change Classification');note=text(req.body.reason,'classification reason',true);reviewer=text(req.body.reviewedBy,'safety reviewer name',true,120);if(req.body.reviewConfirmed!==true)bad('Confirm safety review before changing classification');}
   else if(action==='reclassify')bad('Select a different classification');
  }else if(action==='close'){
   if(old.actionStatus==='Closed')bad('Actions are already closed',409);
   const cause=text(req.body.cause,'cause',true),correctiveAction=text(req.body.correctiveAction,'corrective action',true);note=text(req.body.closureNote,'closure verification',true);
   if(!date(req.body.closedDate)||req.body.closedDate>today()||(date(old.date)&&req.body.closedDate<old.date))bad('Enter a valid closing date');
   changes={cause,correctiveAction,actionStatus:'Closed',closedDate:req.body.closedDate,closureNote:note,closedBy:by,closedAt:now};
  }else if(action==='reopen'){
   if(old.actionStatus!=='Closed')bad('Actions are already open',409);note=text(req.body.reason,'reopen reason',true);changes={actionStatus:'Open',reopenedBy:by,reopenedAt:now};
  }else bad('Invalid action');
  const {incidentEvents,...before}=old;const result=await col().updateOne({_id,...(version?{incidentVersion:version}:{$or:[{incidentVersion:0},{incidentVersion:{$exists:false}}]})},{$set:{...changes,updatedBy:by,updatedAt:now},$inc:{incidentVersion:1},$push:{incidentEvents:{action,by,at:now,note,reviewer,before,after:{...before,...changes}}}});if(!result.modifiedCount)bad('Incident changed. Refresh and retry.',409);res.json(view(await col().findOne({_id})));
 }));
}
module.exports={mountInjuryWorkflow,validate};
