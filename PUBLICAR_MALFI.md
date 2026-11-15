# Publicar MALFI

Este paquete completa el código de la tienda. Para vender con dinero real debes cargar los datos del negocio, productos y tarifas, y activar tus servicios de producción.

## 1. Preparar tu repositorio

Descomprime el ZIP. La carpeta `Malfi_web` es la raíz: ahí están package.json, render.yaml, Backend y Frontend.

Actualiza tu repositorio de GitHub con esta carpeta. Si ya tienes un clon, conserva su carpeta .git y revisa los cambios antes de subirlos. Guarda tu .env anterior por separado. El paquete lleva .gitignore, pero revisa que GitHub no reciba claves ni contraseñas.

No publiques este proyecto subiendo solo Frontend/dist: necesita el backend y PostgreSQL.

## 2. Crear la aplicación en Render

Se incluye render.yaml para crear un servicio Node y una base PostgreSQL. Define planes de pago: revisa el costo que muestre Render antes de confirmar.

1. En Render selecciona **New → Blueprint** y conecta tu repositorio.
2. Usa render.yaml de la raíz y revisa los recursos propuestos.
3. Ingresa CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY y CLOUDINARY_API_SECRET desde tu cuenta de Cloudinary.
4. Render ejecuta `npm run setup && npm run build` y arranca `node scripts/start.mjs`. El arranque aplica las migraciones con bloqueo para evitar ejecuciones simultáneas.
5. La URL inicial es la que asigne Render. Sin PUBLIC_URL, el backend usa automáticamente RENDER_EXTERNAL_URL.
6. Comprueba `/api/health`: debe responder `{"status":"ok"}`.

SESSION_SECRET y ORDER_TOKEN_SECRET se generan automáticamente. Mantén estables esos valores: cambiar ORDER_TOKEN_SECRET invalida los enlaces privados de los pedidos existentes.

Las fotos se guardan en Cloudinary y los pedidos en PostgreSQL, por lo que no dependen del disco temporal del servicio.

## 3. Crear tu administración

Abre **Shell** del servicio en Render y ejecuta:

```sh
npm run admin:create
```

Escribe tu correo y una contraseña de al menos 12 caracteres. La contraseña no se muestra. No hay cuentas ni contraseñas de fábrica.

Entra a `https://TU_URL/admin/login`.

- **Fotografía principal**: carga una foto real de MALFI.
- **Productos**: carga fotografías, nombres, precios finales, stock y descripciones. Incluye materiales, medidas, cantidad, aroma y cuidados según corresponda.
- **Configuración y despachos**: completa nombre/razón social, RUT, domicilio legal, correo, teléfono, representante legal si corresponde y cómo atender cambios/devoluciones.
- Agrega las comunas habilitadas con su tarifa real y plazo de traslado. La preparación se suma a ese plazo.

Para una comuna dentro de la cobertura de Santiago confirmada, selecciona Paket. Fuera de esa cobertura, incluso dentro de la Región Metropolitana, usa Blue Express. Confirma individualmente las comunas y el valor que cobrarás según tu contrato.

## 4. Validar los medios de pago sin dinero real

Para Mercado Pago, sigue [ACTUALIZAR_MERCADOPAGO.md](ACTUALIZAR_MERCADOPAGO.md): necesita una aplicación Checkout Pro con preferencias, credenciales del ambiente correcto, vendedor de Chile y webhook en un backend HTTPS público. Puedes ofrecerlo junto a Webpay o como única pasarela.

### Webpay

Usa preferentemente otra aplicación/base de staging, separada de tus ventas reales.

En el entorno de staging:

```dotenv
NODE_ENV=production
WEBPAY_MODE=integration
ALLOW_INTEGRATION_CHECKOUT=true
CHECKOUT_ENABLED=true
EMAIL_MODE=test
RESEND_API_KEY=tu_clave_de_Resend
EMAIL_TEST_TO=tu_correo_autorizado_de_prueba
```

No uses `WEBPAY_TEST_MODE` ni `MP_TEST_MODE`: son opciones de rutas antiguas. En el flujo nuevo, `WEBPAY_MODE=integration` elige las credenciales públicas de integración del SDK. Los correos de ese ambiente solo llegan a EMAIL_TEST_TO.

