# BC Telemetry Buddy MCP - Rovo Studio Integration

## Projektziel

BC Telemetry Buddy MCP als Docker-Container auf Azure Kubernetes Service (AKS) hosten und per HTTPS für Rovo Studio Agent in Jira Enterprise exponieren.

---

## Projektstatus

| Phase | Status | Beschreibung |
|-------|--------|--------------|
| SSE Server erstellen | ✅ **Fertig** | `packages/mcp/src/sse-server.ts` mit `SSEServerTransport` |
| API-Key Auth | ✅ **Fertig** | Bearer Token Middleware in sse-server.ts |
| Dockerfile | ✅ **Fertig** | Multi-stage build, non-root, healthcheck |
| Fork auf GitHub | ✅ **Fertig** | https://github.com/MrMomo2/waldo.BCTelemetryBuddy |
| Docker Build | ⏳ **Ausstehend** | Auf anderem PC mit Docker |
| AKS Deployment | ⏳ **Ausstehend** | YAML Files vorbereitet, nicht angewendet |
| Rovo Studio Agent | ⏳ **Ausstehend** | Konfiguration in Atlassian Admin |

---

## Was wurde erstellt

### 1. SSE Server (`packages/mcp/src/sse-server.ts`)

```typescript
// Verwendet offizielles @modelcontextprotocol/sdk
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

// Endpoints:
// GET  /sse      - SSE Verbindung für Rovo
// POST /message  - MCP Message Handling
// GET  /health   - Health Check
```

### 2. Dockerfile (`packages/mcp/Dockerfile`)

- **Base:** node:22-alpine
- **User:** Non-root (appuser:appgroup, uid 1001)
- **Port:** 3000
- **Health Check:** wget auf /health
- **Env Vars:**
  - `PORT=3000` (default)
  - `BCTB_API_KEY` (optional, für Auth)
  - `BCTB_WORKSPACE_PATH` (Konfiguration)
  - `BCTB_CONNECTION_NAME` (Profile name)

---

## Deployment Plan

### Schritt 1: Docker Build (auf PC mit Docker)

```bash
git clone https://github.com/MrMomo2/waldo.BCTelemetryBuddy.git
cd waldo.BCTelemetryBuddy
docker build -t bc-telemetry-sse:latest -f packages/mcp/Dockerfile .
```

### Schritt 2: Azure Container Registry push

```bash
az acr login --name <your-registry>
docker tag bc-telemetry-sse:latest <your-registry>.azurecr.io/bc-telemetry-sse:latest
docker push <your-registry>.azurecr.io/bc-telemetry-sse:latest
```

### Schritt 3: AKS Deployment (Kubernetes YAML unten)

### Schritt 4: Rovo Studio Agent konfigurieren

In Atlassian Admin:
1. Rovo → Rovo Studio → New Agent
2. System Prompt definieren
3. Under Tools → Add MCP Server: HTTPS-URL + API-Key eintragen
4. Agent veröffentlichen

---

## Kubernetes YAML (aks-deployment.yaml)

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: bc-telemetry-sse
spec:
  replicas: 2
  selector:
    matchLabels:
      app: bc-telemetry-sse
  template:
    spec:
      containers:
      - name: sse-server
        image: <your-registry>.azurecr.io/bc-telemetry-sse:latest
        ports:
        - containerPort: 3000
        env:
        - name: PORT
          value: "3000"
        - name: BCTB_API_KEY
          valueFrom:
            secretKeyRef:
              name: bc-telemetry-secrets
              key: api-key
        - name: BCTB_WORKSPACE_PATH
          value: "/app/workspace"
        resources:
          requests:
            memory: "256Mi"
            cpu: "250m"
          limits:
            memory: "512Mi"
            cpu: "500m"
        livenessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 10
          periodSeconds: 30
        readinessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 5
          periodSeconds: 10
---
apiVersion: v1
kind: Service
metadata:
  name: bc-telemetry-sse
spec:
  type: ClusterIP
  ports:
  - port: 3000
    targetPort: 3000
  selector:
    app: bc-telemetry-sse
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: bc-telemetry-sse
  annotations:
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
    nginx.ingress.kubernetes.io/proxy-body-size: "10m"
spec:
  tls:
  - hosts:
    - bctelemetry.yourdomain.com
    secretName: bctelemetry-tls
  rules:
  - host: bctelemetry.yourdomain.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: bc-telemetry-sse
            port:
              number: 3000
```

---

## Secrets erstellen (Azure Key Vault)

```bash
# API Key erstellen
az keyvault secret set \
  --vault-name <your-keyvault> \
  --name bc-telemetry-api-key \
  --value "your-secret-api-key"

# Kubernetes Secret aus Key Vault
az keyvault secret set \
  --vault-name <your-keyvault> \
  --name bctb-connection-string \
  --value "your-connection-string"
```

---

## Verification Tests

### Lokal (Docker):
```bash
# Start
docker run -p 3000:3000 \
  -e BCTB_API_KEY=test-key \
  bc-telemetry-sse:latest

# Health Check
curl http://localhost:3000/health
# Erwartet: {"status":"ok","version":"3.3.12",...}
```

### Rovo Studio:
1. Rovo Chat in Jira öffnen
2. Agent "BC Telemetry Support Bot" auswählen
3. Frage stellen: "Hat Kunde XY in den letzten 24h Fehler gehabt?"
4. Agent sollte query_telemetry Tool aufrufen

---

## Konfiguration (Umgebungsvariablen)

| Variable | Beschreibung | Beispiel |
|----------|--------------|----------|
| `BCTB_API_KEY` | Authentifizierung für Rovo | `my-secret-key` |
| `BCTB_WORKSPACE_PATH` | Pfad für Config/Query Files | `/app/workspace` |
| `BCTB_CONNECTION_NAME` | Profile Name | `veo-system-prod` |
| `BCTB_TENANT_ID` | Azure Tenant ID | `xxx-xxx` |
| `BCTB_APP_INSIGHTS_ID` | App Insights App ID | `xxx` |
| `BCTB_KUSTO_URL` | Kusto Cluster URL | `https://ade.applicationinsights.io/...` |
| `BCTB_AUTH_FLOW` | Auth Methode | `client_credentials` |
| `BCTB_CLIENT_ID` | Azure Client ID | `xxx` |
| `BCTB_CLIENT_SECRET` | Azure Client Secret | `xxx` |

---

## Wichtige Dateien

| Datei | Zweck |
|-------|-------|
| `packages/mcp/src/sse-server.ts` | SSE Server Source |
| `packages/mcp/dist/sse-server.js` | Kompiliert (bereits gebaut) |
| `packages/mcp/Dockerfile` | Container Definition |
| `packages/mcp/src/mcpSdkServer.ts` | MCP SDK Server (Original) |

---

## Ressourcen

- **Waldo's Repo:** https://github.com/waldo1001/waldo.BCTelemetryBuddy
- **Dein Fork:** https://github.com/MrMomo2/waldo.BCTelemetryBuddy
- **MCP SDK:** https://github.com/modelcontextprotocol/spec
- **Rovo Studio:** https://developer.atlassian.com/docs/rovo

---

## Nächste Schritte

1. ⏳ Docker Image bauen (anderer PC)
2. ⏳ Azure Container Registry einrichten
3. ⏳ AKS Deployment anwenden
4. ⏳ NGINX Ingress + TLS konfigurieren
5. ⏳ Rovo Studio Agent anlegen
6. ⏳ Testen & System Prompt iterieren