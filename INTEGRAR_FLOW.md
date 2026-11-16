# Flow en MALFI

Mercado Pago permanece disponible. Flow se incorpora como una opción adicional y queda deshabilitado hasta configurar las credenciales y completar las pruebas. El cambio no modifica los importes, pagos ni reservas de pedidos anteriores.

## Credenciales

La cuenta Sandbox y la cuenta productiva son independientes. Registra o abre tu cuenta en [Sandbox de Flow](https://sandbox.flow.cl/) para obtener las claves de pruebas. En **Mis datos → Integraciones** encontrarás **API Key** y **Secret Key**. Consulta los [primeros pasos oficiales](https://developers.flow.cl/docs/intro).

Guarda las claves únicamente en el servidor: `Backend/.env` para desarrollo o **Environment** del servicio correspondiente en Render. No las subas a GitHub ni uses variables `VITE_*` para ellas.

| Variable | Pruebas | Producción |
| --- | --- | --- |
| `FLOW_MODE` | `integration` | `production` |
| `FLOW_API_KEY` | API Key de Sandbox | API Key productiva |
| `FLOW_SECRET_KEY` | Secret Key de Sandbox | Secret Key productiva |
| `FLOW_PUBLIC_BASE_URL` | Origen HTTPS del backend de pruebas | `https://malfi.cl` |

El origen HTTPS no lleva ruta `/api` ni barra final. El código elige automáticamente el API de Sandbox o producción según el modo; no se configura un host arbitrario.

## Prueba separada de la tienda real

Usa una instalación separada, con su propia base de datos y datos de prueba. El sitio real conserva Mercado Pago productivo, `WEBPAY_MODE=disabled`, `ALLOW_INTEGRATION_CHECKOUT=false` y `CHECKOUT_ENABLED=true`.

En la instalación de prueba configura los datos del negocio, un producto con stock y los destinos de despacho. Para una instalación de staging con `NODE_ENV=production` usa:

```dotenv
FLOW_MODE=integration
MP_MODE=disabled
WEBPAY_MODE=disabled
ALLOW_INTEGRATION_CHECKOUT=true
EMAIL_MODE=test
EMAIL_TEST_TO=tu_correo_de_prueba
CHECKOUT_ENABLED=true
```

Completa las claves de Sandbox y el origen público de ese backend. Configura `PUBLIC_URL` y `PUBLIC_API_URL` con ese origen, además de sus propias claves de sesión, base de datos y Resend de pruebas. El modo de integración de Flow se oculta si intenta mezclarse con una pasarela productiva en un servicio de producción.

Ejecuta en el servicio de prueba:

```sh
npm run db:migrate
npm run flow:check
```

`flow:check` consulta de forma firmada el acceso de lectura a la API. No crea órdenes, no cobra y no muestra las claves ni los movimientos consultados. Un resultado correcto valida las credenciales; la compra completa se verifica por separado.

Realiza una compra Sandbox seleccionando Flow. Comprueba el regreso al pedido, la confirmación, la actualización de stock y los dos correos de prueba. Verifica también una compra de $50.000 con despacho gratis, un despacho pagado bajo ese monto y un retiro sin costo. Usa los medios de prueba que indique [la documentación oficial de Flow](https://developers.flow.cl/).

## Activación en Render

Una vez terminadas las pruebas, incorpora en el servicio real las dos claves de producción y las variables de la columna Producción. Conserva la configuración actual de Mercado Pago, Webpay deshabilitado y `ALLOW_INTEGRATION_CHECKOUT=false`. Guarda y despliega.

```sh
npm run flow:check
npm run check:production
```

Flow aparecerá como opción al completar la configuración. Confirma luego una compra real controlada y revisa el pago en Flow, el pedido, stock, correos, boleta y entrega antes de dar por terminada la activación.

## Confirmaciones y revisión de pagos

Las URLs se envían automáticamente a Flow al crear el pago:

- Confirmación: `/api/payments/flow/confirmation`, mediante POST form-urlencoded.
- Retorno del comprador: `/api/payments/flow/return`, mediante POST.

Cada URL lleva un estado opaco propio del intento. El servidor consulta `/payment/getStatus` con su firma privada y compara orden comercial, orden Flow, moneda, importe y ambiente antes de confirmar. No acepta el estado que envíe el navegador como prueba de pago.

Un pedido tiene un único intento Flow. Ante una creación incierta se conserva la reserva y se consulta la referencia comercial; no se repite el cobro. La revisión periódica y el botón **Consultar y conciliar el pago** del administrador recuperan confirmaciones pendientes. Los pagos inciertos de más de siete días requieren revisión operativa desde el panel y Flow.

Un rechazo o anulación confirmado por la API libera la reserva una sola vez. Una confirmación tardía de un pedido ya cancelado queda en revisión antes de preparar productos. Los reembolsos se gestionan desde Flow y se revisan manualmente en la tienda; esta integración procesa pagos únicos.

Para ocultar nuevas compras con Flow usa `FLOW_MODE=disabled`. Si hay pagos Flow pendientes, conserva las credenciales y concilia esos movimientos antes de retirar el acceso al proveedor. No cambies la clave estable de los enlaces de pedido durante la activación.
