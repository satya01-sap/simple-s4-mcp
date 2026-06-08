# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run build        # Compile TypeScript → dist/
npm run dev          # Run locally with tsx (no BTP services available locally)
mbt build            # Package MTA archive → .mtar file (requires mbt CLI)
cf deploy mta_archives/simple-s4-mcp_1.0.0.mtar   # Deploy to CF via cf deploy (cf multiapps plugin required)
```

No test suite is configured. No lint script is configured.

## Architecture

MCP server for SAP Business Partner data from **S/4HANA on-premise** via BTP principal propagation.

### Two CF apps

```
approuter/          — @sap/approuter, public-facing
                      handles XSUAA login redirect → stamps JWT on requests
src/index.ts        — MCP server, internal CF route only
                      Express + StreamableHTTP transport
                      uses SAP Cloud SDK for destination + principal propagation
```

### Auth & identity flow

1. User hits App Router URL (no JWT) → redirected to XSUAA login page
2. XSUAA issues JWT (contains `email`/`user_name`) → App Router forwards to MCP server with `forwardAuthToken: true`
3. MCP server extracts JWT via `retrieveJwt(req)` → logs user identity for audit
4. `executeHttpRequest()` calls Destination Service with user JWT
5. Destination Service (`OAuth2SAMLBearerAssertion`) exchanges JWT → SAML Bearer Assertion
6. Request flows: Connectivity Service → Cloud Connector → S/4HANA on-premise
7. S/4HANA sees the real user identity (not a technical user)

### BTP services required (create before `cf push`)

```bash
cf create-service xsuaa application s4-bp-mcp-xsuaa -c xs-security.json
cf create-service destination lite s4-bp-mcp-destination
cf create-service connectivity lite s4-bp-mcp-connectivity
```

### BTP Destination (configure manually in BTP Cockpit)

```
Name:               S4_ONPREM_PP
Type:               HTTP
URL:                http://<cloud-connector-virtual-host>:<port>
Proxy Type:         OnPremise
Authentication:     OAuth2SAMLBearerAssertion
Audience:           <S/4HANA system ID>
Client Key:         <XSUAA client id>
Token Service URL:  https://<subdomain>.authentication.sap.hana.ondemand.com/oauth/token
```

### Tool exposed

- `get_business_partner` — fetches a Business Partner entity from `API_BUSINESS_PARTNER` OData v2 by supplier ID

### Environment variables (set in manifest.yml)

| Variable | Default | Description |
|---|---|---|
| `DESTINATION_NAME` | `S4_ONPREM_PP` | BTP Destination name |
| `SAP_CLIENT` | `100` | S/4HANA client number |
| `PORT` | `8080` | HTTP port (CF sets this automatically) |

### Key details

- Transport: **Streamable HTTP** (not stdio) — required for remote/BTP deployment
- MCP server has **no public CF route** — only reachable via the App Router through CF internal routing (`apps.internal`)
- Audit log: every tool invocation logs `{user, supplierId, timestamp}` via SAP Cloud SDK logger → appears in BTP Application Logging Service (Kibana)
- `tsconfig.json` uses `"module": "nodenext"` — imports within `src/` must use `.js` extensions
