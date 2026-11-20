// Raíz del sitio (funciona en localhost, Live Server y GitHub Pages /repo/).
export const BASE_URL = new URL('../', import.meta.url);
export const asset = (path) => {
  if (!path) return path;
  if (/^https?:\/\//i.test(path)) return path;
  return new URL(String(path).replace(/^\//, ''), BASE_URL).href;
};
