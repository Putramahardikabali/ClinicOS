from dotenv import load_dotenv
from pathlib import Path
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

import os
import uuid
import logging
import bcrypt
import jwt
import requests
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Any, Dict
from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request, UploadFile, File, Form, Query, Header, Response
from fastapi.responses import Response as FastResponse
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, EmailStr

# ---------------- Setup ----------------
mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

JWT_SECRET = os.environ["JWT_SECRET"]
JWT_ALGORITHM = "HS256"
APP_NAME = os.environ.get("APP_NAME", "bodylabbali")
EMERGENT_KEY = os.environ.get("EMERGENT_LLM_KEY")
STORAGE_URL = "https://integrations.emergentagent.com/objstore/api/v1/storage"

ROLES = ["super_admin", "doctor", "therapist", "fo", "manager"]

app = FastAPI(title="Body Lab Bali EMR")
api = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
log = logging.getLogger("emr")

# ---------------- Auth Helpers ----------------
def hash_password(p: str) -> str:
    return bcrypt.hashpw(p.encode(), bcrypt.gensalt()).decode()

def verify_password(p: str, h: str) -> bool:
    return bcrypt.checkpw(p.encode(), h.encode())

def create_token(user_id: str, email: str, role: str) -> str:
    payload = {
        "sub": user_id, "email": email, "role": role,
        "exp": datetime.now(timezone.utc) + timedelta(hours=12),
        "type": "access",
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

async def get_current_user(request: Request) -> dict:
    auth_header = request.headers.get("Authorization", "")
    token = None
    if auth_header.startswith("Bearer "):
        token = auth_header[7:]
    if not token:
        token = request.cookies.get("access_token")
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")
    user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0, "password_hash": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user

def require_roles(*allowed: str):
    async def checker(user: dict = Depends(get_current_user)):
        if user["role"] not in allowed and user["role"] != "super_admin":
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        return user
    return checker

# ---------------- Audit ----------------
async def audit(user: dict, action: str, entity: str, entity_id: str = "", meta: Optional[dict] = None):
    await db.audit_logs.insert_one({
        "id": str(uuid.uuid4()),
        "user_id": user["id"],
        "user_email": user["email"],
        "user_role": user["role"],
        "action": action,
        "entity": entity,
        "entity_id": entity_id,
        "meta": meta or {},
        "created_at": datetime.now(timezone.utc).isoformat(),
    })

# ---------------- Object Storage ----------------
storage_key: Optional[str] = None

def init_storage():
    global storage_key
    if storage_key:
        return storage_key
    try:
        r = requests.post(f"{STORAGE_URL}/init", json={"emergent_key": EMERGENT_KEY}, timeout=30)
        r.raise_for_status()
        storage_key = r.json()["storage_key"]
        return storage_key
    except Exception as e:
        log.error(f"Storage init failed: {e}")
        return None

def put_object(path: str, data: bytes, content_type: str) -> dict:
    key = init_storage()
    if not key:
        raise HTTPException(status_code=500, detail="Storage unavailable")
    r = requests.put(
        f"{STORAGE_URL}/objects/{path}",
        headers={"X-Storage-Key": key, "Content-Type": content_type},
        data=data, timeout=120,
    )
    if r.status_code == 403:
        # refresh
        global storage_key
        storage_key = None
        key = init_storage()
        r = requests.put(
            f"{STORAGE_URL}/objects/{path}",
            headers={"X-Storage-Key": key, "Content-Type": content_type},
            data=data, timeout=120,
        )
    r.raise_for_status()
    return r.json()

def get_object(path: str):
    key = init_storage()
    if not key:
        raise HTTPException(status_code=500, detail="Storage unavailable")
    r = requests.get(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": key}, timeout=60)
    r.raise_for_status()
    return r.content, r.headers.get("Content-Type", "application/octet-stream")

# ---------------- Models ----------------
class LoginIn(BaseModel):
    email: EmailStr
    password: str

class UserOut(BaseModel):
    id: str
    email: str
    name: str
    role: str

class PatientIn(BaseModel):
    full_name: str
    gender: Optional[str] = None
    date_of_birth: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    address: Optional[str] = None
    medical_history: Optional[str] = None
    allergies: Optional[str] = None
    notes: Optional[str] = None

class VisitIn(BaseModel):
    patient_id: str
    visit_type: str  # doctor | therapist
    assigned_to: Optional[str] = None  # user id of doctor/therapist
    chief_complaint: Optional[str] = None
    visit_date: Optional[str] = None

class ClinicalRecordIn(BaseModel):
    anamnesis: Optional[str] = ""
    diagnosis: Optional[str] = ""
    treatment_plan: Optional[str] = ""  # TERAPI
    therapy_notes: Optional[str] = ""
    assessment: Dict[str, Any] = {}  # structured face assessment
    product_used: Optional[str] = ""
    dosage: Optional[str] = ""
    area_treated: Optional[str] = ""
    doctor_notes: Optional[str] = ""
    signature: Optional[str] = ""  # base64 png
    submit: bool = False

class TherapistRecordIn(BaseModel):
    concern_notes: Optional[str] = ""
    body_concern: Optional[str] = ""
    treatment_area: Optional[str] = ""
    contraindication: List[str] = []
    device_used: Optional[str] = ""
    treatment_parameter: Optional[str] = ""
    intensity: Optional[str] = ""
    duration: Optional[str] = ""
    area_treated: Optional[str] = ""
    therapist_notes: Optional[str] = ""
    signature: Optional[str] = ""
    submit: bool = False

class TreatmentItemIn(BaseModel):
    category: str
    name: str
    product_used: Optional[str] = ""
    area_treated: Optional[str] = ""
    quantity: float = 1
    unit_type: str = "session"
    notes: Optional[str] = ""
    price: float = 0

class MappingIn(BaseModel):
    map_type: str  # face | body_front | body_back
    image_data: str  # base64 png
    raw_json: Optional[Any] = None
    notes: Optional[str] = ""

class BillingIn(BaseModel):
    items: List[Dict[str, Any]]  # {name, qty, price, discount}
    discount: float = 0
    payment_method: Optional[str] = ""
    payment_status: str = "unpaid"  # unpaid | paid | partial
    notes: Optional[str] = ""

class UserIn(BaseModel):
    email: EmailStr
    password: Optional[str] = None
    name: str
    role: str

class SettingsIn(BaseModel):
    branding: Optional[Dict[str, Any]] = None
    form_config: Optional[Dict[str, Any]] = None
    mapping_templates: Optional[Dict[str, Any]] = None

# ---------------- Default Settings ----------------
DEFAULT_FACE_SECTIONS = [
    {"key":"skin_quality","label":"Skin Quality","subs":[
        {"key":"thickness","label":"Thickness","options":["Thin","Normal","Thick"]},
        {"key":"hydration","label":"Hydration","options":["Hydrated","Dry"]},
        {"key":"laxity","label":"Laxity","options":["Good","Poor"]},
    ]},
    {"key":"forehead_lines","label":"Forehead Lines","subs":[
        {"key":"static","label":"Static","options":["Observed","Not Observed"]},
        {"key":"dynamic","label":"Dynamic","options":["Observed","Not Observed"]},
    ]},
    {"key":"frown_lines","label":"Frown Lines","subs":[
        {"key":"static","label":"Static","options":["Observed","Not Observed"]},
        {"key":"dynamic","label":"Dynamic","options":["Observed","Not Observed"]},
    ]},
    {"key":"tear_trough","label":"Tear Trough","subs":[
        {"key":"status","label":"","options":["Observed","Not Observed"]},
    ]},
    {"key":"temples","label":"Temples","subs":[
        {"key":"status","label":"","options":["Full","Hollow"]},
    ]},
    {"key":"cheeks","label":"Cheeks","subs":[
        {"key":"status","label":"","options":["Full","Hollow"]},
    ]},
    {"key":"nasolabial_folds","label":"Nasolabial Folds","subs":[
        {"key":"static","label":"Static","options":["Observed","Not Observed"]},
        {"key":"dynamic","label":"Dynamic","options":["Observed","Not Observed"]},
    ]},
    {"key":"marionette_line","label":"Marionette Line","subs":[
        {"key":"static","label":"Static","options":["Observed","Not Observed"]},
        {"key":"projection","label":"Projection","options":["Protruded","Proportionate","Receded"]},
    ]},
    {"key":"lips","label":"Lips","subs":[
        {"key":"thickness","label":"Thickness","options":["Thin","Thick"]},
        {"key":"vermilion_border","label":"Vermilion Border","options":["Defined","Not Defined"]},
        {"key":"cupids_bow","label":"Cupid's Bow","options":["Defined","Not Defined"]},
    ]},
    {"key":"chin","label":"Chin","subs":[
        {"key":"length","label":"Length","options":["Short","Proportionate","Long"]},
        {"key":"projection","label":"Projection","options":["Protruded","Proportionate","Receded"]},
    ]},
    {"key":"jawline","label":"Jaw Line","subs":[
        {"key":"status","label":"","options":["Strong","Weak"]},
    ]},
    {"key":"neck_lines","label":"Neck Lines","subs":[
        {"key":"static","label":"Static","options":["Observed","Not Observed"]},
        {"key":"dynamic","label":"Dynamic","options":["Observed","Not Observed"]},
    ]},
]

DEFAULT_TEMPLATES = {
    "face": {
        "label": "Face outline",
        "svg": '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 500"><ellipse cx="200" cy="220" rx="120" ry="160" fill="none" stroke="#C7BFA7" stroke-width="2"/><circle cx="155" cy="200" r="6" fill="none" stroke="#C7BFA7" stroke-width="1.5"/><circle cx="245" cy="200" r="6" fill="none" stroke="#C7BFA7" stroke-width="1.5"/><path d="M180 250 Q200 270 220 250" fill="none" stroke="#C7BFA7" stroke-width="1.5"/><path d="M165 305 Q200 325 235 305" fill="none" stroke="#C7BFA7" stroke-width="1.5"/></svg>',
    },
    "body_front": {
        "label": "Body front",
        "svg": '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 600"><circle cx="150" cy="60" r="40" fill="none" stroke="#C7BFA7" stroke-width="2"/><path d="M110 100 L100 130 L70 200 L80 320 L100 320 L110 220 L110 350 L120 540 L140 540 L145 360 L155 360 L160 540 L180 540 L190 350 L190 220 L200 320 L220 320 L230 200 L200 130 L190 100 Z" fill="none" stroke="#C7BFA7" stroke-width="2"/></svg>',
    },
    "body_back": {
        "label": "Body back",
        "svg": '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 600"><circle cx="150" cy="60" r="40" fill="none" stroke="#C7BFA7" stroke-width="2"/><path d="M110 100 L100 130 L70 200 L80 320 L100 320 L110 220 L110 350 L120 540 L140 540 L145 360 L155 360 L160 540 L180 540 L190 350 L190 220 L200 320 L220 320 L230 200 L200 130 L190 100 Z" fill="none" stroke="#C7BFA7" stroke-width="2"/><line x1="150" y1="100" x2="150" y2="350" stroke="#C7BFA7" stroke-width="1" stroke-dasharray="4 4"/></svg>',
    },
}

DEFAULT_SETTINGS = {
    "branding": {
        "clinic_name": "Body Lab Bali",
        "tagline": "Aesthetic Clinic · Internal EMR",
        "logo_path": "",  # storage path for logo
        "primary_color": "#8A9A86",
        "primary_hover": "#748470",
        "accent_color": "#D4A373",
        "background": "#FDFBF7",
        "surface": "#FFFFFF",
        "text_primary": "#2D3A33",
    },
    "form_config": {
        "face_sections": DEFAULT_FACE_SECTIONS,
        "contraindications": [
            "Pregnancy", "Breastfeeding", "Active skin infection", "Recent surgery",
            "Pacemaker / metal implant", "Keloid history", "Photosensitivity",
            "Active acne flare", "Anti-coagulant medication", "Open wound in treatment area",
        ],
        "devices": [
            "RF (Radio Frequency)", "HIFU", "Cryolipolysis", "Laser CO2", "IPL",
            "Microneedling", "Ultrasound", "Cavitation", "EMS", "LED Light",
            "Manual / Hands-on", "Other",
        ],
        "treatment_categories": [
            "Injectable", "Filler", "Toxin", "PRP", "Mesotherapy",
            "Laser", "RF", "HIFU", "Cryolipolysis", "Microneedling",
            "Facial", "Body Treatment", "Oral Medication", "Skincare", "Other",
        ],
        "treatment_units": ["session", "ml", "cc", "unit", "vial", "tube", "shot", "minute"],
        "payment_methods": ["Cash", "Debit Card", "Credit Card", "QRIS", "Bank Transfer", "E-Wallet", "Other"],
    },
    "mapping_templates": DEFAULT_TEMPLATES,
}

# ---------------- Auth Endpoints ----------------
@api.post("/auth/login")
async def login(payload: LoginIn, response: Response):
    email = payload.email.lower()
    user = await db.users.find_one({"email": email})
    if not user or not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    token = create_token(user["id"], user["email"], user["role"])
    response.set_cookie("access_token", token, httponly=True, secure=False, samesite="lax", max_age=43200, path="/")
    await audit(user, "login", "auth")
    return {
        "token": token,
        "user": {"id": user["id"], "email": user["email"], "name": user["name"], "role": user["role"]},
    }

@api.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    return user

@api.post("/auth/logout")
async def logout(response: Response, user: dict = Depends(get_current_user)):
    response.delete_cookie("access_token", path="/")
    await audit(user, "logout", "auth")
    return {"ok": True}

# ---------------- Users ----------------
@api.get("/users")
async def list_users(user: dict = Depends(require_roles("super_admin", "fo", "manager"))):
    users = await db.users.find({}, {"_id": 0, "password_hash": 0}).to_list(500)
    return users

@api.post("/admin/users")
async def admin_create_user(payload: UserIn, user: dict = Depends(require_roles("super_admin"))):
    if payload.role not in ROLES:
        raise HTTPException(status_code=400, detail="Invalid role")
    if not payload.password:
        raise HTTPException(status_code=400, detail="Password required")
    email = payload.email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=409, detail="Email already exists")
    new_user = {
        "id": str(uuid.uuid4()),
        "email": email,
        "password_hash": hash_password(payload.password),
        "name": payload.name,
        "role": payload.role,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.users.insert_one(new_user)
    new_user.pop("_id", None); new_user.pop("password_hash", None)
    await audit(user, "create", "user", new_user["id"])
    return new_user

@api.put("/admin/users/{uid}")
async def admin_update_user(uid: str, payload: UserIn, user: dict = Depends(require_roles("super_admin"))):
    if payload.role not in ROLES:
        raise HTTPException(status_code=400, detail="Invalid role")
    upd = {"email": payload.email.lower(), "name": payload.name, "role": payload.role}
    if payload.password:
        upd["password_hash"] = hash_password(payload.password)
    r = await db.users.update_one({"id": uid}, {"$set": upd})
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    await audit(user, "update", "user", uid)
    return await db.users.find_one({"id": uid}, {"_id": 0, "password_hash": 0})

@api.delete("/admin/users/{uid}")
async def admin_delete_user(uid: str, user: dict = Depends(require_roles("super_admin"))):
    if uid == user["id"]:
        raise HTTPException(status_code=400, detail="Cannot delete your own account")
    r = await db.users.delete_one({"id": uid})
    if r.deleted_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    await audit(user, "delete", "user", uid)
    return {"ok": True}

# ---------------- Settings ----------------
@api.get("/settings")
async def get_settings(user: dict = Depends(get_current_user)):
    s = await db.settings.find_one({"id": "global"}, {"_id": 0})
    if not s:
        s = {"id": "global", **DEFAULT_SETTINGS}
        await db.settings.insert_one(s)
        s.pop("_id", None)
    return s

@api.put("/admin/settings")
async def update_settings(payload: SettingsIn, user: dict = Depends(require_roles("super_admin"))):
    upd = {k: v for k, v in payload.model_dump().items() if v is not None}
    await db.settings.update_one({"id": "global"}, {"$set": upd}, upsert=True)
    await audit(user, "update", "settings", "global")
    return await db.settings.find_one({"id": "global"}, {"_id": 0})

@api.post("/admin/logo")
async def upload_logo(file: UploadFile = File(...), user: dict = Depends(require_roles("super_admin"))):
    ext = (file.filename or "").rsplit(".", 1)[-1].lower() or "png"
    if ext not in ("png", "jpg", "jpeg", "webp", "svg"):
        raise HTTPException(status_code=400, detail="Unsupported logo format")
    pid = str(uuid.uuid4())
    path = f"{APP_NAME}/branding/logo-{pid}.{ext}"
    data = await file.read()
    ct = file.content_type or (f"image/{ext}" if ext != "svg" else "image/svg+xml")
    result = put_object(path, data, ct)
    # Persist to settings + create photo-like record so /api/files/{path} can serve it
    await db.photos.insert_one({
        "id": pid, "visit_id": "", "patient_id": "",
        "storage_path": result["path"], "photo_type": "branding", "angle": "logo",
        "content_type": ct, "uploaded_by": user["id"],
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    await db.settings.update_one(
        {"id": "global"},
        {"$set": {"branding.logo_path": result["path"]}},
        upsert=True,
    )
    await audit(user, "upload", "logo", pid)
    return {"logo_path": result["path"]}

# ---------------- Patients ----------------
@api.post("/patients")
async def create_patient(payload: PatientIn, user: dict = Depends(require_roles("super_admin", "fo"))):
    p = payload.model_dump()
    p["id"] = str(uuid.uuid4())
    p["created_at"] = datetime.now(timezone.utc).isoformat()
    p["created_by"] = user["id"]
    await db.patients.insert_one(p)
    p.pop("_id", None)
    await audit(user, "create", "patient", p["id"])
    return p

@api.get("/patients")
async def list_patients(q: Optional[str] = None, user: dict = Depends(get_current_user)):
    flt = {}
    if q:
        flt = {"$or": [
            {"full_name": {"$regex": q, "$options": "i"}},
            {"phone": {"$regex": q, "$options": "i"}},
            {"email": {"$regex": q, "$options": "i"}},
        ]}
    items = await db.patients.find(flt, {"_id": 0}).sort("created_at", -1).to_list(500)
    return items

@api.get("/patients/{pid}")
async def get_patient(pid: str, user: dict = Depends(get_current_user)):
    p = await db.patients.find_one({"id": pid}, {"_id": 0})
    if not p:
        raise HTTPException(status_code=404, detail="Patient not found")
    return p

@api.put("/patients/{pid}")
async def update_patient(pid: str, payload: PatientIn, user: dict = Depends(require_roles("super_admin", "fo"))):
    upd = {k: v for k, v in payload.model_dump().items() if v is not None}
    r = await db.patients.update_one({"id": pid}, {"$set": upd})
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    await audit(user, "update", "patient", pid)
    return await db.patients.find_one({"id": pid}, {"_id": 0})

# ---------------- Visits ----------------
@api.post("/visits")
async def create_visit(payload: VisitIn, user: dict = Depends(require_roles("super_admin", "fo"))):
    v = payload.model_dump()
    v["id"] = str(uuid.uuid4())
    v["status"] = "in_progress"  # in_progress | submitted | billed
    v["created_at"] = datetime.now(timezone.utc).isoformat()
    v["created_by"] = user["id"]
    if not v.get("visit_date"):
        v["visit_date"] = datetime.now(timezone.utc).isoformat()
    await db.visits.insert_one(v)
    v.pop("_id", None)
    await audit(user, "create", "visit", v["id"])
    return v

@api.get("/visits")
async def list_visits(patient_id: Optional[str] = None, status: Optional[str] = None, assigned_to: Optional[str] = None, user: dict = Depends(get_current_user)):
    flt = {}
    if patient_id: flt["patient_id"] = patient_id
    if status: flt["status"] = status
    if assigned_to: flt["assigned_to"] = assigned_to
    items = await db.visits.find(flt, {"_id": 0}).sort("created_at", -1).to_list(500)
    # enrich with patient name
    for v in items:
        p = await db.patients.find_one({"id": v["patient_id"]}, {"_id": 0, "full_name": 1})
        v["patient_name"] = p["full_name"] if p else "Unknown"
    return items

@api.get("/visits/pending-billing")
async def pending_billing(user: dict = Depends(require_roles("super_admin", "fo", "manager"))):
    items = await db.visits.find({"status": "submitted"}, {"_id": 0}).sort("created_at", -1).to_list(500)
    for v in items:
        p = await db.patients.find_one({"id": v["patient_id"]}, {"_id": 0, "full_name": 1})
        v["patient_name"] = p["full_name"] if p else "Unknown"
    return items

@api.get("/visits/{vid}")
async def get_visit(vid: str, user: dict = Depends(get_current_user)):
    v = await db.visits.find_one({"id": vid}, {"_id": 0})
    if not v:
        raise HTTPException(status_code=404, detail="Visit not found")
    p = await db.patients.find_one({"id": v["patient_id"]}, {"_id": 0})
    v["patient"] = p
    v["clinical_record"] = await db.clinical_records.find_one({"visit_id": vid}, {"_id": 0})
    v["therapist_record"] = await db.therapist_records.find_one({"visit_id": vid}, {"_id": 0})
    v["treatment_items"] = await db.treatment_items.find({"visit_id": vid}, {"_id": 0}).to_list(200)
    v["photos"] = await db.photos.find({"visit_id": vid}, {"_id": 0}).to_list(200)
    v["mappings"] = await db.mappings.find({"visit_id": vid}, {"_id": 0}).to_list(50)
    v["billing"] = await db.billings.find_one({"visit_id": vid}, {"_id": 0})
    if v.get("assigned_to"):
        u = await db.users.find_one({"id": v["assigned_to"]}, {"_id": 0, "name": 1, "role": 1})
        v["assigned_user"] = u
    return v

# ---------------- Clinical Record (Doctor) ----------------
@api.put("/visits/{vid}/clinical")
async def upsert_clinical(vid: str, payload: ClinicalRecordIn, user: dict = Depends(require_roles("super_admin", "doctor"))):
    visit = await db.visits.find_one({"id": vid})
    if not visit:
        raise HTTPException(status_code=404, detail="Visit not found")
    # If already submitted, only super_admin can edit
    existing = await db.clinical_records.find_one({"visit_id": vid})
    if existing and existing.get("submitted") and user["role"] != "super_admin":
        raise HTTPException(status_code=403, detail="Clinical record already submitted")
    data = payload.model_dump()
    data["visit_id"] = vid
    data["doctor_id"] = user["id"]
    data["doctor_name"] = user["name"]
    data["updated_at"] = datetime.now(timezone.utc).isoformat()
    submit = data.pop("submit", False)
    if submit:
        data["submitted"] = True
        data["submitted_at"] = datetime.now(timezone.utc).isoformat()
    await db.clinical_records.update_one({"visit_id": vid}, {"$set": data}, upsert=True)
    if submit:
        await db.visits.update_one({"id": vid}, {"$set": {"status": "submitted"}})
    await audit(user, "submit" if submit else "save", "clinical_record", vid)
    return await db.clinical_records.find_one({"visit_id": vid}, {"_id": 0})

# ---------------- Therapist Record ----------------
@api.put("/visits/{vid}/therapist")
async def upsert_therapist(vid: str, payload: TherapistRecordIn, user: dict = Depends(require_roles("super_admin", "therapist"))):
    visit = await db.visits.find_one({"id": vid})
    if not visit:
        raise HTTPException(status_code=404, detail="Visit not found")
    existing = await db.therapist_records.find_one({"visit_id": vid})
    if existing and existing.get("submitted") and user["role"] != "super_admin":
        raise HTTPException(status_code=403, detail="Therapist record already submitted")
    data = payload.model_dump()
    data["visit_id"] = vid
    data["therapist_id"] = user["id"]
    data["therapist_name"] = user["name"]
    data["updated_at"] = datetime.now(timezone.utc).isoformat()
    submit = data.pop("submit", False)
    if submit:
        data["submitted"] = True
        data["submitted_at"] = datetime.now(timezone.utc).isoformat()
    await db.therapist_records.update_one({"visit_id": vid}, {"$set": data}, upsert=True)
    if submit:
        await db.visits.update_one({"id": vid}, {"$set": {"status": "submitted"}})
    await audit(user, "submit" if submit else "save", "therapist_record", vid)
    return await db.therapist_records.find_one({"visit_id": vid}, {"_id": 0})

# ---------------- Treatment Items ----------------
@api.post("/visits/{vid}/treatments")
async def add_treatment(vid: str, payload: TreatmentItemIn, user: dict = Depends(require_roles("super_admin", "doctor", "therapist"))):
    item = payload.model_dump()
    item["id"] = str(uuid.uuid4())
    item["visit_id"] = vid
    item["created_by"] = user["id"]
    item["created_at"] = datetime.now(timezone.utc).isoformat()
    await db.treatment_items.insert_one(item)
    item.pop("_id", None)
    await audit(user, "create", "treatment_item", item["id"])
    return item

@api.delete("/visits/{vid}/treatments/{iid}")
async def delete_treatment(vid: str, iid: str, user: dict = Depends(require_roles("super_admin", "doctor", "therapist"))):
    await db.treatment_items.delete_one({"id": iid, "visit_id": vid})
    await audit(user, "delete", "treatment_item", iid)
    return {"ok": True}

# ---------------- Photos ----------------
@api.post("/visits/{vid}/photos")
async def upload_photo(
    vid: str,
    file: UploadFile = File(...),
    photo_type: str = Form(...),
    angle: str = Form(...),
    notes: str = Form(""),
    user: dict = Depends(require_roles("super_admin", "doctor", "therapist", "fo")),
):
    visit = await db.visits.find_one({"id": vid})
    if not visit:
        raise HTTPException(status_code=404, detail="Visit not found")
    ext = (file.filename or "").rsplit(".", 1)[-1].lower() or "jpg"
    if ext not in ("jpg", "jpeg", "png", "webp"):
        ext = "jpg"
    pid = str(uuid.uuid4())
    path = f"{APP_NAME}/visits/{vid}/{pid}.{ext}"
    data = await file.read()
    result = put_object(path, data, file.content_type or f"image/{ext}")
    rec = {
        "id": pid,
        "visit_id": vid,
        "patient_id": visit["patient_id"],
        "storage_path": result["path"],
        "photo_type": photo_type,
        "angle": angle,
        "notes": notes,
        "content_type": file.content_type or f"image/{ext}",
        "uploaded_by": user["id"],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.photos.insert_one(rec)
    rec.pop("_id", None)
    await audit(user, "upload", "photo", pid)
    return rec

@api.delete("/visits/{vid}/photos/{pid}")
async def delete_photo(vid: str, pid: str, user: dict = Depends(require_roles("super_admin", "doctor", "therapist", "fo"))):
    await db.photos.delete_one({"id": pid, "visit_id": vid})
    await audit(user, "delete", "photo", pid)
    return {"ok": True}

@api.get("/files/{path:path}")
async def serve_file(path: str, auth: Optional[str] = Query(None), authorization: Optional[str] = Header(None)):
    rec = await db.photos.find_one({"storage_path": path})
    if not rec:
        raise HTTPException(status_code=404, detail="File not found")
    # Branding assets (logo) are publicly accessible — needed on login page
    if rec.get("photo_type") != "branding":
        token = None
        if authorization and authorization.startswith("Bearer "):
            token = authorization[7:]
        elif auth:
            token = auth
        if not token:
            raise HTTPException(status_code=401, detail="Auth required")
        try:
            jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        except Exception:
            raise HTTPException(status_code=401, detail="Invalid token")
    data, ct = get_object(path)
    return FastResponse(content=data, media_type=rec.get("content_type", ct))

@api.get("/branding")
async def public_branding():
    s = await db.settings.find_one({"id": "global"}, {"_id": 0, "branding": 1})
    return (s or {}).get("branding", DEFAULT_SETTINGS["branding"])

# ---------------- Mappings ----------------
@api.post("/visits/{vid}/mappings")
async def upsert_mapping(vid: str, payload: MappingIn, user: dict = Depends(require_roles("super_admin", "doctor", "therapist"))):
    rec = payload.model_dump()
    rec["id"] = str(uuid.uuid4())
    rec["visit_id"] = vid
    rec["created_by"] = user["id"]
    rec["created_at"] = datetime.now(timezone.utc).isoformat()
    await db.mappings.insert_one(rec)
    rec.pop("_id", None)
    await audit(user, "save", "mapping", rec["id"])
    return rec

@api.delete("/visits/{vid}/mappings/{mid}")
async def delete_mapping(vid: str, mid: str, user: dict = Depends(require_roles("super_admin", "doctor", "therapist"))):
    await db.mappings.delete_one({"id": mid, "visit_id": vid})
    return {"ok": True}

# ---------------- Billing ----------------
@api.put("/visits/{vid}/billing")
async def upsert_billing(vid: str, payload: BillingIn, user: dict = Depends(require_roles("super_admin", "fo"))):
    visit = await db.visits.find_one({"id": vid})
    if not visit:
        raise HTTPException(status_code=404, detail="Visit not found")
    items = payload.items or []
    subtotal = 0.0
    for it in items:
        qty = float(it.get("qty", 1))
        price = float(it.get("price", 0))
        line_disc = float(it.get("discount", 0))
        subtotal += (qty * price) - line_disc
    total = max(0.0, subtotal - float(payload.discount or 0))
    data = {
        "visit_id": vid,
        "items": items,
        "discount": payload.discount,
        "subtotal": subtotal,
        "total": total,
        "payment_method": payload.payment_method,
        "payment_status": payload.payment_status,
        "notes": payload.notes,
        "updated_by": user["id"],
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.billings.update_one({"visit_id": vid}, {"$set": data}, upsert=True)
    if payload.payment_status == "paid":
        await db.visits.update_one({"id": vid}, {"$set": {"status": "billed"}})
    await audit(user, "billing", "visit", vid, {"total": total, "status": payload.payment_status})
    return await db.billings.find_one({"visit_id": vid}, {"_id": 0})

# ---------------- History Timeline ----------------
@api.get("/patients/{pid}/timeline")
async def patient_timeline(pid: str, user: dict = Depends(get_current_user)):
    visits = await db.visits.find({"patient_id": pid}, {"_id": 0}).sort("created_at", -1).to_list(500)
    for v in visits:
        v["clinical_record"] = await db.clinical_records.find_one({"visit_id": v["id"]}, {"_id": 0})
        v["therapist_record"] = await db.therapist_records.find_one({"visit_id": v["id"]}, {"_id": 0})
        v["treatment_items"] = await db.treatment_items.find({"visit_id": v["id"]}, {"_id": 0}).to_list(50)
        v["photo_count"] = await db.photos.count_documents({"visit_id": v["id"]})
        v["billing"] = await db.billings.find_one({"visit_id": v["id"]}, {"_id": 0})
    return visits

# ---------------- Audit Log ----------------
@api.get("/audit-logs")
async def list_audit(limit: int = 200, user: dict = Depends(require_roles("super_admin", "manager"))):
    logs = await db.audit_logs.find({}, {"_id": 0}).sort("created_at", -1).to_list(limit)
    return logs

# ---------------- Stats ----------------
@api.get("/stats")
async def stats(user: dict = Depends(get_current_user)):
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    total_patients = await db.patients.count_documents({})
    total_visits = await db.visits.count_documents({})
    pending_billing = await db.visits.count_documents({"status": "submitted"})
    in_progress = await db.visits.count_documents({"status": "in_progress"})
    billed = await db.visits.count_documents({"status": "billed"})
    visits_today = await db.visits.count_documents({"visit_date": {"$regex": f"^{today}"}})
    return {
        "total_patients": total_patients,
        "total_visits": total_visits,
        "pending_billing": pending_billing,
        "in_progress": in_progress,
        "billed": billed,
        "visits_today": visits_today,
    }

app.include_router(api)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_origin_regex=".*",
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------- Seed & Indexes ----------------
DEMO_USERS = [
    {"email": "admin@bodylab.id", "password": "password123", "name": "Super Admin", "role": "super_admin"},
    {"email": "doctor@bodylab.id", "password": "password123", "name": "Dr. Maya Putri", "role": "doctor"},
    {"email": "therapist@bodylab.id", "password": "password123", "name": "Sari Therapist", "role": "therapist"},
    {"email": "fo@bodylab.id", "password": "password123", "name": "Front Office", "role": "fo"},
    {"email": "manager@bodylab.id", "password": "password123", "name": "Clinic Manager", "role": "manager"},
]

@app.on_event("startup")
async def startup():
    await db.users.create_index("email", unique=True)
    await db.patients.create_index("full_name")
    await db.visits.create_index("patient_id")
    await db.audit_logs.create_index("created_at")
    for u in DEMO_USERS:
        existing = await db.users.find_one({"email": u["email"]})
        if not existing:
            await db.users.insert_one({
                "id": str(uuid.uuid4()),
                "email": u["email"],
                "password_hash": hash_password(u["password"]),
                "name": u["name"],
                "role": u["role"],
                "created_at": datetime.now(timezone.utc).isoformat(),
            })
    init_storage()
    # Seed default settings
    if not await db.settings.find_one({"id": "global"}):
        await db.settings.insert_one({"id": "global", **DEFAULT_SETTINGS})
    log.info("Body Lab Bali EMR ready")

@app.on_event("shutdown")
async def shutdown():
    client.close()
