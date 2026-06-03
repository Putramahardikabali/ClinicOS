import axios from "axios";

const BACKEND_URL =
  process.env.VITE_API_BASE_URL ||
  process.env.REACT_APP_BACKEND_URL ||
  (process.env.NODE_ENV === "development" ? "http://localhost:8000" : "");
const PUBLIC_UPLOAD_BASE_URL =
  process.env.REACT_APP_PUBLIC_UPLOAD_BASE_URL ||
  (BACKEND_URL ? `${BACKEND_URL.replace(/\/$/, "")}/uploads` : "");

export const API_BASE = `${BACKEND_URL}/api`;
const API = API_BASE;

const api = axios.create({ baseURL: API });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("bl_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (r) => r,
  (e) => {
    if (e.response?.status === 401 && !window.location.pathname.startsWith("/login")) {
      localStorage.removeItem("bl_token");
      window.location.href = "/login";
    }
    return Promise.reject(e);
  }
);

export const fileUrl = (storagePath) => {
  const token = localStorage.getItem("bl_token");
  if (!storagePath) return "";
  if (PUBLIC_UPLOAD_BASE_URL) {
    return `${PUBLIC_UPLOAD_BASE_URL}/${storagePath}?auth=${encodeURIComponent(token || "")}`;
  }
  return `${API}/files/${storagePath}?auth=${encodeURIComponent(token || "")}`;
};

export default api;
