/** API 基础地址 - 优先使用环境变量，其次回退到本地开发地址 */
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:4096'
