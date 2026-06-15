import axios from 'axios';
import { auth } from '../firebase';

export const api = axios.create({
  baseURL: '/api',
  headers: {
    'Content-Type': 'application/json',
  },
});

export const formApi = axios.create({
  baseURL: '/api',
  // Let browser set Content-Type for multipart/form-data (needed for file boundaries)
});

// Attach Firebase ID token to every request
const attachToken = async (config: any) => {
  const user = auth.currentUser;
  if (user) {
    const token = await user.getIdToken();
    config.headers = config.headers ?? {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
};

api.interceptors.request.use(attachToken);
formApi.interceptors.request.use(attachToken);
