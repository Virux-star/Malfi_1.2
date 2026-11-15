# MALFI · Tienda online

Velas aromáticas de cera de soja y decoración artesanal de cemento.

El proyecto está preparado para instalarlo y publicarlo como una aplicación completa: React + Vite en el frontend, Express y PostgreSQL en el backend. Express sirve también el frontend compilado, con un único dominio para tienda, API y administración.

**Para agregar Mercado Pago a una instalación existente, empieza por [ACTUALIZAR_MERCADOPAGO.md](ACTUALIZAR_MERCADOPAGO.md).** Para una instalación nueva, sigue [PUBLICAR_MALFI.md](PUBLICAR_MALFI.md).

## Qué incluye

- Catálogo real desde PostgreSQL; categorías fijas: Velas de soja, Set de velas y Decoración de cemento.
- Detalle de producto, disponibilidad descontando reservas, carrito persistente y validación de precios y stock en el servidor.
- Checkout con destinos habilitados, tarifa y plazo de entrega antes de pagar, aceptación de condiciones y control de pedidos duplicados.
- Webpay Plus para clientes: integración y producción, comprobante privado, autorización validada contra monto y referencias, conciliación y protección frente a retornos repetidos.
- Mercado Pago Checkout Pro con preferencias: selección en checkout, notificaciones firmadas, validación contra la API, comprobante y conciliación.
- Reservas de inventario; expiración de pedidos sin intento de cobro o con fallos definitivos. Los pagos inciertos conservan su reserva hasta conciliarse.
- Confirmación de compra y aviso a administración por Resend; cola persistente, reintentos con clave de idempotencia y revisión de resultados inciertos.
- Administración con cuenta propia, productos, fotografías en Cloudinary, pedidos, seguimiento, tarifas por comuna y datos del negocio.
- Información de despachos, términos de compra, retracto, garantía legal y privacidad con datos configurables.
- Migraciones, Dockerfile, configuración de Render, verificador de configuración y pruebas automatizadas.

## Datos que debes completar

El respaldo `malfi-sql` recibido contiene **solo estructura**, sin registros de productos, fotografías, administradores ni tarifas. Las migraciones crean una instalación vacía y no inventan un catálogo ni precios de envío. Si tienes otra base con los datos reales, consérvala y respáldala antes de actualizarla.

Las claves privadas del `.env` recibido no se incluyen en este paquete. Conserva tu archivo original y configura los secretos en el alojamiento. No los subas a GitHub ni los pegues en un chat.

## Requisitos

Node.js 24 LTS y PostgreSQL 18 (el respaldo original fue creado con PostgreSQL 18.4). Los archivos package-lock.json fijan las dependencias reproducibles. No se distribuyen node_modules ni el historial .git.

## Desarrollo local

1. En pgAdmin crea una base vacía llamada `malfi`.
2. Crea `Backend/.env` a partir de `Backend/.env.example`, sin sobrescribir uno existente. Configura PostgreSQL y dos secretos aleatorios de al menos 32 caracteres.
3. Desde la raíz del proyecto:

```sh
npm run setup
npm run db:migrate
npm run admin:create
npm run dev
```

Abre `http://localhost:5173`. La administración está en `/admin/login`. El backend escucha en el puerto 3000. Vite redirige `/api` al backend; no hace falta configurar VITE_API_URL.

Para probar la compilación servida por Express, ejecuta `npm run build` y `npm start`. En ese caso cambia PUBLIC_URL y PUBLIC_API_URL a `http://localhost:3000` en el entorno local.

## Comandos

| Comando | Función |
| --- | --- |
| `npm run setup` | Instalar frontend y backend con sus lockfiles |
| `npm run db:migrate` | Crear o actualizar la estructura sin borrar datos |
| `npm run admin:create` | Crear una cuenta administradora sin contraseña predeterminada |
| `npm run mp:check` | Verificar por lectura el vendedor y ambiente del Access Token de Mercado Pago |
| `npm run admin:reset` | Cambiar una contraseña de administración e invalidar sus sesiones |
| `npm run dev` | Ejecutar backend y Vite |
| `npm run build` | Compilar React |
| `npm start` | Ejecutar Express con el frontend compilado |
| `npm run check:production` | Revisar datos y configuración antes de abrir ventas |
| `npm test` | Ejecutar pruebas unitarias y las de integración si se configura su base |

## Pruebas

Las pruebas de integración requieren una base **exclusiva** cuyo nombre contenga `test` o `qa`. Limpian sus tablas. Nunca uses la base de la tienda.

PowerShell:

```powershell
$env:TEST_DATABASE_URL="postgresql://usuario:clave@localhost:5432/malfi_test"
npm test
```

Bash:

```sh
TEST_DATABASE_URL='postgresql://usuario:clave@localhost:5432/malfi_test' npm test
```

Sin TEST_DATABASE_URL, las pruebas unitarias se ejecutan y la integración se marca como omitida. Las pruebas usan pasarelas de pago y proveedor de correo simulados: no cobran ni envían correos reales.

## Estructura

- `Backend/app.js`: aplicación Express, sesiones, productos y administración.
- `Backend/server.js`: inicio del servidor y tareas periódicas.
- `Backend/config`: conexión PostgreSQL y selección explícita de ambiente Webpay.
- `Backend/routes/customerPayments.js`: pedidos privados, checkout, retorno de Webpay y seguimiento.
- `Backend/routes/store.js`: datos del negocio, tarifas y disponibilidad de compra.
- `Backend/services/mercadoPago.js`: preferencias y confirmación de pagos de Mercado Pago.
- `Backend/services/payments.js`: reservas, autorización, conciliación y cierre de inventario.
- `Backend/services/commerceWorker.js`: conciliación y correo transaccional.
- `Backend/sql`: migraciones con registro y comprobación de integridad.
- `Frontend/src`: tienda y administración.
- `docs/OPERACION.md`: gestión de pedidos y resolución de incidencias.
- `docs/VALIDACION.md`: verificación realizada y límites.

Los archivos antiguos de laboratorio se conservan para referencia. El servidor nuevo no inicia los workers antiguos; no los ejecutes sobre pedidos de producción.

## Alcance operativo

El sistema calcula el despacho con las tarifas por comuna que tú verificas y configuras. No consulta precios en vivo de Paket o Blue Express ni genera etiquetas; debes contratar y gestionar esos despachos con los transportistas. Verifica que la tarifa cubre el peso y volumen de tus carritos.

La emisión tributaria de boletas/facturas, la contratación del alojamiento, la afiliación/validación de Transbank y los reembolsos bancarios se gestionan con sus proveedores. La aplicación no los da por completados.
