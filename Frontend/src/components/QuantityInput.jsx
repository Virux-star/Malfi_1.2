import { useEffect, useState } from 'react';
import { unitQuantity } from '../lib/workshops';

export default function QuantityInput({ value, max, onChange, ...props }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  function change(event) {
    const text = event.target.value;
    setDraft(text);
    const amount = Number(text);
    if (text !== '' && Number.isInteger(amount) && amount >= 1 && amount <= max) onChange(amount);
  }
  function commit() {
    const amount = unitQuantity(draft, max);
    setDraft(String(amount));
    onChange(amount);
  }
  return <input {...props} type="number" inputMode="numeric" min="1" max={max} step="1"
    value={draft} onChange={change} onBlur={commit} />;
}
