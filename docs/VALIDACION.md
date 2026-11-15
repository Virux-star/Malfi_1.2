# Verificación de la entrega · 15 de noviembre de 2026

## Comprobado

- Compilación de producción del frontend con Vite: correcta.
- Instalación de dependencias desde los lockfiles en Linux con Node 24: correcta. El proceso de instalación fuerza las dependencias de desarrollo del frontend aun con NODE_ENV=production para poder compilar Vite.
- Pruebas automatizadas: **38 aprobadas, ninguna fallida ni omitida** al ejecutar con la base de pruebas.
- PostgreSQL real 18.6, esquema nuevo, migraciones y segunda ejecución idempotente: correctos.
- Arranque completo con scripts/start.mjs en configuración de producción y base nueva: correcto. /api/health y acceso directo a /checkout respondieron correctamente; una instalación sin datos no abrió ventas.
- Blueprint de Render validado contra su esquema JSON oficial: válido.
- npm audit de las dependencias de producción del backend: sin vulnerabilidades reportadas en la consulta realizada. No equivale a una auditoría de seguridad completa.

## Cobertura de las pruebas

Control de origen y sesión; acceso privado al pedido; aceptación de condiciones; precio total verificado; selección del transportista por comuna; pedidos duplicados; inicios y retornos de pago simultáneos; venta de última unidad; rechazo y nuevo intento; conciliación tras perder retorno; liberación de reservas; conservación de pagos inciertos; edición de tarifas; correo con deduplicación y ventana de revisión; seguimiento; transiciones de despacho; cookies de producción; rutas antiguas deshabilitadas; navegación directa y errores de API.

Las respuestas bancarias y del proveedor de correo fueron simuladas. No se enviaron correos reales ni se hicieron cobros.

## Revisión visual

Se abrió la aplicación compilada en Chromium y se comprobó portada, ficha de producto, agregado al carrito, carrito persistente y formulario de checkout. Se verificó el cambio de costo/plazo entre Paket para Las Condes y Blue Express para Melipilla. La revisión usó datos ficticios en una base aislada, que no forman parte del catálogo entregado.

No se ejecutó una revisión visual completa del panel autenticado ni una prueba en un teléfono físico o emulador móvil. La aplicación incluye estilos adaptables, pero conviene comprobarla en el teléfono que uses antes de anunciarla.

## Pendiente en el entorno real

- La llamada de verificación al sandbox de Transbank no respondió dentro del tiempo límite desde este entorno; no se confirmó la conectividad real con ese servicio. Completa el recorrido de integración desde el alojamiento y la validación oficial de Transbank antes de habilitar producción.
- No se validaron credenciales reales de Webpay, entrega efectiva de correos en Resend, subida real de imágenes a Cloudinary, DNS ni certificado del dominio final.
- No se creó ningún alojamiento, servicio de pago, dominio ni despliegue público.
- El Dockerfile se preparó, pero no se construyó una imagen Docker aquí.
- Se requiere cargar información comercial, productos/fotografías, stock y tarifas reales: el respaldo recibido contiene solo estructura.
- Los despachos físicos, boletas/facturas y reembolsos se gestionan con los proveedores del negocio.

Estos puntos también se indican en PUBLICAR_MALFI.md para completar la puesta en marcha sin confundir configuración de código con servicios ya activados.

## Actualización Mercado Pago

Se añadió Checkout Pro con preferencias junto a Webpay. Las pruebas incluyen ambas pasarelas, firma del webhook, rechazo de datos inconsistentes, simultaneidad de notificaciones, referencia y vendedor, bloqueo de cuentas reales en integración, preferencia única, recuperación de creación incierta, rechazo/reintento, reembolso, respuesta antigua y correo de Mercado Pago con Webpay desactivado. La actualización aplica la migración 003 sobre la misma base.

Mercado Pago no se activó en una cuenta real ni se realizaron cobros o envíos de notificaciones reales. Se requiere probar las credenciales y las URLs HTTPS con la aplicación del vendedor antes de habilitar producción.

La revisión visual de esta actualización confirmó las dos opciones del checkout y el cambio del botón a Pagar con Mercado Pago al seleccionar esa pasarela. Se realizó con datos ficticios en una base aislada. También se verificó el arranque en producción con una base nueva y la actualización desde las migraciones originales, conservando productos, stock, reservas, pedidos, administración, negocio y tarifas.
