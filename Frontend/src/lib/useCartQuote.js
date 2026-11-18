import { useEffect, useState } from 'react';
import { api } from './api';

const storageKey = 'malfi_coupon';
export function clearSavedCoupon() {
  try { sessionStorage.removeItem(storageKey); } catch { /* Storage may be unavailable. */ }
}
export const orderLines = items => items.map(({ id, quantity, color, aroma, workshopDate, workshopTime }) =>
  ({ id, quantity, color: color || '', aroma: aroma || '', workshopDate: workshopDate || '', ...(workshopTime ? { workshopTime } : {}) }));

export function useCartQuote(items) {
  const [code, setCode] = useState(() => {
    try { return sessionStorage.getItem(storageKey) || ''; } catch { return ''; }
  });
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState(null);
  const body = JSON.stringify({ items: orderLines(items), ...(code ? { couponCode: code } : {}) });
  useEffect(() => {
    if (!items.length) { clearSavedCoupon(); setCode(''); return; }
    const controller = new AbortController();
    api('/api/checkout/quote', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: controller.signal })
      .then(quote => {
        if (controller.signal.aborted) return;
        try { if (code) sessionStorage.setItem(storageKey, code); else clearSavedCoupon(); } catch { /* Keep the quote in memory. */ }
        setResult({ body, attempt, quote });
      }).catch(error => {
        if (!controller.signal.aborted) setResult({ body, attempt, error: error.message });
      });
    return () => controller.abort();
  }, [body, code, items.length, attempt]);
  const current = result?.body === body && result.attempt === attempt ? result : null;
  function apply(value) {
    const next = value.trim().toUpperCase();
    if (!next) clearSavedCoupon();
    setCode(next);
    setAttempt(n => n + 1);
  }
  return { code, apply, quote: current?.quote, quoteError: current?.error };
}
