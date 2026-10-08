require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");

const app = express();
console.log("🔥 THIS SERVER.JS IS RUNNING 🔥");

/* ===============================
   Middleware
================================ */
app.use(cors());
app.use(express.json());
require("./dbAssistant").mountDbAssistant(app, mongoose);
app.use((req, res, next) => {
  console.log("➡️ Incoming:", req.method, req.url);
  next();
});

/* ===============================
   MongoDB Connection
================================ */
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB Atlas Connected"))
  .catch((err) => console.error("❌ MongoDB Error:", err));

/* ===============================
   TEST ROUTE
================================ */
app.get("/", (req, res) => {
  res.send("Steel Plant Backend Running");
});

/* ============================================================
   🔥 IMPORTANT: MORE SPECIFIC ROUTES FIRST
============================================================ */

/* Read-only motor directory for search and filters. */
app.get("/motor-search", async (req, res) => {
  try {
    const motors = await mongoose.connection.collection("motors")
      .find({}, { projection: { plant: 1, area: 1, location: 1, serialNo: 1, motorName: 1, name: 1, position: 1, bridleNo: 1, rpm: 1, status: 1 } })
      .sort({ plant: 1, area: 1, serialNo: 1 }).toArray();
    res.json(motors);
  } catch (error) {
    console.error("MOTOR SEARCH ERROR:", error);
    res.status(500).json({ message: "Could not load motor directory" });
  }
});

