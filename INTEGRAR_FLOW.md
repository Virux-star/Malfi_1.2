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

## Si solo tienes malfi-tienda: crear pruebas con un Blueprint

Se incluye `render.flow-sandbox.yaml` para crear **malfi-flow-pruebas** y su propia base **malfi-flow-pruebas-db**, ambos con plan **Free**. Revisa que Render muestre esos nombres, los planes Free y el costo antes de confirmar. La base gratuita es temporal y vence a los 30 días; el servicio puede dormirse tras 15 minutos sin uso. Consulta las [limitaciones vigentes de Render Free](https://render.com/docs/free).

1. En Render abre **New → Blueprint** y conecta `Virux-star/Malfi_1.2`.
2. Selecciona la rama **main** y el nombre **malfi-flow-pruebas**.
3. En **Blueprint Path** escribe exactamente `render.flow-sandbox.yaml`.
4. Completa los cinco valores privados que solicita:

| Variable | Valor |
| --- | --- |
| `FLOW_API_KEY` | API Key de Sandbox |
| `FLOW_SECRET_KEY` | Secret Key de Sandbox |
| `RESEND_API_KEY` | Tu clave de Resend |
| `EMAIL_TEST_TO` | Tu correo autorizado para recibir las pruebas de Resend; también será el usuario del panel |
| `SANDBOX_ADMIN_PASSWORD` | Una contraseña nueva para el panel de pruebas, de al menos 12 caracteres y hasta 72 bytes |

Al arrancar se verifican las credenciales de Flow con una consulta de lectura. Luego se preparan automáticamente el administrador, dos productos ficticios y un despacho Paket de $3.000 a Las Condes. No hace falta Shell en el plan Free. El proceso rechaza una base de producción y no sobrescribe stock, precios ni contraseñas ya existentes en las pruebas.

Render asignará la URL HTTPS del servicio de pruebas. Los orígenes y callbacks usan automáticamente esa URL; no configures `malfi.cl` en este servicio. Entra a `/admin/login` de la URL nueva con `EMAIL_TEST_TO` y la contraseña elegida. El usuario y la contraseña se crean únicamente en el primer arranque; editar la variable después no cambia una cuenta existente.

Agrega una unidad de cada producto ficticio para probar $50.000 con envío gratis; una sola vela permite probar un despacho pagado. También está disponible el retiro sin costo. Usa solo medios de pago de Sandbox.

La aplicación real continúa usando `render.yaml`. Mantén separados ambos Blueprints y sus bases.

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
