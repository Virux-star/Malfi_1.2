export default function SelectedProductOptions({ item, compact = false }) {
  const color = item.color || item.selected_color;
  const sandColor = item.sandColor || item.selected_sand_color;
  const aroma = item.aroma || item.selected_aroma;
  const summary = [
    color && `Color: ${color}`,
    sandColor && `Color de vela arena: ${sandColor}`,
    aroma && `Aroma: ${aroma}`
  ].filter(Boolean).join(' · ');
  if (!summary) return null;
  return compact ? <small style={{ display: 'block', marginTop: 4 }}>{summary}</small> : <p>{summary}</p>;
}
