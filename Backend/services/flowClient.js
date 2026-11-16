import { createHmac } from 'node:crypto';
import { fail } from './payments.js';

export function signFlowParams(params, secret) {
  const text = Object.keys(params).filter(k => k !== 's').sort().map(k => k + String(params[k])).join('');
  return createHmac('sha256', secret).update(text, 'utf8').digest('hex');
}

export function createFlowClient(config, { fetchImpl = fetch } = {}) {
  if (!['integration','production'].includes(config.flowMode) || !config.flowApiKey || !config.flowSecretKey) return null;
  const origin = config.flowMode === 'production' ? 'https://www.flow.cl/api' : 'https://sandbox.flow.cl/api';
  async function request(path, values = {}, method = 'GET') {
    const params = { ...values, apiKey: config.flowApiKey };
    const encoded = new URLSearchParams({ ...params, s: signFlowParams(params, config.flowSecretKey) });
    let response;
    try {
      response = await fetchImpl(origin + path + (method === 'GET' ? `?${encoded}` : ''), {
        method, headers: { Accept: 'application/json', ...(method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
        ...(method === 'POST' ? { body: encoded.toString() } : {}), signal: AbortSignal.timeout(12_000), redirect: 'error'
      });
    } catch { throw Object.assign(fail('Flow no respondió. Conservamos el pedido para verificar el resultado.', 502), { flowDiagnostic: 'NETWORK' }); }
    const data = await response.json().catch(() => null);
    // Do not expose API responses, URLs, signatures or credentials in error messages.
    if (!response.ok || !data || typeof data !== 'object' || Array.isArray(data) || data.code !== undefined) {
      const status=Number.isInteger(response.status)?response.status:0;
      const code=/^-?\d{1,8}$/.test(String(data?.code))?`_CODE_${data.code}`:'';
      throw Object.assign(fail(`No se pudo consultar Flow (HTTP ${status}).`, 502), { flowDiagnostic: `HTTP_${status}${code}` });
    }
    return data;
  }
  return {
    createPayment: params => request('/payment/create', params, 'POST'),
    getStatus: token => request('/payment/getStatus', { token }),
    getStatusByCommerceId: commerceId => request('/payment/getStatusByCommerceId', { commerceId }),
    checkCredentials: async () => {
      const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
      const result = await request('/payment/getPayments', { date, start: 0, limit: 1 });
      if (!Number.isSafeInteger(Number(result.total)) || Number(result.total) < 0 || !Array.isArray(result.data))
        throw fail('Flow no confirmó el acceso de lectura de estas credenciales.', 502);
      return true;
    }
  };
}
