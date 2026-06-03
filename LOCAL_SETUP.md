# Local development setup (Windows)

Login at http://localhost:3000/login only works when **MongoDB** and the **backend API** are running.

## Quick check

| Service | Port | Status when broken |
|---------|------|-------------------|
| Frontend (CRA) | 3000 | Page loads, login fails |
| Backend (FastAPI) | 8000 | Connection refused |
| MongoDB | 27017 | Backend crashes on startup |

## 1. Docker Desktop (recommended)

Start **Docker Desktop**, then:

```powershell
cd D:\ClinicOS\ClinicOS
docker compose up -d --build
```

This runs **MongoDB** + **backend** on ports `27017` and `8000`.

Check logs:

```powershell
docker compose logs -f backend
```

Wait for: `ClinicOS multi-tenant ready`

Optional — seed demo data (run once):

```powershell
docker compose exec backend python seed_demo_clinics.py
docker compose exec backend python seed_glow_staff.py
```

Stop everything:

```powershell
docker compose down
```

## 2. Manual MongoDB + backend (no Docker)

**MongoDB Community Server** — install from https://www.mongodb.com/try/download/community

**Backend:**

```powershell
cd D:\ClinicOS\ClinicOS\backend
py -3.10 -m pip install -r requirements-dev.txt
py -3.10 -m uvicorn server:app --reload --host 127.0.0.1 --port 8000
```

Optional seeds:

```powershell
py -3.10 seed_demo_clinics.py
py -3.10 seed_glow_staff.py
```

## 3. Start the frontend (restart after .env changes)

```powershell
cd D:\ClinicOS\ClinicOS\frontend
npm start
```

`frontend/.env` should contain:

```
REACT_APP_BACKEND_URL=http://localhost:8000
```

## 4. Test login

| Email | Password |
|-------|----------|
| `admin@bodylab.id` | `password123` |
| `owner@glowclinic.id` | `password123` |
| `doctor@glowclinic.id` | `password123` (after `seed_glow_staff.py`) |

Platform admin console: http://localhost:3000/superadmin — `platform@clinicos.id` / `ChangeMe123!`

## Verify API manually

```powershell
py -3.10 backend\scripts\test_login.py
```

You should see `OK` lines for `http://localhost:8000`, not `connection refused`.