/* ===============================
   GET MOTORS BY PLANT + AREA + BRIDLE
   Example:
   /motors/CGL/Bridle/10
================================ */
app.get("/motors/:plant/:area/:bridleNo", async (req, res) => {
  try {
    const { plant, area, bridleNo } = req.params;

    const motors = await mongoose.connection
      .collection("motors")
      .find({
        plant,
        area,
        bridleNo: isNaN(bridleNo) ? bridleNo : Number(bridleNo)
      })
      .toArray();

    res.json(motors);

  } catch (err) {
    console.error("BRIDLE FETCH ERROR:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/* ===============================
   GET MOTORS BY PLANT & AREA
   Example:
   /motors/CGL/Furnace Motor
================================ */
app.get("/motors/:plant/:area", async (req, res) => {
  try {
    const { plant, area } = req.params;

    const motors = await mongoose.connection
      .collection("motors")
      .find({ plant, area })
      .toArray();

    res.json(motors);
  } catch (err) {
    console.error("AREA FETCH ERROR:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/* ===============================
   GET SINGLE MOTOR
================================ */
app.get("/motors/:id", async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: "Invalid motor ID" });
    }

    const motorId = new mongoose.Types.ObjectId(req.params.id);

    const motor = await mongoose.connection
      .collection("motors")
      .findOne({ _id: motorId });

    if (!motor) {
      return res.status(404).json({ message: "Motor not found" });
    }

    res.json(motor);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});
 app.get("/motor-history/:motorId", async (req, res) => {
  const motorId = new mongoose.Types.ObjectId(req.params.motorId);

  const history = await mongoose.connection
    .collection("motor_history")
    .find({ motorObjectId: motorId })
    .sort({ changeDate: -1 })
    .toArray();

  res.json(history);
});

/* ===============================
   CHANGE MOTOR (WITH HISTORY)
================================ */
app.post("/change-motor", async (req, res) => {
  try {
    const { motorId, newSerialNo, newRpm, reason } = req.body;

    if (!motorId || !newSerialNo || !reason) {
      return res.status(400).json({ message: "Missing fields" });
    }

    if (!mongoose.Types.ObjectId.isValid(motorId)) {
      return res.status(400).json({ message: "Invalid motor ID" });
    }

    const objectId = new mongoose.Types.ObjectId(motorId);
    const motorsCol = mongoose.connection.collection("motors");
    const historyCol = mongoose.connection.collection("motor_history");

    const oldMotor = await motorsCol.findOne({ _id: objectId });

    if (!oldMotor) {
      return res.status(404).json({ message: "Motor not found" });
    }

    await historyCol.insertOne({
      motorObjectId: oldMotor._id,
      oldSerialNo: oldMotor.serialNo,
      oldRpm: oldMotor.rpm,
      newSerialNo,
      newRpm: Number(newRpm),
      reason,
      changeDate: new Date(),
    });

    await motorsCol.updateOne(
      { _id: objectId },
      {
        $set: {
          serialNo: newSerialNo,
          rpm: Number(newRpm),
          installDate: new Date(),
          status: "Running",
        },
      }
    );

    const updatedMotor = await motorsCol.findOne({ _id: objectId });
    res.json(updatedMotor);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

/* ===============================
   ADD VIBRATION TEST
================================ */
app.post("/vibration-test", async (req, res) => {
  try {
    const { motorId, vibrationValue, testDate } = req.body;

    if (!mongoose.Types.ObjectId.isValid(motorId)) {
      return res.status(400).json({ message: "Invalid motor ID" });
    }

    const objectId = new mongoose.Types.ObjectId(motorId);

    await mongoose.connection.collection("vibration_test").insertOne({
      motorId: objectId,
      vibrationValue: Number(vibrationValue),
      testDate: new Date(testDate),
      createdAt: new Date(),
    });

    res.json({ message: "Vibration saved" });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});
 /* ===============================
   GET VIBRATION HISTORY
================================ */
app.get("/vibration-test/:motorId", async (req, res) => {
  try {
    const { motorId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(motorId)) {
      return res.status(400).json({ message: "Invalid motor ID" });
    }

    const objectId = new mongoose.Types.ObjectId(motorId);

    const history = await mongoose.connection
      .collection("vibration_test")
      .find({ motorId: objectId })
      .sort({ testDate: -1 })
      .toArray();

    res.json(history);

  } catch (err) {
    console.error("VIBRATION HISTORY ERROR:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/* ===============================
   ADD GREASING
================================ */
app.post("/greasing", async (req, res) => {
  try {
    const { motorId, greasingDate, greaseType, greasedBy, remark } = req.body;

    if (!mongoose.Types.ObjectId.isValid(motorId)) {
      return res.status(400).json({ message: "Invalid motor ID" });
    }

    const objectId = new mongoose.Types.ObjectId(motorId);

    await mongoose.connection.collection("greasing_history").insertOne({
      motorId: objectId,
      greasingDate: new Date(greasingDate),
      greaseType,
      greasedBy,
      remark,
      createdAt: new Date()
    });

    res.json({ message: "Greasing saved successfully" });

  } catch (err) {
    console.error("GREASING ERROR:", err);
    res.status(500).json({ message: "Server error" });
  }
});
 /* ===============================
   GET GREASING HISTORY
================================ */
app.get("/greasing/:motorId", async (req, res) => {
  try {
    const { motorId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(motorId)) {
      return res.status(400).json({ message: "Invalid motor ID" });
    }

    const objectId = new mongoose.Types.ObjectId(motorId);

    const history = await mongoose.connection
      .collection("greasing_history")
      .find({ motorId: objectId })
      .sort({ greasingDate: -1 })
      .toArray();

    res.json(history);

  } catch (err) {
    console.error("GREASING HISTORY ERROR:", err);
    res.status(500).json({ message: "Server error" });
  }
});
/* ===============================
   GET CRANES BY PLANT
================================ */
app.get("/cranes", async (req, res) => {
  try {
    const { plant } = req.query;

    if (!plant) {
      return res.status(400).json({ message: "Plant required" });
    }

    const cranes = await mongoose.connection
      .collection("cranes")
      .find({ plant })
      .sort({ craneNo: 1 })
      .toArray();

    res.json(cranes);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

/* ===============================
   GET SINGLE CRANE
================================ */
app.get("/crane/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid crane ID" });
    }

    const objectId = new mongoose.Types.ObjectId(id);

    const crane = await mongoose.connection
      .collection("cranes")
      .findOne({ _id: objectId });

    if (!crane) {
      return res.status(404).json({ message: "Crane not found" });
    }

    res.json(crane);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

/* ===============================
   UPDATE CRANE (WITH HISTORY)
================================ */
app.put("/crane/:id", async (req, res) => {
  let session;
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: "Invalid ID" });
    }
    const safetyKeys = ["craneHooter", "mhUpDownLimitSwitch", "ahUpDownLimitSwitch", "crossTravelLimitSwitch", "longTravelLimitSwitch"];
    const brakeKeys = ["mainHoistBrakeGap", "auxHoistBrakeGap", "crossTravelBrakeGap", "longTravelBrakeGap"];
    const safetyChecks = {};
    const brakeChecks = {};
    for (const key of safetyKeys) {
      const value = req.body.safetyChecks?.[key] ?? "OK";
      if (!["OK", "Not OK"].includes(value)) {
        return res.status(400).json({ message: "Invalid safety check: " + key });
      }
      safetyChecks[key] = value;
    }
    for (const key of brakeKeys) {
      const value = req.body.brakeChecks?.[key] ?? "Within Limit";
      if (!["Within Limit", "Outside Limit"].includes(value)) {
        return res.status(400).json({ message: "Invalid brake check: " + key });
      }
      brakeChecks[key] = value;
    }
    const inspectorName = typeof req.body.inspectorName === "string" ? req.body.inspectorName.trim() : "";
    const remark = typeof req.body.remark === "string" ? req.body.remark.trim() : "";
    const actionTaken = typeof req.body.actionTaken === "string" ? req.body.actionTaken.trim() : "";
    if (inspectorName.length > 120 || remark.length > 2000 || actionTaken.length > 2000) {
      return res.status(400).json({ message: "Inspection notes are too long" });
    }
    const issues = {};
    for (const [group, checks] of Object.entries({ safetyChecks, brakeChecks })) {
      for (const [key, value] of Object.entries(checks)) {
        if (value === "Not OK" || value === "Outside Limit") {
          issues[group + "_" + key] = { group, key, value, status: "Open" };
        }
      }
    }
    const objectId = new mongoose.Types.ObjectId(req.params.id);
    const craneCol = mongoose.connection.collection("cranes");
    const historyCol = mongoose.connection.collection("crane_history");
    session = await mongoose.startSession();
    let updatedCrane;
    // Commit the inspection and reset together; a failed save changes neither.
    await session.withTransaction(async () => {
      const oldCrane = await craneCol.findOne({ _id: objectId }, { session });
      if (!oldCrane) {
        const error = new Error("Crane not found");
        error.status = 404;
        throw error;
      }
      const updatedAt = new Date();
      const updatedBy = inspectorName || (typeof req.body.lastUpdatedBy === "string"
        ? req.body.lastUpdatedBy : "Maintenance");
      const inspectionData = { ...oldCrane, safetyChecks, brakeChecks };
      await historyCol.insertOne({
        craneId: oldCrane._id,
        plant: oldCrane.plant,
        craneNo: oldCrane.craneNo,
        recordType: "inspection",
        inspectorName: updatedBy,
        remark,
        actionTaken,
        issues,
        inspectionData,
        oldData: oldCrane,
        updatedAt,
        updatedBy
      }, { session });
      const defaults = {
        safetyChecks: Object.fromEntries(safetyKeys.map(key => [key, "OK"])),
        brakeChecks: Object.fromEntries(brakeKeys.map(key => [key, "Within Limit"])),
        lastUpdatedAt: updatedAt,
        lastUpdatedBy: updatedBy,
        checksAreDefaults: true
      };
      await craneCol.updateOne({ _id: objectId }, { $set: defaults }, { session });
      updatedCrane = { ...oldCrane, ...defaults };
    });
    res.json(updatedCrane);
  } catch (err) {
    console.error("CRANE UPDATE ERROR:", err);
    res.status(err.status || 500).json({ message: err.status === 404 ? err.message : "Inspection save failed. Please try again." });
  } finally {
    if (session) await session.endSession();
  }
});


/* Resolve one recorded fault without changing the original inspection result. */
app.put("/crane-history/:historyId/issues/:issueKey/resolve", async (req, res) => {
  try {
    const { historyId, issueKey } = req.params;
    if (!mongoose.Types.ObjectId.isValid(historyId)) {
      return res.status(400).json({ message: "Invalid history ID" });
    }
    const resolvedBy = typeof req.body.resolvedBy === "string" ? req.body.resolvedBy.trim() : "";
    const resolutionAction = typeof req.body.resolutionAction === "string" ? req.body.resolutionAction.trim() : "";
    if (!resolvedBy || !resolutionAction || resolvedBy.length > 120 || resolutionAction.length > 2000) {
      return res.status(400).json({ message: "Enter repair action (up to 2000 characters) and resolved by (up to 120 characters)" });
    }
    const col = mongoose.connection.collection("crane_history");
    const _id = new mongoose.Types.ObjectId(historyId);
    const record = await col.findOne({ _id });
    if (!record || record.recordType !== "inspection") {
      return res.status(404).json({ message: "Inspection not found" });
    }
    const allowed = {
      safetyChecks: ["craneHooter", "mhUpDownLimitSwitch", "ahUpDownLimitSwitch", "crossTravelLimitSwitch", "longTravelLimitSwitch"],
      brakeChecks: ["mainHoistBrakeGap", "auxHoistBrakeGap", "crossTravelBrakeGap", "longTravelBrakeGap"]
    };
    let fault;
    for (const [group, keys] of Object.entries(allowed)) {
      for (const key of keys) {
        const value = record.inspectionData?.[group]?.[key];
        if (issueKey === group + "_" + key && (value === "Not OK" || value === "Outside Limit")) {
          fault = { group, key, value };
        }
      }
    }
    if (!fault) return res.status(400).json({ message: "Recorded fault not found" });
    const result = await col.updateOne(
      { _id, ["issues." + issueKey + ".status"]: { $ne: "Resolved" } },
      { $set: { ["issues." + issueKey]: {
        ...fault, status: "Resolved", resolvedBy, resolutionAction, resolvedAt: new Date()
      } } }
    );
    if (!result.matchedCount) {
      return res.status(409).json({ message: "This issue was already resolved. Reload to see the latest record." });
    }
    res.json(await col.findOne({ _id }));
  } catch (error) {
    console.error("CRANE ISSUE RESOLVE ERROR:", error);
    res.status(500).json({ message: "Could not resolve issue" });
  }
});

/* ===============================
   GET CRANE HISTORY
================================ */
app.get("/crane-history/:craneId", async (req, res) => {
  try {
    const { craneId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(craneId)) {
      return res.status(400).json({ message: "Invalid ID" });
    }

    const objectId = new mongoose.Types.ObjectId(craneId);

    const history = await mongoose.connection
      .collection("crane_history")
      .find({ craneId: objectId })
      .sort({ updatedAt: -1 })
      .toArray();

    res.json(history);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});
  
/* ===============================
   ADD SAFETY RECORD
================================ */
/* Linked unsafe-condition workflow. Legacy records are interpreted, never bulk-rewritten. */
const unsafeCategories = ["Unsafe Raised", "Unsafe Closed"];
const unsafeStatus = row => row.workflowStatus || (row.category === "Unsafe Closed" ? "Closed" : "Open");
const unsafeView = row => ({...row, workflowStatus: unsafeStatus(row), workflowVersion: row.workflowVersion || 0});
app.get('/unsafe-issues', async (req,res) => {
  try { const rows=await mongoose.connection.collection('safety').find({category:{$in:unsafeCategories}}).sort({date:-1}).toArray();res.json(rows.map(unsafeView)); }
  catch(e){console.error('UNSAFE LIST',e);res.status(500).json({message:'Could not load unsafe issues'});}
});
const unsafeText=(value,max=2000)=>typeof value==='string'&&value.trim().length<=max?value.trim():null;
const unsafeDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
function unsafeFields(body){
  const description=unsafeText(body.description),location=unsafeText(body.location,200),assignedTo=unsafeText(body.assignedTo,120);
  if(!description||!location||!assignedTo||!['High','Medium','Low'].includes(body.priority)||!unsafeDate(body.targetDate))return null;
  return {description,location,assignedTo,priority:body.priority,targetDate:body.targetDate};
}
app.post('/unsafe-issues', async(req,res)=>{
 try{const fields=unsafeFields(req.body),by=unsafeText(req.body.updatedBy,120);
  if(!fields||!by||!unsafeDate(req.body.date))return res.status(400).json({message:'Enter date, location, description, priority, assignee, target date and your name'});
  if(fields.targetDate<req.body.date)return res.status(400).json({message:'Target date cannot be before raised date'});
  const now=new Date(),row={...fields,date:req.body.date,reportedBy:by,category:'Unsafe Raised',indicatorType:'Lagging',workflowStatus:'Open',workflowVersion:1,createdAt:now,updatedAt:now,workflowEvents:[{action:'Raised',by,at:now,snapshot:{...fields,date:req.body.date}}]};
  const result=await mongoose.connection.collection('safety').insertOne(row);res.status(201).json({...row,_id:result.insertedId});
 }catch(e){console.error('UNSAFE CREATE',e);res.status(500).json({message:'Could not raise issue'});}
});
app.put('/unsafe-issues/:id',async(req,res)=>{
 try{
  if(!mongoose.Types.ObjectId.isValid(req.params.id))return res.status(400).json({message:'Invalid issue ID'});
  const col=mongoose.connection.collection('safety'),_id=new mongoose.Types.ObjectId(req.params.id),old=await col.findOne({_id,category:{$in:unsafeCategories}});
  if(!old)return res.status(404).json({message:'Issue not found'});
  const version=old.workflowVersion||0,by=unsafeText(req.body.updatedBy,120),action=req.body.action;
  if(!by||!Number.isInteger(req.body.version))return res.status(400).json({message:'Your name and record version are required'});
  if(version!==req.body.version)return res.status(409).json({message:'Issue changed. Refresh and retry.'});
  const now=new Date(),changes={updatedAt:now,updatedBy:by};let note='';
  if(action==='edit'){
   if(unsafeStatus(old)!=='Open')return res.status(409).json({message:'Reopen the issue before editing'});
   const fields=unsafeFields(req.body);if(!fields)return res.status(400).json({message:'Complete location, description, priority, assignee and valid target date'});
   Object.assign(changes,fields);changes.workflowStatus='Open';
  }else if(action==='close'){
   if(unsafeStatus(old)!=='Open')return res.status(409).json({message:'Issue is already closed'});
   note=unsafeText(req.body.actionTaken);if(!note||!unsafeDate(req.body.closedDate))return res.status(400).json({message:'Repair action and closing date are required'});
   const today=now.toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'});
   if(req.body.closedDate>today||(unsafeDate(old.date)&&req.body.closedDate<old.date))return res.status(400).json({message:'Closing date must be between raised date and today'});
   Object.assign(changes,{workflowStatus:'Closed',closedBy:by,closedDate:req.body.closedDate,closedAt:now,actionTaken:note});
  }else if(action==='reopen'){
   if(unsafeStatus(old)!=='Closed')return res.status(409).json({message:'Issue is already open'});
   note=unsafeText(req.body.reason);if(!note)return res.status(400).json({message:'Reopen reason is required'});
   Object.assign(changes,{workflowStatus:'Open',reopenedAt:now,reopenedBy:by});
  }else return res.status(400).json({message:'Invalid action'});
  const {workflowEvents,...snapshot}=old;
  const filter={_id,...(version?{workflowVersion:version}:{$or:[{workflowVersion:0},{workflowVersion:{$exists:false}}]})};
  // One document update commits the state and its audit event together.
  const result=await col.updateOne(filter,{$set:changes,$inc:{workflowVersion:1},$push:{workflowEvents:{action,by,at:now,note,closedDate:req.body.closedDate||null,before:snapshot,after:changes}}});
  if(!result.modifiedCount)return res.status(409).json({message:'Issue changed. Refresh and retry.'});
  res.json(unsafeView(await col.findOne({_id})));
 }catch(e){console.error('UNSAFE UPDATE',e);res.status(500).json({message:'Could not save issue. Refresh before retrying.'});}
});

require("./safetyWorkflow").mountSafetyWorkflow(app, mongoose);
require("./injuryWorkflow").mountInjuryWorkflow(app, mongoose);

app.post("/safety", async (req,res)=>{

  try{

    const data = req.body;

    await mongoose.connection
      .collection("safety")
      .insertOne(data);

    res.json({message:"Issue added"});

  }
  catch(err){

    console.error("SAFETY INSERT ERROR:",err);
    res.status(500).json({message:"Server error"});

  }

});


/* ===============================
   FILTER SAFETY DATA
================================ */
app.get("/safety-filter", async (req, res) => {

  try {

    const { indicatorType, category, status } = req.query;

    const query = {};

    if (indicatorType) query.indicatorType = indicatorType;
    if (category) query.category = category;
    if (status) query.status = status;

    const data = await mongoose.connection
      .collection("safety")
      .find(query)
      .sort({ date: -1 })
      .toArray();

    res.json(data);

  } catch (err) {

    console.error("SAFETY FILTER ERROR:",err);
    res.status(500).json({ message: "Server error" });

  }

});


/* ===============================
   GET ALL SAFETY DATA
================================ */
app.get("/safety", async (req, res) => {

  try {

    const safety = await mongoose.connection
      .collection("safety")
      .find({})
      .sort({ date: -1 })
      .toArray();

    res.json(safety);

  } catch (err) {

    console.error("SAFETY FETCH ERROR:", err);
    res.status(500).json({ message: "Server error" });

  }

});


/* ===============================
   GET SINGLE SAFETY RECORD
================================ */
app.get("/safety/:id", async (req, res) => {

  try {

    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid ID" });
    }

    const objectId = new mongoose.Types.ObjectId(id);

    const safety = await mongoose.connection
      .collection("safety")
      .findOne({ _id: objectId });

    if (!safety) {
      return res.status(404).json({ message: "Safety record not found" });
    }

    res.json(safety);

  } catch (err) {

    console.error("SAFETY GET ERROR:", err);
    res.status(500).json({ message: "Server error" });

  }

});


/* ===============================
   UPDATE SAFETY RECORD
   (WITH HISTORY)
================================ */
app.put("/safety/:id", async (req, res) => {

  try {

    const id = req.params.id;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid ID" });
    }

    const objectId = new mongoose.Types.ObjectId(id);

    const safetyCol = mongoose.connection.collection("safety");
    const historyCol = mongoose.connection.collection("safety_history");

    const oldSafety = await safetyCol.findOne({ _id: objectId });

    if (!oldSafety) {
      return res.status(404).json({ message: "Safety record not found" });
    }

    if (unsafeCategories.includes(oldSafety.category) || ["Training", "Safety Walk", "Near Miss Incident", "FAC", "MTI", "LTI"].includes(oldSafety.category)) {
      return res.status(409).json({message:"Use the updated safety category page to edit this record"});
    }

    /* SAVE OLD DATA TO HISTORY */

    await historyCol.insertOne({
      safetyId: oldSafety._id,
      indicatorType: oldSafety.indicatorType,
      category: oldSafety.category,
      oldData: oldSafety,
      updatedAt: new Date(),
      updatedBy: req.body.updatedBy || "Safety Officer"
    });

    /* UPDATE MAIN RECORD */

    await safetyCol.updateOne(
      { _id: objectId },
      { $set: req.body }
    );

    const updatedSafety = await safetyCol.findOne({ _id: objectId });

    res.json(updatedSafety);

  } catch (err) {

    console.error("SAFETY UPDATE ERROR:", err);
    res.status(500).json({ message: "Server error" });

  }

});


/* ===============================
   GET ALL SAFETY HISTORY
================================ */
app.get("/safety-history", async (req, res) => {

  try{

    const history = await mongoose.connection
      .collection("safety_history")
      .find({})
      .sort({ updatedAt:-1 })
      .toArray();

    res.json(history);

  }
  catch(err){

    console.error("SAFETY HISTORY ERROR:",err);
    res.status(500).json({message:"Server error"});

  }

});


/* ===============================
   GET HISTORY BY SAFETY ID
================================ */
app.get("/safety-history/:safetyId", async (req, res) => {

  try {

    const { safetyId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(safetyId)) {
      return res.status(400).json({ message: "Invalid ID" });
    }

    const objectId = new mongoose.Types.ObjectId(safetyId);

    const history = await mongoose.connection
      .collection("safety_history")
      .find({ safetyId: objectId })
      .sort({ updatedAt: -1 })
      .toArray();

    res.json(history);

  } catch (err) {

    console.error("SAFETY HISTORY ERROR:", err);
    res.status(500).json({ message: "Server error" });

  }

});
app.get("/acs/:plant", async (req, res) => {
  try {
    const { plant } = req.params;

    const acs = await mongoose.connection
      .collection("acs")
      .find({ plant })
      .sort({ acNo: 1 })
      .toArray();

    res.json(acs);

  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});
app.get("/ac/:id", async (req, res) => {
  try {

    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid AC ID" });
    }

    const objectId = new mongoose.Types.ObjectId(id);

    const ac = await mongoose.connection
      .collection("acs")
      .findOne({ _id: objectId });

    if (!ac) {
      return res.status(404).json({ message: "AC not found" });
    }

    res.json(ac);

  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});
app.put("/ac/:id", async (req, res) => {
  try {

    const id = req.params.id;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid ID" });
    }

    const objectId = new mongoose.Types.ObjectId(id);

    const acCol = mongoose.connection.collection("acs");
    const historyCol = mongoose.connection.collection("ac_history");

    const oldAc = await acCol.findOne({ _id: objectId });

    if (!oldAc) {
      return res.status(404).json({ message: "AC not found" });
    }

    await historyCol.insertOne({
      acId: oldAc._id,
      oldData: oldAc,

      repairDate: req.body.repairDate,
      repairDetails: req.body.repairDetails,
      technician: req.body.technician,
      remark: req.body.remark,

      updatedAt: new Date()
    });

    await acCol.updateOne(
      { _id: objectId },
      {
        $set: {
          status: req.body.status || oldAc.status
        }
      }
    );

    const updated = await acCol.findOne({ _id: objectId });

    res.json(updated);

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});
app.get("/ac-history/:id", async (req, res) => {
  try {

    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid ID" });
    }

    const history = await mongoose.connection
      .collection("ac_history")
      .find({
        acId: new mongoose.Types.ObjectId(id)
      })
      .sort({ updatedAt: -1 })
      .toArray();

    res.json(history);

  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});
/* ===============================
   START SERVER
================================ */
app.listen(5005, () => {
  console.log("🚀 Server running on port 5005");
});



