import { chileToday } from '../lib/workshops';
import './WorkshopDatesFields.css';

export default function WorkshopDatesFields({ dates, onChange, disabled }) {
  const update = next => onChange({ target: { name: 'workshopDates', value: next } });
  const rows = dates.length ? dates : [''];
  return <fieldset className="workshop-dates-fields" disabled={disabled}>
    <legend>Fechas disponibles del taller</legend>
    <p>Agrega hasta 20 fechas. El cliente deberá elegir una antes de comprar. El precio es por cupo y el stock es el total compartido entre todas las fechas.</p>
    {rows.map((date, index) => <div className="workshop-date-row" key={index}>
      <label>Fecha {index + 1}
        <input type="date" value={date} min={chileToday()} max="9999-12-31" required
          onChange={event => update(rows.map((value, i) => i === index ? event.target.value : value))} />
      </label>
      {rows.length > 1 && <button type="button" aria-label={'Quitar fecha ' + (index + 1)}
        onClick={() => update(rows.filter((_, i) => i !== index))}>Quitar</button>}
    </div>)}
    <button type="button" disabled={rows.length >= 20} onClick={() => update([...rows, ''])}>Agregar otra fecha</button>
  </fieldset>;
}
