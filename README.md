# Steel Plant Dashboard — Backend API

**Maintenance records and safety workflows for steel-plant electrical teams.**

[![Deployment: Render configuration](https://img.shields.io/badge/Deployment-Render_configuration-46e3b7)](https://steel-plant-dashboard-1.onrender.com)
![Build: Node runtime](https://img.shields.io/badge/Build-Node_runtime_no_build_step-339933)
![Stack](https://img.shields.io/badge/Stack-Express_5_%7C_MongoDB_%7C_Mongoose_9-blue)

This repository provides the REST API used by the steel-plant maintenance dashboard. It centralizes motor replacement, vibration and greasing records, crane inspections and repairs, AC repair history, and safety follow-up. Maintenance personnel can retrieve equipment by production line and retain the history behind inspections and corrective actions.

- **Vercel frontend:** [steel-plant-frontend.vercel.app](https://steel-plant-frontend.vercel.app)
- **Configured backend URL:** [steel-plant-dashboard-1.onrender.com](https://steel-plant-dashboard-1.onrender.com)
- **Companion UI:** [steel-plant-frontend](https://github.com/satishkumar123123/steel-plant-frontend)

Deployment links are taken from the companion frontend's source configuration; the badges describe configuration and commands, not monitored uptime or CI results.

## ✨ Features & Capabilities

### Core logic

- Query motors by plant, area and bridle; retrieve individual equipment records.
- Replace a motor while saving its previous serial number, RPM, replacement reason and date.
- Record vibration measurements and greasing activities with dated history.
- Save crane inspections covering five safety checks and four brake checks.
- Store the original crane inspection and its faults, reset the next-inspection form defaults, and resolve individual recorded faults with repair details.
- Record AC repairs and update equipment status.
- Answer database questions through a read-only assistant endpoint, using fresh counts and limited saved-record evidence. Optional OpenAI Responses integration produces Hindi/Hinglish/English answers; basic mode works without an AI key.
- Manage unsafe conditions through raise, edit, close and reopen actions.
- Manage training sessions, safety-walk observations and near-miss investigations.
- Link a safety-walk observation to an unsafe issue without duplicating the link on repeated requests.
- Manage FAC, MTI and LTI incidents, including reviewed reclassification, action closure and reopening.

### Dashboard / UI integration

- JSON endpoints for equipment directories, detail pages, trend charts and report generation in the companion React application.
- Read-only motor directory projection for frontend search and filters.
- Current and legacy safety history retrieval for audit views.
- Basic service response at `GET /`; this confirms the process responds, not database readiness.

### Data handling

- MongoDB ObjectId references connect assets to maintenance history.
- Crane inspection saves and safety-walk issue linking use MongoDB sessions and transactions.
- Version checks reject stale updates in unsafe, leading-safety and injury workflows with HTTP `409`.
- Audit events are appended alongside workflow changes in a single document update.
- Workflow validators check text lengths, dates, required details, numeric values and allowed transitions.
- Legacy safety history remains available without a bulk migration.

## 🛠 Tech Stack & Architecture

| Layer | Implementation |
| --- | --- |
| API runtime | Node.js, CommonJS modules |
| Server | Express `^5.2.1` |
| Database integration | Mongoose `^9.1.5`; direct `mongoose.connection.collection(...)` operations |
| Database | MongoDB; Atlas can supply the connection URI |
| Middleware | `cors ^2.8.6`, `express.json()`, request logging |
| Configuration | `dotenv ^17.4.2` |
| Frontend | Separate React application; no frontend build in this repository |
| Tests | Node assert-based `.test.cjs` workflow scripts with mocked persistence |
| Tooling | npm lockfile, Git and GitHub; no checked-in CI workflow |

Requests flow from the React UI to Express, then directly to MongoDB collections. There are no Mongoose schema/model declarations, DTO layer, cache service, authentication middleware or SCADA/OPC UA/Modbus integration in the current source.

### Collections and relationships

| Collection | Purpose / reference |
| --- | --- |
| `motors` | Asset fields such as plant, area, bridleNo, serialNo, RPM and status |
| `motor_history` | Replacements linked by `motorObjectId` |
| `vibration_test` | Measurements linked by `motorId` |
| `greasing_history` | Greasing activities linked by `motorId` |
| `cranes` | Crane equipment and next-inspection defaults |
| `crane_history` | Inspection snapshots and fault resolution, linked by `craneId` |
| `acs` | AC equipment |
| `ac_history` | Repair snapshots linked by `acId` |
| `safety` | Unsafe conditions, leading indicators and injury incidents with workflow events |
| `safety_history` | Legacy safety snapshots linked by `safetyId` |

MongoDB transactions require a replica set or sharded cluster. A standalone local MongoDB instance cannot support the transactional inspection and observation-link operations. No seed script, index migration or schema migration is included; existing assets must be populated separately. Plant/area queries use exact stored values, and history references must be actual ObjectIds.

### API routes

Paths are mounted directly at the server root; there is no `/api` prefix.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/` | Basic service response |
| POST | `/assistant/chat` | Read-only DB Q&A; body: question and optional history (up to six messages) |
| GET | `/motor-search` | Motor directory |
| GET | `/motors/:plant/:area/:bridleNo` | Motors for a bridle |
| GET | `/motors/:plant/:area` | Motors for a plant/area |
| GET | `/motors/:id` | One motor |
| GET | `/motor-history/:motorId` | Replacement history |
| POST | `/change-motor` | Replace motor; body: motorId, newSerialNo, newRpm, reason |
| POST | `/vibration-test` | Save motorId, vibrationValue and testDate |
| GET | `/vibration-test/:motorId` | Vibration history |
| POST | `/greasing` | Save motorId, greasingDate, greaseType, greasedBy and remark |
| GET | `/greasing/:motorId` | Greasing history |
| GET | `/cranes?plant=CGL` | Crane list; plant query is required |
| GET / PUT | `/crane/:id` | Read crane / save inspection |
| GET | `/crane-history/:craneId` | Inspection history |
| PUT | `/crane-history/:historyId/issues/:issueKey/resolve` | Resolve fault with resolvedBy and resolutionAction |
| GET / POST | `/unsafe-issues` | List / raise unsafe conditions |
| PUT | `/unsafe-issues/:id` | Edit, close or reopen; requires version and updatedBy |
| GET / POST | `/safety-workflow/:kind` | List / create training, walk or near records |
| PUT | `/safety-workflow/:kind/:id` | Update leading record with version and updatedBy |
| GET | `/safety-workflow/:kind/:id/history` | Current events and legacy snapshots |
| POST | `/safety-workflow/walk/:id/observations/:observationId/link` | Link observation to unsafe issue |
| GET / POST | `/injury-incidents` | List / create FAC, MTI or LTI incidents |
| PUT | `/injury-incidents/:id` | Edit, reclassify, close or reopen with version |
| GET | `/injury-incidents/:id/history` | Incident events and legacy history |
| GET / POST | `/safety` | Legacy list / insert safety record |
| GET | `/safety-filter` | Filter by indicatorType, category and status |
| GET / PUT | `/safety/:id` | Legacy read / update; managed categories require dedicated workflows |
| GET | `/safety-history` | All legacy safety history |
| GET | `/safety-history/:safetyId` | Legacy history for a record |
| GET | `/acs/:plant` | AC list |
| GET / PUT | `/ac/:id` | Read AC / record repair and status |
| GET | `/ac-history/:id` | AC repair history |

`:kind` is exactly `training`, `walk` or `near`. Near-miss progression is `Reported → Under Review → Action Pending → Closed`. The dedicated workflow modules are the authoritative source for category-specific request fields.

## 📁 Project Structure

```text
steel-plant-dashboard/
├── .env.example              # MongoDB and optional server-only AI settings
├── dbAssistant.js            # Read-only retrieval, summaries and AI answers
├── dbAssistant.test.cjs      # Assistant limits, retrieval and provider fallback tests
├── server.js                 # Express middleware, MongoDB connection and asset/unsafe routes
├── safetyWorkflow.js         # Training, safety walk, near miss and observation linking
├── injuryWorkflow.js         # Injury validation, reclassification and follow-up workflow
├── safetyWorkflow.test.cjs   # Validation, concurrency and mocked transaction checks
├── injuryWorkflow.test.cjs   # Injury validation and workflow checks
├── package.json              # Runtime dependencies and placeholder npm test script
├── package-lock.json         # Locked dependency graph
├── .gitignore                # Ignores node_modules and .env
└── README.md                 # Setup, architecture and API documentation
```

Routes and database access currently live in root modules; there are no `src/`, `routes/`, `models/`, `api/` or `public/` directories.

## 🚀 Getting Started (Local Setup)

### Prerequisites

- Node.js **20.19.0 or newer**, matching the locked Mongoose/MongoDB driver minimum; use an actively supported Node release.
- npm and Git.
- A reachable MongoDB database. Use Atlas or a local replica set for transactional features.
- Port **5005** available.

### 1. Clone and install

```bash
git clone https://github.com/satishkumar123123/steel-plant-dashboard.git
cd steel-plant-dashboard
npm ci
```

### 2. Configure the environment

Copy the committed template, then edit `.env` with your own values:

```bash
cp .env.example .env
```

Example MongoDB configuration:

```dotenv
MONGO_URI=mongodb://127.0.0.1:27017/steelPlantDB?replicaSet=rs0
```

The example assumes an already configured local replica set named `rs0`. For Atlas, replace it with your own database connection string and credentials. Keep `.env` private.

### 3. Run the API

```bash
node server.js
```

For development with automatic restarts:

```bash
node --watch server.js
```

Open [http://localhost:5005](http://localhost:5005). Confirm both the server startup and successful MongoDB connection in the terminal. Configure the companion frontend with `REACT_APP_API_URL=http://localhost:5005`.

### 4. Validate workflows

```bash
node --test dbAssistant.test.cjs
node injuryWorkflow.test.cjs
node safetyWorkflow.test.cjs
```

These existing scripts exercise validators and mocked workflow handlers; they are not real-database integration tests. Expected rejection cases log errors before the final `PASS` messages. The assistant tests and both existing workflow scripts passed during the assistant update. The AI provider was mocked; no real provider credentials or production DB were available for testing.

### Production execution

There is no transpilation, production preview, `dev`, `start` or `build` npm script. Run `node server.js` under your hosting service's process management. `npm test` currently contains a placeholder that exits unsuccessfully; use the direct test commands above.

## ⚙️ Environment Variables

| Variable | Required | Description | Dummy example |
| --- | --- | --- | --- |
| `OPENAI_API_KEY` | Optional | Server-only API key; never place in frontend or commit it | `your-server-api-key` |
| `OPENAI_MODEL` | Required for AI mode | Responses-compatible model ID available to your API project; no model is silently selected | `your-enabled-model-id` |
| `MONGO_URI` | Yes | MongoDB URI loaded by dotenv; select the intended database and a transaction-capable deployment | `mongodb://127.0.0.1:27017/steelPlantDB?replicaSet=rs0` |

`PORT` is not read by the application: `server.js` binds to **5005**. Changing a hosting dashboard's PORT value alone will not change the listening port.

## 🌐 Deployment Notes (Vercel)

The **frontend** is configured to use Vercel; this backend is referenced at a **Render** URL. This repository contains no `vercel.json`, Vercel function entry point or frontend output directory.

For the current process-based backend, install with `npm ci`, start with `node server.js`, and configure `MONGO_URI` in the backend host's environment. Ensure the host can reach MongoDB and supports the application's current port binding.

Deploy the companion frontend using Vercel's **Create React App** preset, build command `npm run build`, output directory `build`, and set `REACT_APP_API_URL` in the Vercel dashboard to the deployed API origin. Do **not** put MongoDB credentials into frontend variables.

Moving this API to Vercel requires adapting the server entry point to the selected Node/Express deployment model and validating MongoDB connection/session behavior; this README does not claim a checked-in Vercel backend deployment exists. No GitHub Actions pipeline is committed.

### Database assistant setup and behavior

1. Deploy this backend revision and keep the existing `MONGO_URI` configured.
2. In Render's environment settings, add `OPENAI_API_KEY` and `OPENAI_MODEL`, then redeploy. Choose a Responses-compatible model available in your API project.
3. Deploy the companion frontend revision. Its Master page links to `/assistant` beside Motor QR Codes.
4. Ask a question such as `CGL mein total motors kitne hain?` or `motor serial SN-123 vibration history`. Results include a timestamp, source collections and record IDs.

Every question reads MongoDB anew; the assistant does not continuously monitor equipment or write records. Without both AI settings, or if the provider fails, it returns clearly labelled basic database summaries. AI mode sends selected projected database fields and bounded conversation context to OpenAI with `store: false`; this does not itself establish a zero-retention policy. No API key is sent to the browser.

Retrieval covers motors, their replacement/vibration/greasing history, cranes and inspections, ACs and repairs, and safety records. Counts cover the matching query; record evidence is capped at 40 rows per collection and 45,000 characters overall. Group breakdowns are capped at 100 groups; strings and nested arrays are shortened. Limits are disclosed in source metadata. This is not an exhaustive arbitrary database query engine: unsupported filters should be narrowed or checked in the relevant equipment page. Safety records do not have a universal plant field; plant filtering applies to equipment and associated history, not the safety collection. Separate reads are not a transactionally consistent snapshot.

Plant, saved equipment status, explicit serial number, bridle number and motor ID narrow supported equipment queries. Follow-ups referring to the same asset can reuse prior user scope. Questions are limited to 1,000 characters; history to six bounded messages. The assistant has a process-local limit of 10 requests/client/minute and three concurrent requests. Behind an unconfigured proxy, clients may share a rate-limit bucket. Database errors produce a retry response, never a fabricated answer. Provider calls time out after 25 seconds.

### Operational considerations

- Current CORS middleware is unrestricted `cors()`; an origin allowlist is not configured.
- There is no built-in authentication or authorization. The assistant has a local rate/concurrency limit; existing write endpoints do not have a general rate limiter. Add the required access controls before exposing operational write endpoints to untrusted users.
- Transactions cover the crane inspection and safety-walk linking flows. Legacy motor replacement, AC repair and generic safety updates write history and current data separately.
- The process starts listening independently of connection success; `GET /` is not a database health check.
- Lists generally return all matching records without server-side pagination. Assess data volume and indexes for the target deployment.

## 🤝 Contributing & License

1. Fork the repository and clone your fork.
2. Create a branch: `git switch -c docs/your-change` or `feature/your-change`.
3. Make focused changes and keep request fields and companion UI behavior aligned.
4. Run the assistant tests and both workflow scripts and any checks appropriate to your change. For database changes, also verify against a replica set.
5. Commit, push your branch and open a pull request with the change and validation results.

**License:** `package.json` declares **ISC**. There is no standalone `LICENSE` file in the repository.

