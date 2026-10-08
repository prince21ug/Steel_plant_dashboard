const categories={training:'Training',walk:'Safety Walk',near:'Near Miss Incident'};
const statuses=['Reported','Under Review','Action Pending','Closed'];
const fail=(message,status=400)=>{const e=new Error(message);e.status=status;throw e;};
const str=(v,max=2000)=>{if(typeof v!=='string'||v.trim().length>max)fail('Invalid text field');return v.trim();};
const required=(v,label,max)=>{const x=str(v,max);if(!x)fail(label+' is required');return x;};
const validDate=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
const today=()=>new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'});
function validate(kind,b,old,mongoose){
 if(!validDate(b.date))fail('Enter a valid record date');
 const fields={date:b.date};
 if(kind==='training'){
  Object.assign(fields,{topic:required(b.topic,'Topic',300),trainer:required(b.trainer,'Trainer',120),location:required(b.location,'Location',200)});
  for(const [key,max,integer] of [['numberOfPeople',100000,true],['durationHours',24,false]]){const n=Number(b[key]);if(String(b[key]??'').trim()===''||!Number.isFinite(n)||n<0||(key==='durationHours'&&n===0)||n>max||(integer&&!Number.isInteger(n)))fail('Enter valid participants and duration (0–24 hours)');fields[key]=n;}
 }else if(kind==='near'){
  if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(b.time||''))fail('Enter incident time');
  Object.assign(fields,{time:b.time,location:required(b.location,'Location',200),reportedBy:required(b.reportedBy,'Reported by',120),description:required(b.description,'Incident description'),potentialConsequence:required(b.potentialConsequence,'Potential consequence'),immediateAction:required(b.immediateAction,'Immediate action'),cause:str(b.cause||''),correctiveAction:str(b.correctiveAction||''),assignedTo:required(b.assignedTo,'Responsible person',120),targetDate:b.targetDate});
  if(!validDate(fields.targetDate)||fields.targetDate<fields.date)fail('Target date must be on or after incident date');
  const previous=old?.caseStatus||'Reported',next=b.caseStatus||'Reported';if(!statuses.includes(next))fail('Invalid status');
  if(!old&&next!=='Reported')fail('New incidents start as Reported');
  if(old&&next!==previous&&statuses.indexOf(next)!==statuses.indexOf(previous)+1)fail('Move through Reported → Under Review → Action Pending → Closed');
  if(old&&previous==='Closed')fail('Closed incidents cannot be edited',409);
  if(['Action Pending','Closed'].includes(next)&&(!fields.cause||!fields.correctiveAction))fail('Cause and corrective action are required');
  fields.caseStatus=next;
  if(next==='Closed'){fields.closureNote=required(b.closureNote,'Closure verification');if(!validDate(b.closedDate)||b.closedDate<fields.date||b.closedDate>today())fail('Enter a valid closing date');fields.closedDate=b.closedDate;fields.closedBy=required(b.updatedBy,'Closed by',120);fields.closedAt=new Date();}
 }else{
  Object.assign(fields,{area:required(b.area,'Area',200),conductedBy:required(b.conductedBy,'Conducted by',120)});
  if(!Array.isArray(b.observationItems)||!b.observationItems.length||b.observationItems.length>50)fail('Add between 1 and 50 observations');
  const existing=new Map((old?.observationItems||[]).map(o=>[o.id,o]));const used=new Set();
  fields.observationItems=b.observationItems.map(o=>{let id=o.id;if(id){if(!existing.has(id)||used.has(id))fail('Invalid or duplicate observation');}else id=String(new mongoose.Types.ObjectId());used.add(id);const prior=existing.get(id);
   if(prior?.unsafeIssueId){for(const k of ['description','priority','assignedTo','targetDate'])if(o[k]!==prior[k])fail('Edit linked observations from Unsafe Issues');return prior;}
   if(!['High','Medium','Low'].includes(o.priority)||!validDate(o.targetDate)||o.targetDate<fields.date)fail('Each observation needs priority and target date on/after walk date');
   return {id,description:required(o.description,'Observation'),priority:o.priority,assignedTo:required(o.assignedTo,'Responsible person',120),targetDate:o.targetDate};
  });
  for(const o of existing.values())if(o.unsafeIssueId&&!used.has(o.id))fail('A linked observation cannot be removed');
 }
 return fields;
}
function mountSafetyWorkflow(app,mongoose){
 const col=()=>mongoose.connection.collection('safety');
 const protect=fn=>async(req,res)=>{try{await fn(req,res);}catch(e){console.error('SAFETY WORKFLOW',e);res.status(e.status||500).json({message:e.status?e.message:'Safety request failed. Refresh before retrying.'});}};
 const kindOf=req=>{if(!categories[req.params.kind])fail('Unknown safety category',404);return req.params.kind;};
 const objectId=id=>{if(!mongoose.Types.ObjectId.isValid(id))fail('Invalid record ID');return new mongoose.Types.ObjectId(id);};
 const view=r=>({...r,recordVersion:r.recordVersion||0});
 app.get('/safety-workflow/:kind',protect(async(req,res)=>{
  const kind=kindOf(req),rows=await col().find({category:categories[kind],indicatorType:'Leading'}).sort({date:-1}).toArray();
  if(kind==='walk'){
   const ids=rows.flatMap(r=>(r.observationItems||[]).filter(o=>o.unsafeIssueId).map(o=>objectId(o.unsafeIssueId)));
   const linked=ids.length?await col().find({_id:{$in:ids},category:{$in:['Unsafe Raised','Unsafe Closed']}}).toArray():[];
   const map=new Map(linked.map(r=>[String(r._id),r]));
   rows.forEach(r=>{r.observationItems=(r.observationItems||[]).map(o=>{if(!o.unsafeIssueId)return {...o,linkedStatus:'Open'};const issue=map.get(String(o.unsafeIssueId));return {...o,linkedStatus:issue?(issue.workflowStatus||(issue.category==='Unsafe Closed'?'Closed':'Open')):'Unavailable',linkedTargetDate:issue?.targetDate,linkedAssignedTo:issue?.assignedTo,linkedPriority:issue?.priority,linkedAction:issue?.actionTaken};});});
  }
  res.json(rows.map(view));
 }));
 app.get('/safety-workflow/:kind/:id/history',protect(async(req,res)=>{
  const kind=kindOf(req),_id=objectId(req.params.id),row=await col().findOne({_id,category:categories[kind]});if(!row)fail('Record not found',404);
  const old=await mongoose.connection.collection('safety_history').find({safetyId:_id}).sort({updatedAt:-1}).toArray();
  res.json({events:row.recordEvents||[],legacy:old});
 }));
 app.post('/safety-workflow/:kind',protect(async(req,res)=>{
  const kind=kindOf(req),by=required(req.body.updatedBy,'Your name',120),fields=validate(kind,req.body,null,mongoose),at=new Date();
  const row={...fields,category:categories[kind],indicatorType:'Leading',recordVersion:1,createdAt:at,updatedAt:at,updatedBy:by,recordEvents:[{action:'Created',at,by,after:fields}]};const result=await col().insertOne(row);res.status(201).json(view({...row,_id:result.insertedId}));
 }));
 app.put('/safety-workflow/:kind/:id',protect(async(req,res)=>{
  const kind=kindOf(req),_id=objectId(req.params.id),old=await col().findOne({_id,category:categories[kind]});if(!old)fail('Record not found',404);
  const version=old.recordVersion||0;if(req.body.version!==version)fail('Record changed. Cancel, refresh and retry.',409);
  const by=required(req.body.updatedBy,'Your name',120),fields=validate(kind,req.body,old,mongoose),at=new Date();const {recordEvents,...before}=old;
  const result=await col().updateOne({_id,...(version?{recordVersion:version}:{$or:[{recordVersion:0},{recordVersion:{$exists:false}}]})},{$set:{...fields,updatedAt:at,updatedBy:by},$inc:{recordVersion:1},$push:{recordEvents:{action:kind==='near'&&fields.caseStatus!==(old.caseStatus||'Reported')?'Status: '+fields.caseStatus:'Edited',at,by,before,after:fields}}});if(!result.modifiedCount)fail('Record changed. Refresh and retry.',409);res.json(view(await col().findOne({_id})));
 }));
 app.post('/safety-workflow/walk/:id/observations/:observationId/link',protect(async(req,res)=>{
  const _id=objectId(req.params.id),by=required(req.body.updatedBy,'Your name',120);const session=await mongoose.startSession();let output;
  try{await session.withTransaction(async()=>{
   const walk=await col().findOne({_id,category:categories.walk},{session});if(!walk)fail('Walk not found',404);const observation=(walk.observationItems||[]).find(o=>o.id===req.params.observationId);if(!observation)fail('Observation not found',404);
   if(observation.unsafeIssueId){output={unsafeIssueId:observation.unsafeIssueId};return;}
   if(req.body.version!==(walk.recordVersion||0))fail('Walk changed. Refresh and retry.',409);
   const id=new mongoose.Types.ObjectId(),now=new Date(),issue={_id:id,date:walk.date,location:walk.area,description:observation.description,priority:observation.priority,assignedTo:observation.assignedTo,targetDate:observation.targetDate,reportedBy:by,category:'Unsafe Raised',indicatorType:'Lagging',workflowStatus:'Open',workflowVersion:1,createdAt:now,updatedAt:now,sourceWalkId:_id,sourceObservationId:observation.id,workflowEvents:[{action:'Raised from Safety Walk',by,at:now,note:observation.description}]};
   await col().insertOne(issue,{session});
   await col().updateOne({_id},{$set:{'observationItems.$[item].unsafeIssueId':String(id),updatedAt:now},$inc:{recordVersion:1},$push:{recordEvents:{action:'Linked unsafe issue',by,at:now,observationId:observation.id,unsafeIssueId:String(id)}}},{session,arrayFilters:[{'item.id':observation.id}]});output={unsafeIssueId:String(id)};
  });}finally{await session.endSession();}res.json(output);
 }));
}
module.exports={mountSafetyWorkflow,validate,validDate,categories,statuses};
