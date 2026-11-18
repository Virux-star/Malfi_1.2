# Fechas de talleres y cantidad de insumos

## Publicar o editar un taller

1. En Administración → Productos, selecciona la categoría **Talleres**.
2. Ingresa el precio de un cupo y el total de cupos disponibles en stock.
3. En **Fechas disponibles del taller**, elige la fecha con el calendario.
4. Usa **Agregar otra fecha** si hay más de una. Se admiten hasta 20 fechas.
5. En **Horarios disponibles del taller**, escribe un turno por línea, por ejemplo `AM` y `PM`, o las horas exactas. Puedes dejarlo vacío si el cliente solo debe elegir fecha.
6. Guarda el producto.

Los horarios ofrecidos se aplican a todas las fechas del taller. Si hay horarios,
el cliente elige fecha y horario antes de agregar sus cupos al carrito. Ambos
datos aparecen en el pedido y en los correos de confirmación. Las fechas
pasadas dejan de ofrecerse según el día de Chile. Los pedidos conservan la
selección que hizo el cliente aunque luego se edite el taller.

El precio es por cupo. El **total de cupos** se comparte entre todas las fechas
y horarios de esa publicación.

## Publicar un insumo

Selecciona **Insumos**, ingresa el precio de una unidad y el stock en unidades.
Explica en la descripción qué incluye una unidad, por ejemplo una mecha o un
paquete. El comprador puede escribir la cantidad o usar + y −, tanto en el
producto como en el carrito. El total es precio por unidad × cantidad y el
servidor comprueba el stock compartido antes de reservar.

No se agregan presentaciones por peso o volumen con precios distintos.

## Despliegue

El arranque normal `node scripts/start.mjs` aplica automáticamente las migraciones de fechas
(`011_workshop_dates.sql`) y horarios (`013_workshop_times.sql`) antes de iniciar el servidor. No cambies migraciones ya
aplicadas. No se necesitan variables de entorno nuevas.

## Verificación

`npm run build` compila la tienda. `npm test` incluye fechas válidas y vencidas,
cantidades, stock, selección por fecha, pedidos y correos con proveedores
simulados. Las pruebas de integración requieren `TEST_DATABASE_URL` apuntando
a una base PostgreSQL local exclusiva de pruebas; nunca uses producción.
