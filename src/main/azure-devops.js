const { shell } = require('electron');
const http = require('http');
const crypto = require('crypto');

// Registered in Azure Portal (Entra ID) — multi-tenant + personal accounts
const CLIENT_ID = '7f4d21c1-848c-4a87-98db-6a22399887a8';
const AUTHORITY = 'https://login.microsoftonline.com/common';
const SCOPES = '499b84ac-1321-427f-aa17-267ca6975798/.default offline_access';
// 499b84ac... is the well-known resource ID for Azure DevOps

class AzureDevOpsClient {
  constructor() {
    this.org = null;
    this.authMethod = null; // 'oauth' or 'pat'
    this.accessToken = null;
    this.refreshToken = null;
    this.tokenExpiry = null;
    this.pat = null;
  }

  /**
   * Start the Entra ID OAuth 2.0 + PKCE flow.
   * Opens the user's browser to the Microsoft login page,
   * spins up a temporary local HTTP server to receive the callback,
   * and exchanges the auth code for access + refresh tokens.
   * No client secret needed — PKCE handles it.
   */
  async authenticate(org) {
    this.org = org;
    this.authMethod = 'oauth';

    // Generate PKCE code verifier and challenge
    const codeVerifier = this._generateCodeVerifier();
    const codeChallenge = await this._generateCodeChallenge(codeVerifier);

    // Find a free port and start callback server
    const { port, server, codePromise } = await this._startCallbackServer();
    const redirectUri = `http://localhost:${port}/callback`;
    const state = crypto.randomUUID();

    // Build authorization URL (Entra ID with PKCE)
    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      response_type: 'code',
      redirect_uri: redirectUri,
      scope: SCOPES,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      prompt: 'select_account',
    });
    const authUrl = `${AUTHORITY}/oauth2/v2.0/authorize?${params.toString()}`;

    // Open browser
    shell.openExternal(authUrl);

    // Wait for the callback (with timeout)
    let result;
    try {
      result = await Promise.race([
        codePromise,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Sign-in timed out after 5 minutes. Please try again.')), 5 * 60 * 1000)
        ),
      ]);
    } finally {
      this._stopCallbackServer(server);
    }

    // Check for errors from the callback
    if (result.error) {
      const msg = this._friendlyAuthError(result.error, result.errorDescription);
      throw new Error(msg);
    }

    // Exchange code for tokens using PKCE
    await this._exchangeCodeForToken(result.code, redirectUri, codeVerifier);

    // Validate the connection
    await this._validateConnection();
  }

  /**
   * Authenticate using a Personal Access Token (for personal accounts).
   */
  async authenticateWithPat(org, pat) {
    this.org = org;
    this.authMethod = 'pat';
    this.pat = pat;
    this.accessToken = null;
    this.refreshToken = null;
    this.tokenExpiry = null;

    await this._validateConnection();
  }

  /**
   * Reconnect using stored credentials. No browser needed.
   */
  async reconnect(org, authMethod, refreshToken, pat) {
    this.org = org;
    this.authMethod = authMethod || 'oauth';

    if (this.authMethod === 'pat') {
      this.pat = pat;
      await this._validateConnection();
    } else {
      this.refreshToken = refreshToken;
      await this._refreshAccessToken();
      await this._validateConnection();
    }
  }

  disconnect() {
    this.org = null;
    this.authMethod = null;
    this.accessToken = null;
    this.refreshToken = null;
    this.tokenExpiry = null;
    this.pat = null;
  }

  isConnected() {
    return !!((this.accessToken || this.pat) && this.org);
  }

  getCredentials() {
    return {
      org: this.org,
      authMethod: this.authMethod,
      refreshToken: this.refreshToken,
      pat: this.pat,
    };
  }

  // --- Azure DevOps API methods ---

  async getProjects() {
    const res = await this._api(`https://dev.azure.com/${this.org}/_apis/projects?api-version=7.1`);
    return res.value;
  }

  async getTeams(project) {
    const res = await this._api(
      `https://dev.azure.com/${this.org}/_apis/projects/${encodeURIComponent(project)}/teams?api-version=7.1`
    );
    return res.value;
  }

  async getIterations(project, team) {
    const res = await this._api(
      `https://dev.azure.com/${this.org}/${encodeURIComponent(project)}/${encodeURIComponent(team)}/_apis/work/teamsettings/iterations?api-version=7.1`
    );
    return res.value;
  }

  async getCurrentIteration(project, team) {
    const res = await this._api(
      `https://dev.azure.com/${this.org}/${encodeURIComponent(project)}/${encodeURIComponent(team)}/_apis/work/teamsettings/iterations?$timeframe=current&api-version=7.1`
    );
    return res.value && res.value.length > 0 ? res.value[0] : null;
  }

  /**
   * Query work items in a given iteration using WIQL.
   */
  async queryIterationWorkItems(project, iterationPath) {
    const wiql = `SELECT [System.Id] FROM WorkItems WHERE [System.IterationPath] = '${iterationPath}' AND [System.WorkItemType] IN ('Product Backlog Item', 'Bug', 'Task', 'User Story', 'Feature') ORDER BY [Microsoft.VSTS.Common.BacklogPriority] ASC`;
    const res = await this._api(
      `https://dev.azure.com/${this.org}/${encodeURIComponent(project)}/_apis/wit/wiql?api-version=7.1`,
      {
        method: 'POST',
        body: JSON.stringify({ query: wiql }),
      }
    );
    return res.workItems || [];
  }

  /**
   * Fetch full details for a batch of work item IDs (up to 200).
   */
  async getWorkItemDetails(ids) {
    if (!ids || ids.length === 0) return [];
    const results = [];
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200);
      const idStr = chunk.join(',');
      const res = await this._api(
        `https://dev.azure.com/${this.org}/_apis/wit/workitems?ids=${idStr}&$expand=none&api-version=7.1`
      );
      if (res.value) results.push(...res.value);
    }
    return results.map((wi) => ({
      id: wi.id,
      title: wi.fields['System.Title'],
      type: wi.fields['System.WorkItemType'],
      state: wi.fields['System.State'],
      assignedTo: wi.fields['System.AssignedTo']
        ? wi.fields['System.AssignedTo'].displayName
        : null,
      description: wi.fields['System.Description'] || '',
      project: wi.fields['System.TeamProject'],
      url: wi._links && wi._links.html ? wi._links.html.href : `https://dev.azure.com/${this.org}/${wi.fields['System.TeamProject']}/_workitems/edit/${wi.id}`,
      iterationPath: wi.fields['System.IterationPath'],
    }));
  }

  /**
   * Create a new work item (PBI, Bug, etc.) in the given project.
   */
  async createWorkItem(project, type, fields) {
    const body = [
      { op: 'add', path: '/fields/System.Title', value: fields.title },
    ];
    if (fields.description) {
      body.push({ op: 'add', path: '/fields/System.Description', value: fields.description });
    }
    if (fields.iterationPath) {
      body.push({ op: 'add', path: '/fields/System.IterationPath', value: fields.iterationPath });
    }
    if (fields.assignedTo) {
      body.push({ op: 'add', path: '/fields/System.AssignedTo', value: fields.assignedTo });
    }
    if (fields.acceptanceCriteria) {
      body.push({ op: 'add', path: '/fields/Microsoft.VSTS.Common.AcceptanceCriteria', value: fields.acceptanceCriteria });
    }
    if (fields.reproSteps) {
      body.push({ op: 'add', path: '/fields/Microsoft.VSTS.TCM.ReproSteps', value: fields.reproSteps });
    }
    const encodedType = encodeURIComponent('$' + type);
    const res = await this._api(
      `https://dev.azure.com/${this.org}/${encodeURIComponent(project)}/_apis/wit/workitems/${encodedType}?api-version=7.1`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json-patch+json' },
        body: JSON.stringify(body),
      }
    );
    return {
      id: res.id,
      title: res.fields['System.Title'],
      type: res.fields['System.WorkItemType'],
      state: res.fields['System.State'],
      assignedTo: res.fields['System.AssignedTo'] ? res.fields['System.AssignedTo'].displayName : null,
      description: res.fields['System.Description'] || '',
      project: res.fields['System.TeamProject'],
      url: res._links && res._links.html ? res._links.html.href : `https://dev.azure.com/${this.org}/${project}/_workitems/edit/${res.id}`,
    };
  }

  async updateWorkItemState(id, state) {
    await this._api(
      `https://dev.azure.com/${this.org}/_apis/wit/workitems/${id}?api-version=7.1`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json-patch+json' },
        body: JSON.stringify([
          { op: 'replace', path: '/fields/System.State', value: state },
        ]),
      }
    );
  }

  async addWorkItemComment(project, id, comment) {
    await this._api(
      `https://dev.azure.com/${this.org}/${encodeURIComponent(project)}/_apis/wit/workitems/${id}/comments?api-version=7.1-preview.4`,
      {
        method: 'POST',
        body: JSON.stringify({ text: comment }),
      }
    );
  }

  // --- Internal helpers ---

  async _api(url, opts = {}) {
    let authHeader;

    if (this.authMethod === 'pat') {
      if (!this.pat) throw new Error('Not authenticated. Please sign in first.');
      authHeader = `Basic ${Buffer.from(':' + this.pat).toString('base64')}`;
    } else {
      if (this.tokenExpiry && Date.now() > this.tokenExpiry - 60000) {
        await this._refreshAccessToken();
      }
      if (!this.accessToken) throw new Error('Not authenticated. Please sign in first.');
      authHeader = `Bearer ${this.accessToken}`;
    }

    const headers = {
      Authorization: authHeader,
      'Content-Type': 'application/json',
      ...opts.headers,
    };

    const response = await fetch(url, { ...opts, headers });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Azure DevOps API error ${response.status}: ${text}`);
    }

    return response.json();
  }

  _generateCodeVerifier() {
    // 43-128 character random string (RFC 7636)
    return crypto.randomBytes(64).toString('base64url').slice(0, 128);
  }

  async _generateCodeChallenge(verifier) {
    // SHA256 hash of verifier, base64url encoded
    const hash = crypto.createHash('sha256').update(verifier).digest();
    return hash.toString('base64url');
  }

  async _exchangeCodeForToken(code, redirectUri, codeVerifier) {
    const body = new URLSearchParams({
      client_id: CLIENT_ID,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
      scope: SCOPES,
    });

    const response = await fetch(`${AUTHORITY}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      const msg = this._friendlyAuthError(data.error, data.error_description);
      throw new Error(msg);
    }

    const data = await response.json();
    this.accessToken = data.access_token;
    this.refreshToken = data.refresh_token;
    this.tokenExpiry = Date.now() + (data.expires_in || 3599) * 1000;
  }

  async _refreshAccessToken() {
    if (!this.refreshToken) {
      throw new Error('Session expired. Please sign in again.');
    }

    const body = new URLSearchParams({
      client_id: CLIENT_ID,
      grant_type: 'refresh_token',
      refresh_token: this.refreshToken,
      scope: SCOPES,
    });

    const response = await fetch(`${AUTHORITY}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!response.ok) {
      this.accessToken = null;
      this.refreshToken = null;
      this.tokenExpiry = null;
      const data = await response.json().catch(() => ({}));
      const msg = this._friendlyAuthError(data.error, data.error_description);
      throw new Error(`${msg} Please sign in again.`);
    }

    const data = await response.json();
    this.accessToken = data.access_token;
    this.refreshToken = data.refresh_token;
    this.tokenExpiry = Date.now() + (data.expires_in || 3599) * 1000;
  }

  async _validateConnection() {
    const res = await this._api(
      `https://dev.azure.com/${this.org}/_apis/projects?$top=1&api-version=7.1`
    );
    if (!res.value) {
      throw new Error('Failed to validate Azure DevOps connection');
    }
  }

  /**
   * Map Entra ID error codes to user-friendly messages.
   */
  _friendlyAuthError(error, description) {
    if (!error) return description || 'Authentication failed.';

    if (error === 'access_denied') {
      return 'Sign-in was cancelled or access was denied.';
    }
    if (description && description.includes('AADSTS65001')) {
      return 'Your organization requires admin approval for this app. Please contact your IT admin and ask them to grant consent for "Claude Team Session".';
    }
    if (description && description.includes('AADSTS650057')) {
      return 'Your organization requires admin approval for this app. Please contact your IT admin and ask them to grant consent for "Claude Team Session".';
    }
    if (description && description.includes('AADSTS70011')) {
      return 'Invalid permissions requested. Please contact support.';
    }
    if (description && description.includes('AADSTS50076')) {
      return 'Multi-factor authentication is required. Please complete MFA in the browser and try again.';
    }

    return description || `Authentication error: ${error}`;
  }

  /**
   * Start a temporary HTTP server to receive the OAuth callback.
   */
  _startCallbackServer() {
    return new Promise((resolve, reject) => {
      let codeResolve;
      const codePromise = new Promise((res) => { codeResolve = res; });

      const server = http.createServer((req, res) => {
        const url = new URL(req.url, `http://localhost`);
        if (url.pathname === '/callback') {
          const code = url.searchParams.get('code');
          const error = url.searchParams.get('error');
          const errorDescription = url.searchParams.get('error_description');

          if (code) {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(`
              <html>
              <body style="background:#1e1e1e;color:#d4d4d4;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
                <div style="text-align:center">
                  <h1>Authenticated!</h1>
                  <p>You can close this tab and return to Claude Team Session.</p>
                </div>
              </body>
              </html>
            `);
            codeResolve({ code });
          } else {
            const msg = errorDescription || error || 'No authorization code received';
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(`
              <html>
              <body style="background:#1e1e1e;color:#d4d4d4;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
                <div style="text-align:center">
                  <h1>Authentication Failed</h1>
                  <p>${msg.replace(/</g, '&lt;')}</p>
                  <p style="color:#999;margin-top:10px">You can close this tab and try again.</p>
                </div>
              </body>
              </html>
            `);
            codeResolve({ error, errorDescription });
          }
        } else {
          res.writeHead(404);
          res.end();
        }
      });

      server.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        resolve({ port, server, codePromise });
      });

      server.on('error', reject);
    });
  }

  _stopCallbackServer(server) {
    if (server) {
      try { server.close(); } catch (e) { /* ignore */ }
    }
  }
}

module.exports = { AzureDevOpsClient };
