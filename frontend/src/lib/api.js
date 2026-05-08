import axios from "axios";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

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
  return `${API}/files/${storagePath}?auth=${encodeURIComponent(token || "")}`;
};

export default api;
