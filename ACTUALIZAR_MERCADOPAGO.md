# Agregar Mercado Pago a tu MALFI actual

Esta versión agrega Mercado Pago Checkout Pro con preferencias junto a Webpay. El cliente elige una de las dos opciones antes de registrar el pedido. Se conserva el stock, la administración, las comunas y los datos ya guardados.

## 1. Actualiza el código y conserva tus datos

1. Detén `npm run dev` con Ctrl + C.
2. Guarda una copia de tu carpeta actual y respalda la base de datos.
3. Copia los archivos de esta versión a tu proyecto **conservando tu Backend/.env**. El ZIP no incluye ese archivo privado.
4. Mantén la misma base que ya estás usando; no crees otra base ni importes el respaldo viejo sobre ella.
5. Desde la raíz ejecuta:

```powershell
npm run setup
npm run db:migrate
```

La migración nueva es `003_mercadopago_checkout.sql`. El comando la aplica en la misma base, conserva productos/pedidos/tarifas y reconoce los pedidos anteriores como Webpay. No modifiques 001 ni 002 ni borres schema_migrations.

Con `MP_MODE=disabled` la tienda sigue ofreciendo Webpay como antes.

## 2. Crea o revisa la aplicación en Mercado Pago

En [Mercado Pago Developers](https://www.mercadopago.cl/developers/es/docs/checkout-pro-preferences/overview) entra a Integraciones y crea una aplicación para **Checkout Pro con preferencias**. Esta implementación usa `/checkout/preferences`, no el laboratorio anterior con `/v1/orders`.

Selecciona el ambiente **Prueba** y consulta sus credenciales y la cuenta vendedora de prueba de Chile. Cuando corresponda iniciar sesión como comprador, utiliza otra cuenta de prueba del mismo país.

Los tokens actuales de prueba pueden comenzar con APP_USR: el prefijo por sí solo no identifica el ambiente. Confirma que los copiaste desde Prueba. La aplicación consulta el vendedor y exige la marca test_user antes de crear un checkout de integración.

Mantén el Access Token y la firma secreta en Backend/.env. No los pegues en un chat, en GitHub ni en variables VITE_*.

## 3. Prepara una URL HTTPS para las notificaciones

Mercado Pago debe poder comunicarse con tu backend. `localhost` solo existe dentro de tu computador y no sirve como URL de retorno de Mercado Pago.

Puedes usar un backend de staging publicado o un túnel HTTPS hacia el puerto 3000. Por ejemplo, con ngrok instalado y autenticado siguiendo su [guía oficial](https://ngrok.com/docs/gateway/agent/cli):

```powershell
ngrok http 3000
```

Deja ese proceso abierto. Copia el origen HTTPS asignado, por ejemplo `https://TU_DOMINIO_ASIGNADO`, sin ruta ni barra final. El túnel hace accesible el servidor local mientras esté abierto; úsalo con la base de pruebas y ciérralo al terminar.

Para probar desde tu computador puedes mantener:

```dotenv
PUBLIC_URL=http://localhost:5173
PUBLIC_API_URL=http://localhost:3000
```

MP_PUBLIC_BASE_URL será el origen HTTPS público del backend. El retorno llega allí y el backend redirige después a tu comprobante local. No abras la tienda desde la URL del túnel si PUBLIC_URL sigue configurado como localhost:5173; usa la dirección local habitual.

## 4. Completa las variables nuevas

Completa o actualiza estas variables en tu Backend/.env existente, sin borrar los valores de PostgreSQL, sesiones, Webpay y Cloudinary:

```dotenv
MP_MODE=integration
MP_ACCESS_TOKEN=PEGA_AQUI_EL_ACCESS_TOKEN_DEL_AMBIENTE_PRUEBA
MP_WEBHOOK_SECRET=PEGA_AQUI_LA_FIRMA_SECRETA_DE_WEBHOOKS
MP_COLLECTOR_ID=ID_NUMERICO_DEL_VENDEDOR_DE_PRUEBA
MP_PUBLIC_BASE_URL=https://TU_DOMINIO_HTTPS_DEL_BACKEND
```

MP_COLLECTOR_ID es el **User ID del vendedor**, no el comprador ni el ID de la aplicación. Para consultar el usuario del token que configuraste, ejecuta:

```powershell
npm run mp:check
```

El comando muestra el ID del vendedor, país y si es cuenta de prueba. No muestra el Access Token ni crea cobros. Copia el ID mostrado a MP_COLLECTOR_ID.

La Public Key no se utiliza en esta variante de redirección: el backend crea la preferencia y el navegador continúa al init_point devuelto por Mercado Pago. Los datos de la tarjeta se ingresan en Mercado Pago.

Mantén `WEBPAY_MODE=integration` si también quieres ofrecer Webpay de prueba. No habilites `MP_TEST_MODE`: corresponde a las rutas antiguas del laboratorio.

## 5. Configura el webhook

En la aplicación de Mercado Pago, configura una notificación de tipo **Pagos (payment)** para:

```text
https://TU_DOMINIO_HTTPS_DEL_BACKEND/api/payments/mercadopago/webhook
```

Copia la firma secreta de esa configuración a MP_WEBHOOK_SECRET. Usa la configuración de notificaciones correspondiente al ambiente que estás probando.

El backend verifica la firma del SDK oficial y consulta el pago con su Access Token. También verifica monto CLP, vendedor, ambiente, referencia y preferencia de la orden comercial. El estado que vuelve en la URL no confirma una venta.

## 6. Inicia y prueba

Reinicia el servidor después de cambiar Backend/.env:

```powershell
npm run dev
```

En Configuración y despachos verás Webpay y Mercado Pago con su modo. Si faltan valores, la pantalla los indica y conserva Webpay disponible. Cuando la configuración esté completa, el checkout mostrará ambos medios de pago.

1. Agrega un producto con stock al carrito.
2. Completa dirección, región y comuna.
3. Elige **Mercado Pago** y acepta las condiciones.
4. Pulsa **Pagar con Mercado Pago**.
5. Sigue el proceso de prueba oficial, con comprador/tarjetas de prueba cuando corresponda. Consulta los [datos de prueba vigentes](https://www.mercadopago.cl/developers/es/docs/checkout-pro-preferences/integration-test/test-purchases).
6. Al volver, comprueba el ID de pago y el estado Pagado en el comprobante y en administración.
7. Revisa que el stock se descontó una sola vez al confirmar el pago; antes de pagar, solo queda reservado.
8. Prueba también rechazo, abandono, retorno repetido y una notificación repetida.

Si cambia la dirección del túnel, actualiza MP_PUBLIC_BASE_URL y la URL configurada en Webhooks, reinicia y crea un pedido de prueba nuevo. Los checkouts anteriores guardan las direcciones con las que se crearon.

La prueba del simulador de Webhooks debe usar un ID real de un pago de tu ambiente de pruebas. Un ID inventado no se puede validar contra la API.

## 7. Abrir ventas reales

Primero termina las pruebas desde el dominio HTTPS definitivo. Después usa los datos de **Producción** de tu aplicación:

```dotenv
NODE_ENV=production
MP_MODE=production
MP_ACCESS_TOKEN=TU_ACCESS_TOKEN_PRODUCTIVO
MP_WEBHOOK_SECRET=TU_FIRMA_PRODUCTIVA
MP_COLLECTOR_ID=ID_DE_TU_VENDEDOR_REAL
MP_PUBLIC_BASE_URL=https://TU_DOMINIO_DE_BACKEND
```

Mantén Webpay en producción si también lo ofrecerás; puedes dejar WEBPAY_MODE=disabled si solo usarás Mercado Pago. Antes de abrir ventas, configura los correos reales y ejecuta `npm run check:production`. Realiza la comprobación final con un pago real controlado desde tu propio entorno.

## Qué ocurre con pagos inciertos

Se crea una sola preferencia por pedido. Los rechazos pueden reintentarse en esa misma preferencia mientras la reserva y el enlace sigan vigentes. Un pago pendiente o una respuesta perdida conserva el pedido para revisión y evita iniciar otro intento desde MALFI.

Cada minuto, mientras el servidor esté activo, se buscan movimientos del checkout en Mercado Pago. También puedes usar **Consultar y conciliar el pago** en el detalle administrativo. La notificación permite actualizar el pedido aunque el comprador cierre el navegador.

Una preferencia puede tener movimientos posteriores. Si aparece otra autorización, una devolución o un contracargo, se señala para revisión sin volver a descontar o reponer stock. El administrador no inicia reembolsos.

**Los pedidos que ya tienen una preferencia de Mercado Pago no se cancelan ni liberan automáticamente solo porque pasó una hora**, incluso si su último intento fue rechazado. Hay que revisar y resolver el checkout en el proveedor antes de liberar reservas: un resultado incierto o un enlace vencido no acredita por sí solo que no exista un pago en tránsito. Esta versión conserva esa situación para revisión; no incluye un botón para forzar su cierre.

## Verificación de esta actualización

Las pruebas automatizadas usan PostgreSQL real y una API de Mercado Pago simulada. Verifican firmas, idempotencia, importes, pasarela elegida, recuperación de respuestas perdidas y conservación del inventario. No reemplazan las pruebas con tu aplicación de Mercado Pago y tu URL pública.
