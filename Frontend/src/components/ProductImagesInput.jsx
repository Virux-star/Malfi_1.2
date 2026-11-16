import { useEffect, useRef, useState } from 'react';
import './ProductImagesInput.css';

export function appendProductPhotos(formData, photos) {
  const kept = [], order = [];
  let index = 0;
  for (const photo of photos) {
    if (photo.file) { formData.append('images', photo.file); order.push('new:' + index++); }
    else { kept.push(photo.url); order.push(photo.url); }
  }
  formData.append('keepImages', JSON.stringify(kept));
  formData.append('photoOrder', JSON.stringify(order));
}

export default function ProductImagesInput({ photos, onChange, disabled }) {
  const input = useRef(null);
  const [previews, setPreviews] = useState([]), [error, setError] = useState('');
  useEffect(() => {
    const urls = photos.map(photo => photo.file ? URL.createObjectURL(photo.file) : photo.url);
    setPreviews(urls);
    return () => photos.forEach((photo, index) => { if (photo.file) URL.revokeObjectURL(urls[index]); });
  }, [photos]);
  function choose(event) {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (photos.length + files.length > 6) { setError('El producto admite hasta 6 fotografías. Quita una antes de agregar otra.'); return; }
    if (files.some(file => file.size > 5 * 1024 * 1024)) { setError('Cada fotografía debe pesar como máximo 5 MB.'); return; }
    setError('');
    onChange([...photos, ...files.map(file => ({ file }))]);
  }
  function remove(index) { setError(''); onChange(photos.filter((_, i) => i !== index)); }
  return <fieldset className="product-images-field" disabled={disabled}>
    <legend>Fotografías del producto</legend>
    <p>De 1 a 6 fotos JPG, PNG o WebP. Máximo 5 MB por foto. La primera es la imagen principal.</p>
    <div className="product-images-grid">
      {photos.map((photo, index) => <article className="product-image-preview" key={index}>
        {previews[index] && <img src={previews[index]} alt={'Fotografía ' + (index + 1) + ' del producto'} />}
        <span>{index === 0 ? 'Principal' : 'Foto ' + (index + 1)}</span>
        <div>
          {index > 0 && <button type="button" onClick={() => onChange([photos[index], ...photos.filter((_, i) => i !== index)])}>Hacer principal</button>}
          <button type="button" aria-label={'Quitar fotografía ' + (index + 1)} onClick={() => remove(index)}>Quitar</button>
        </div>
      </article>)}
    </div>
    <label>Agregar fotografías
      <input ref={input} type="file" multiple accept="image/jpeg,image/png,image/webp" onChange={choose} disabled={disabled || photos.length >= 6} />
    </label>
    {error && <p role="alert" className="product-photo-error">{error}</p>}
  </fieldset>;
}
