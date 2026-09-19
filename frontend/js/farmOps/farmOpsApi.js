import { getApi, postApi, putJSON } from '../api.js';

export const farms = () => getApi('/api/farms');
export const createFarm = (body = {}) => postApi('/api/farms', body);
export const regions = () => getApi('/api/auth/options').then((o) => o.regions);
export const today = (farmId, date) => getApi(`/api/farms/${farmId}/today?date=${date}`);
export const tasks = (farmId, query = '') => getApi(`/api/farms/${farmId}/tasks${query ? `?${query}` : ''}`);
export const upcoming = (farmId, from, days = 7) => getApi(`/api/farms/${farmId}/upcoming?from=${from}&days=${days}`);
export const calendar = (farmId, from, to) => getApi(`/api/farms/${farmId}/calendar?from=${from}&to=${to}`);
export const detail = (id) => getApi(`/api/farms/tasks/${id}/detail`);
export const transition = (id, action, body = {}) => postApi(`/api/farms/tasks/${id}/${action}`, body);
export const assign = (id, userId) => postApi(`/api/farms/tasks/${id}/assign`, { userId });
export const reschedule = (id, localDate) => postApi(`/api/farms/tasks/${id}/reschedule`, { localDate });
export const toggleChecklist = (taskId, itemId, completed) => putJSON(`/api/farms/tasks/${taskId}/checklist/${itemId}`, { completed });
export const createTask = (farmId, body) => postApi(`/api/farms/${farmId}/tasks`, body);
export const fields = (farmId) => getApi(`/api/farms/${farmId}/fields`);
export const members = (farmId) => getApi(`/api/farms/${farmId}/members`);
export const records = (farmId) => getApi(`/api/farms/${farmId}/records`);
