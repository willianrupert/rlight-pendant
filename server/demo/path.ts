// `node:path` para a demonstração: o pouco que os módulos importam.

export const dirname = (p: string): string => p.replace(/\/[^/]*$/, '') || '/';
export const join = (...parts: string[]): string => parts.join('/').replace(/\/+/g, '/');

export default { dirname, join };
