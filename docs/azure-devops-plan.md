# Azure DevOps Integration Plan

## Context
The Claude Team Session app needs Azure DevOps integration so users can browse their backlog, import work items into a session, have agents reference and work on those items, export discussion back to ADO as comments, and mark items done -- all without leaving the app.

## Implementation (11 steps, in order)

### 1. New file: `src/main/azure-devops.js` - API Client
Class wrapping Azure DevOps REST API using Electron's built-in `fetch`.
- **Auth**: OAuth 2.0 flow
  - User provides org name, App ID, and Client Secret (from ADO app registration)
  - Opens system browser to `https://app.vssps.visualstudio.com/oauth2/authorize`
  - Spins up temporary local HTTP server to receive callback with auth code
  - Exchanges code for access_token + refresh_token via POST to `/oauth2/token`
  - Auto-refreshes token when expired
  - API calls use `Authorization: Bearer {access_token}`
- **Methods**:
  - `authenticate(org, appId, clientSecret)` - full OAuth flow (browser + callback server)
  - `disconnect()`, `isConnected()`, `getCredentials()`
  - `getProjects()` - list all projects in the org
  - `getTeams(project)` - list teams for a project
  - `getIterations(project, team)` - get iterations, identify current sprint
  - `getBacklogItems(project, team, iterationPath)` - WIQL query for PBIs/Bugs/Tasks in sprint
  - `getWorkItemDetails(ids[])` - batch fetch details (up to 200 per call)
  - `updateWorkItemState(id, state)` - JSON Patch to change state
  - `addWorkItemComment(project, id, comment)` - POST comment to work item
- All API calls go through `_fetch(url, opts)` helper with auth header
- No external dependencies needed

### 2. `src/main/session-manager.js` - Add work_items table
In `_createSchema()`, add:
```sql
CREATE TABLE IF NOT EXISTS work_items (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  type TEXT NOT NULL,
  state TEXT NOT NULL,
  assigned_to TEXT,
  description TEXT,
  project TEXT NOT NULL,
  url TEXT,
  imported_at TEXT NOT NULL DEFAULT (datetime('now'))
)
```
Add methods: `saveWorkItem()`, `removeWorkItem()`, `getWorkItems()`, `getWorkItem()`, `updateWorkItemState()`, `clearWorkItems()` -- same pattern as existing task methods.

### 3. `src/main/ipc-handlers.js` - Wire up IPC channels
Accept `azureDevOpsClient` as new parameter. Add handlers:
- `devops:connect`, `devops:disconnect`, `devops:isConnected`
- `devops:getProjects`, `devops:getTeams`, `devops:getIterations`
- `devops:getSprintItems`, `devops:getWorkItemDetail`
- `devops:updateState`, `devops:addComment`
- `workitems:import`, `workitems:remove`, `workitems:getAll`, `workitems:get`, `workitems:updateState`

### 4. `src/preload/preload.js` - Expose new APIs
Add `devopsConnect`, `devopsDisconnect`, `devopsIsConnected`, `devopsGetProjects`, `devopsGetTeams`, `devopsGetIterations`, `devopsGetSprintItems`, `devopsUpdateState`, `devopsAddComment`, plus `getWorkItems`, `getWorkItem`, `importWorkItem`, `removeWorkItem`, `updateWorkItemState`.

### 5. `src/main/message-server.js` - Agent-accessible routes
Add `GET /api/workitems` and `GET /api/workitems/:id` so agents can curl to see imported items. Same pattern as `/api/tasks`.

### 6. `src/main/pty-manager.js` - Update agent config
Add a "Work Items" section to the config template documenting the `/api/workitems` endpoints, so agents know how to check what work items are in scope.

### 7. New file: `src/renderer/js/devops-panel.js` - Panel UI
Export `initDevOpsPanel(el)`. Multi-view state machine:
- **Login view**: Org URL + PAT input, Connect button
- **Projects view**: Clickable project list
- **Backlog view**: Team selector, current sprint items listed with type/title/state/assignee. Import button per item, green check for already-imported.
- **Imported view**: Toggle to see only imported items. Each has "Export Discussion" and "Mark Done" buttons.

Toolbar with back button + breadcrumb for navigation, disconnect button.

"Export Discussion" = fetch messages via `getMessages()`, format as readable text, POST as ADO comment.
"Mark Done" = call `devopsUpdateState(id, 'Done')` on ADO + update local DB.

### 8. `src/renderer/js/app.js` - Register component
- Import `initDevOpsPanel`
- Register `'devops'` component factory function with GoldenLayout
- Add menu event handler: `menu:showDevOps` -> `addDockPanelIfMissing('devops', 'Azure DevOps')`

### 9. `src/main/menu.js` - Add menu entry
Add "Show Azure DevOps" to View submenu, sends `menu:showDevOps` event.

### 10. `src/main/main.js` - Instantiate and wire up
- Create `AzureDevOpsClient` instance in `initialize()`
- Pass to `registerIpcHandlers()`
- On session restore: check `session_meta` for stored org/PAT, auto-reconnect if present

### 11. `src/renderer/styles/main.css` - Styling
Add styles for `.devops-inner`, `.devops-toolbar`, `.devops-login-view`, `.devops-item`, type color-coding (blue=PBI, red=Bug, yellow=Task), import/done/export buttons. Follow existing panel patterns.

## Key Design Decisions
- **All ADO API calls happen in main process** (not renderer) -- no CSP changes needed
- **OAuth tokens + app credentials stored in session_meta** -- refresh token enables persistent sessions
- **WIQL queries** for backlog fetching with `@currentIteration` macro
- **Batch work item fetches** using `ids=1,2,3` parameter (up to 200 per call)
- **No new npm dependencies** -- Electron 30's built-in fetch is sufficient

## Verification
1. `npm run build:renderer` to bundle
2. `npm start` to launch
3. View menu -> Show Azure DevOps -> panel appears
4. Enter org + PAT -> Connect -> projects list loads
5. Select project -> select team -> backlog items appear
6. Import a work item -> appears in imported list, agents can `curl /api/workitems`
7. Click "Export Discussion" -> comment appears on ADO work item
8. Click "Mark Done" -> state updates on ADO and locally
