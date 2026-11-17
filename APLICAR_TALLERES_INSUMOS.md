# Fechas de talleres y cantidad de insumos

## Publicar o editar un taller

1. En Administración → Productos, selecciona la categoría **Talleres**.
2. Ingresa el precio de un cupo y el total de cupos disponibles en stock.
3. En **Fechas disponibles del taller**, elige la fecha con el calendario.
4. Usa **Agregar otra fecha** si hay más de una. Se admiten hasta 20 fechas.
5. Guarda o publica el producto con sus fotografías.

El cliente debe elegir una fecha antes de agregar el taller al carrito. Puede
seleccionar cuántos cupos comprar. La fecha aparece en carrito, checkout, pedido
y correos al cliente y a la tienda. Las fechas pasadas dejan de ofrecerse según
el día de Chile. Editar fechas no cambia las aceptadas en pedidos anteriores.

El stock es el **total compartido entre todas las fechas**, igual que el stock
de colores y aromas. Esta versión no administra cupos separados por fecha ni
horarios dentro de un mismo día. Para cupos independientes, publica un taller
por fecha con su propio stock. Los talleres anteriores deben editarse para
agregarles fechas antes de que el cliente pueda comprarlos.

## Publicar un insumo

Selecciona **Insumos**, ingresa el precio de una unidad y el stock en unidades.
Explica en la descripción qué incluye una unidad, por ejemplo una mecha o un
paquete. El comprador puede escribir la cantidad o usar + y −, tanto en el
producto como en el carrito. El total es precio por unidad × cantidad y el
servidor comprueba el stock compartido antes de reservar.

No se agregan presentaciones por peso o volumen con precios distintos.

## Despliegue

El arranque normal `node scripts/start.mjs` aplica automáticamente la migración
`011_workshop_dates.sql` antes de iniciar el servidor. No cambies migraciones ya
aplicadas. No se necesitan variables de entorno nuevas.

## Verificación

`npm run build` compila la tienda. `npm test` incluye fechas válidas y vencidas,
cantidades, stock, selección por fecha, pedidos y correos con proveedores
simulados. Las pruebas de integración requieren `TEST_DATABASE_URL` apuntando
a una base PostgreSQL local exclusiva de pruebas; nunca uses producción.
