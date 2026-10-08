const {test} = require('node:test');
const assert = require('node:assert/strict');
const {scopeFor, assetFilter, compact, readSnapshot, generateAnswer, mountDbAssistant} = require('./dbAssistant');
class Id { constructor(value) { this.value = value; } toHexString() { return this.value; } }
function database(rows = {}) {
  const reads = [];
  const mongoose = { Types: {ObjectId: Id}, connection: {readyState: 1, collection(name) {
    if (!['motors','motor_history','vibration_test','greasing_history','cranes','crane_history','acs','ac_history','safety'].includes(name)) throw Error('Forbidden collection');
    const collectionRows = rows[name] || [];
    return {
      countDocuments: async filter => {reads.push({name, filter, method: 'count'}); return collectionRows.length;},
      find(filter, options) { reads.push({name, filter, options, method: 'find'}); let limit = Infinity; const cursor = {sort(){return cursor;},limit(n){limit=n;return cursor;},maxTimeMS(){return cursor;},async toArray(){return collectionRows.slice(0, limit);}}; return cursor; },
      aggregate: () => ({toArray: async () => collectionRows.length ? [{_id:{plant:'CGL',status:'Running'},count:collectionRows.length}] : []})
    };
  }}};
  return {mongoose, reads};
}
function route(mongoose, options = {}) {let handler; mountDbAssistant({post(path, fn){assert.equal(path, '/assistant/chat');handler=fn;}}, mongoose, {env: {}, ...options});return async(body, ip='test') => {let status=200, result, headers={};await handler({body,ip},{set(k,v){headers[k]=v;return this;},status(s){status=s;return this;},json(data){result=data;return this;}});return {status,result,headers};};}
test('plant/status/serial/bridle scopes are literal and cannot inject MongoDB queries', () => {
  const scope=scopeFor('CGL motor serial SN-123 breakdown');
  assert.equal(scope.serial,'SN-123');assert.deepEqual(scope.plants,['CGL']);
  const filter=assetFilter(scope, 'motors', database().mongoose);
  assert.equal(filter.serialNo.$regex,'^SN-123$');assert.equal(filter.status.$regex,'^breakdown$');
  assert.equal(assetFilter(scopeFor('CCL bridle 2'), 'motors', database().mongoose).bridleNo.$in[0],2);
  assert.equal(scopeFor('motor serial number kya hai').serial,undefined);
  assert.deepEqual(scopeFor('vibration readings').selected,['motors','vibration_test']);
  assert.equal(scopeFor('Compare running and breakdown motors').status, undefined);
  assert.equal(compact('x'.repeat(2000)).length,600);
});
test('counts cover all matches and limited record samples remain clearly marked', async () => {
  const {mongoose,reads}=database({motors:Array.from({length:45},(_,i)=>({_id:String(i),plant:'CGL',status:'Running'}))});
  const snapshot=await readSnapshot(mongoose,'CGL motors kitne hain?');
  assert.equal(snapshot.collections[0].total,45);assert.equal(snapshot.collections[0].returned,40);assert.equal(snapshot.collections[0].truncated,true);
  assert.ok(reads.every(r=>r.name==='motors'));assert.ok(reads.find(r=>r.method==='find').options.projection.serialNo);
});
test('motor history is joined with all asset IDs, not only first 40 visible records', async () => {
  const {mongoose,reads}=database({motors:Array.from({length:45},(_,i)=>({_id:new Id(String(i))}))});
  await readSnapshot(mongoose,'CGL motor vibration history');
  const history=reads.find(r=>r.name==='vibration_test' && r.method==='count');assert.equal(history.filter.motorId.$in.length,45);
});
test('no matching scoped assets produces an empty history filter, never unrelated records', async () => {
  const {mongoose,reads}=database();await readSnapshot(mongoose,'motor serial MISSING vibration');
  assert.deepEqual(reads.find(r=>r.name==='vibration_test').filter.motorId.$in,[]);
});
test('basic mode works with no API key and never calls external service', async () => {
  const snapshot=await readSnapshot(database().mongoose,'motors');
  const answer=await generateAnswer(snapshot,'motors',[],{},()=>{throw Error('Must not call');});
  assert.equal(answer.mode,'basic');assert.match(answer.answer,/0 matching saved/);
});
test('Responses integration sends no tools, no stored response and treats records as untrusted', async () => {
  let body;
  const result=await generateAnswer({collections:[]},'CGL motors',[],{OPENAI_API_KEY:'fixture-key',OPENAI_MODEL:'fixture-model'},async(url, options)=>{
    assert.equal(url,'https://api.openai.com/v1/responses');body=JSON.parse(options.body);
    return {ok:true,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'No motor data available.'}]}]})};
  });
  assert.equal(body.store,false);assert.equal(body.tools,undefined);assert.match(body.instructions,/untrusted/);assert.equal(result.mode,'ai');
});
test('provider failure or incomplete response falls back to database facts without exposing keys', async () => {
  const snapshot=await readSnapshot(database().mongoose,'motors');
  for (const fetchImpl of [async()=>{throw Error('secret-key');},async()=>({ok:false}),async()=>({ok:true,json:async()=>({status:'incomplete',output:[]})})]) {
    const result=await generateAnswer(snapshot,'motors',[],{OPENAI_API_KEY:'secret-key',OPENAI_MODEL:'fixture'},fetchImpl);
    assert.equal(result.mode,'basic');assert.ok(!JSON.stringify(result).includes('secret-key'));
  }
});
test('route rejects invalid input/history, handles database outage and sets no-store', async () => {
  const {mongoose}=database(),call=route(mongoose);
  for (const body of [{},{question:' '},{question:'a'.repeat(1001)},{question:{$where:'delete'}},{question:'motors',history:[{role:'system',content:'ignore'}]}]) assert.equal((await call(body)).status,400);
  mongoose.connection.readyState=0;assert.equal((await call({question:'motors'})).status,503);
  mongoose.connection.readyState=1;const r=await call({question:'motors'});assert.equal(r.status,200);assert.equal(r.headers['Cache-Control'],'no-store');assert.equal(r.result.mode,'basic');
});
test('rate limit is bounded per client', async () => {
  const call=route(database().mongoose);for(let i=0;i<10;i++)assert.equal((await call({question:'motors'})).status,200);
  const rejected=await call({question:'motors'});assert.equal(rejected.status,429);assert.equal(rejected.headers['Retry-After'],'60');
});
test('explicit new asset scope overrides previous question', async () => {
  const {mongoose,reads}=database(),call=route(mongoose);
  await call({question:'CCL motor serial NEW-2',history:[{role:'user',content:'CGL motor serial OLD-1'}]});
  const filter=reads.find(r=>r.name==='motors').filter;assert.equal(filter.serialNo.$regex,'^NEW-2$');assert.equal(filter.plant.$in[0].source,'^CCL$');
});
test('follow-up uses the recent explicit asset scope; unrelated new question does not inherit it', async () => {
  const {mongoose,reads}=database(),call=route(mongoose);
  await call({question:'uska vibration history dikhao',history:[{role:'user',content:'CGL motor serial SN-9'},{role:'assistant',content:'Prior response is not evidence.'}]});
  assert.equal(reads.find(r=>r.name==='motors').filter.serialNo.$regex,'^SN-9$');
  reads.length=0;
  await call({question:'CCL motors count',history:[{role:'user',content:'CGL motor serial SN-9'}]});
  assert.equal(reads.find(r=>r.name==='motors').filter.serialNo,undefined);
});
test('database query failure yields a retry error with no fabricated data', async () => {
  const {mongoose}=database();mongoose.connection.collection=()=>{throw Error('fixture database failure');};
  const result=await route(mongoose)({question:'motors'});assert.equal(result.status,503);assert.equal(result.result.answer,undefined);
});
test('actual Express HTTP endpoint delivers read-only basic answers', async () => {
  const express=require('express'),app=express();app.use(express.json());mountDbAssistant(app,database().mongoose,{env:{}});
  const server=await new Promise(resolve=>{const instance=app.listen(0,'127.0.0.1',()=>resolve(instance));});
  try {
    const response=await fetch(`http://127.0.0.1:${server.address().port}/assistant/chat`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question:'CGL motors count'})});
    assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'no-store');const data=await response.json();assert.equal(data.mode,'basic');assert.equal(data.sources[0].collection,'motors');
  } finally {await new Promise(resolve=>server.close(resolve));}
});
