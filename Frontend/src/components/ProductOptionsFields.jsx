export const optionsFromText = value => value.split('\n').map(option => option.trim()).filter(Boolean);

export default function ProductOptionsFields({ colors, aromas, onChange, disabled }) {
  return <fieldset className="product-options-fields" disabled={disabled}>
    <legend>Opciones del producto</legend>
    <p>Escribe una opción por línea, hasta 20. Deja el campo vacío cuando no corresponda. Todas las opciones comparten el precio y stock del producto.</p>
    <label>Colores disponibles
      <textarea name="colors" value={colors} onChange={onChange} rows={3} maxLength={1220} placeholder={'Blanco\nBeige\nTerracota'} />
    </label>
    <label>Aromas disponibles
      <textarea name="aromas" value={aromas} onChange={onChange} rows={3} maxLength={1220} placeholder={'Vainilla\nLavanda\nSin aroma'} />
    </label>
  </fieldset>;
}