Completa los datos, al menos un producto y una tarifa de staging. Comprueba compra aprobada y rechazada, abandono del pago, regreso repetido al comprobante, correo y stock. El sitio identifica claramente los pedidos de prueba. Nunca pruebes con tarjetas reales en integración.

Sigue el proceso oficial de validación de Transbank para obtener tu código de comercio y API Key de producción. La página del comercio debe mostrar el resultado del pago; este paquete incorpora ese comprobante.

## 5. Habilitar ventas reales

En **Environment** del servicio de producción configura:

| Variable | Valor |
| --- | --- |
| NODE_ENV | production |
| PUBLIC_URL | URL HTTPS definitiva de tu tienda, sin barra al final; omítela si usas la URL de Render |
| PUBLIC_API_URL | Omítela con el despliegue unificado; úsala solo si separas el backend |
| WEBPAY_MODE | production si ofreces Webpay; disabled si solo ofreces Mercado Pago |
| WEBPAY_COMMERCE_CODE | Tu código de comercio validado |
| WEBPAY_API_KEY | Tu llave de producción |
| ALLOW_INTEGRATION_CHECKOUT | false |
| CHECKOUT_ENABLED | true, al terminar la configuración |
| EMAIL_MODE | production |
| RESEND_API_KEY | Clave de tu cuenta Resend |
| EMAIL_FROM | MALFI <ventas@tu-dominio.cl>, con dominio verificado en Resend |
| ADMIN_EMAIL | Correo que recibirá avisos de pedidos pagados |
| WEBPAY_TEST_MODE | false |
| MP_TEST_MODE | false |

Si activas Mercado Pago, agrega también MP_MODE, MP_ACCESS_TOKEN, MP_WEBHOOK_SECRET, MP_COLLECTOR_ID y MP_PUBLIC_BASE_URL como se explica en ACTUALIZAR_MERCADOPAGO.md.

No copies PUBLIC_URL=http://localhost:5173 desde el ejemplo local a producción. No pongas credenciales del backend en variables VITE_*.

Guarda los cambios y reinicia/despliega el servicio. En Shell ejecuta:

```sh
npm run check:production
```

Si informa datos pendientes, corrígelos antes de anunciar la tienda. El verificador comprueba configuración; no sustituye una transacción real ni la validación de Transbank.

Haz una compra real controlada conforme al proceso de Transbank, revisa la autorización en su portal, el stock, el comprobante y los dos correos. Confirma también cómo emitirás la boleta y cómo gestionarás el despacho.

## 6. Usar un dominio propio

Agrégalo en la configuración de dominio del alojamiento y aplica sus registros DNS. Cuando el certificado HTTPS esté activo, cambia PUBLIC_URL a `https://tu-dominio.cl` y vuelve a desplegar. Mantén tienda y backend bajo el mismo dominio: las cookies de administración están preparadas para esa configuración.

No abras ventas hasta comprobar nuevamente inicio/cierre de sesión, pago y retorno usando el dominio final.

## Alternativa con Docker

Construye la imagen con `docker build -t malfi .`. Crea un archivo de entorno privado con los valores productivos y una base PostgreSQL accesible. Ejecuta la imagen publicando el puerto 3000 detrás de un proxy HTTPS. La imagen ejecuta las migraciones al arrancar. La compilación del Dockerfile no se ejecutó en esta entrega; revisa docs/VALIDACION.md.

## Fuentes

- [Transbank: validación y puesta en producción](https://transbankdevelopers.com/documentacion/como_empezar)
- [Transbank: Webpay Plus](https://transbankdevelopers.com/documentacion/webpay-plus)
- [Render: configuración Blueprint](https://render.com/docs/blueprint-spec)
- [SERNAC: derechos en el comercio electrónico](https://www.sernac.cl/portal/604/w3-propertyvalue-20982.html)

Los términos del sitio incorporan un texto base y los datos que configures. Revisa que describan correctamente la operación real de MALFI antes de abrir compras.
