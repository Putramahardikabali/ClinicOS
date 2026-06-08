# Deploy ClinicOS on Dokploy

Production uses **`docker-compose.prod.yml`** at the repository root. The existing **`docker-compose.yml`** is for local development only (local MongoDB, bind mounts, `--reload`).

---

## Architecture

| Public URL | Service | Container port |
|------------|---------|------------------|
| https://app.clinicos.id | `frontend` (nginx) | 80 |
| https://api.clinicos.id | `backend` (uvicorn) | 8000 |

- **Database:** MongoDB Atlas via `MONGO_URL` (no `mongo` service in production compose).
- **Uploads:** Docker volume `clinicos_uploads` mounted at `/app/uploads` on the backend.

---

## 1) Prepare environment file

On the Dokploy server (project root, same folder as `docker-compose.prod.yml`):

```bash
cp .env.production.example .env
```

Edit `.env` with real values:

- Atlas connection string in `MONGO_URL`
- Strong `JWT_SECRET` and `SUPER_ADMIN_PASSWORD`
- `VITE_API_BASE_URL=https://api.clinicos.id` (baked into the frontend image at build time)
- `VITE_DEMO_PASSWORD=…` for the public `/demo` login page (optional; without it, demo role cards show “Coming soon”). **Warning:** this value is embedded in the frontend bundle — use only for Demo Clinic accounts with fake data.

Never commit `.env` to git.

---

## 2) Configure Dokploy

1. Create a **Docker Compose** application pointing at this repo.
2. Set the compose file to **`docker-compose.prod.yml`** (not `docker-compose.yml`).
3. Paste or upload environment variables from `.env` in Dokploy’s env UI (or keep `env_file: .env` on the host).
4. Add a **persistent volume** mapping:
   - Volume name: `clinicos_uploads`
   - Mount path in backend: `/app/uploads`

5. **Domain routing** (Dokploy reverse proxy / Traefik):
   - `app.clinicos.id` → service `frontend`, port **80**
   - `api.clinicos.id` → service `backend`, port **8000**

Do **not** deploy the local `mongo` service from `docker-compose.yml`.

Do **not** publish fixed host ports `8000:8000` unless your Dokploy setup requires it; internal `expose` is enough when Dokploy routes by service name.

---

## 3) Build and deploy

```bash
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d
```

Rebuild the frontend after changing `VITE_API_BASE_URL`, `VITE_DEMO_PASSWORD`, or other frontend build args.

---

## 4) DNS

Point DNS A/CNAME records to your Dokploy host:

- `app.clinicos.id`
- `api.clinicos.id`

Enable TLS in Dokploy for both domains.

---

## 5) Post-deploy checks

- `GET https://api.clinicos.id/api/health` (or login) returns 200
- `https://app.clinicos.id` loads the SPA
- Upload a clinic logo; file appears under `/app/uploads` on the backend volume
- `GET https://api.clinicos.id/uploads/...` serves public branding paths as configured

---

## 6) Local development (unchanged)

```bash
docker compose up
```

Uses `docker-compose.yml`: local MongoDB, backend bind mount, `uvicorn --reload`, no frontend container.

---

## File reference

| File | Purpose |
|------|---------|
| `docker-compose.prod.yml` | Production services (backend + frontend) |
| `docker-compose.yml` | Local dev (mongo + backend) |
| `backend/Dockerfile` | Production API image |
| `backend/requirements-prod.txt` | Installable runtime dependencies |
| `frontend/Dockerfile` | CRA build + nginx |
| `frontend/nginx.conf` | SPA routing, PWA cache headers |
| `.env.production.example` | Template for Dokploy `.env` |
