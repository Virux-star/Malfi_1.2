# Operación de la tienda

## Pedido normal

1. El cliente confirma su carrito, destino, total y condiciones de compra.
2. El backend verifica precios y disponibilidad, reserva el stock y devuelve un enlace privado.
3. Webpay solicita los datos de la tarjeta fuera del sitio MALFI.
4. El backend verifica estado AUTHORIZED, response_code exactamente 0, monto, orden de compra y sesión. Solo entonces confirma el pago.
5. En una transacción de PostgreSQL convierte la reserva en venta y encola las dos notificaciones. Repetir el retorno no vuelve a descontar stock.
6. En administración consulta el pedido pagado, márcalo en preparación, agrega el seguimiento y cambia a enviado y entregado cuando corresponda.

Un pedido pagado recién recibido conserva internamente status=pending_payment hasta que administración lo marque en preparación; el campo payment_status=paid identifica el cobro confirmado. No te guíes solo por el nombre del estado logístico.

## Pagos rechazados o interrumpidos

Si el banco confirma FAILED, el cliente puede iniciar otro intento del mismo pedido durante la reserva. Si el banco aún informa INITIALIZED o no responde, el sistema conserva el intento y verifica el resultado. No interpreta la ausencia de respuesta como un rechazo.

El worker corre cada minuto mientras el servidor esté activo. Concilia los pagos y libera reservas vencidas cuando no hubo intento o todos los intentos fallaron definitivamente. Los intentos con resultado incierto no se liberan de forma automática.

En un alojamiento que se suspenda, estas tareas no avanzan hasta que el servicio vuelva a ejecutarse. La configuración de Render incluida utiliza un servicio de pago continuo.

## Revisar un pago

En Pedidos abre el detalle y usa **Consultar y conciliar en Webpay**. Si confirma el pago, actualiza el detalle antes de preparar la compra. Contrasta las ventas con el reporte de Transbank.

Si la creación perdió la respuesta y no existe token, o el pago tiene más de seis días sin conciliar, revisa la orden de compra y el monto en el portal de Transbank. La consulta automática tiene una ventana limitada. No marques pedidos como pagados ni liberes reservas mediante cambios directos en SQL sin resolver antes el movimiento bancario.

Si existe un cobro que exige devolución, realiza el reembolso desde el canal habilitado por Transbank y registra su resultado en la gestión del negocio. El administrador actual no inicia reembolsos ni permite forzar un pago o liberar un cobro incierto.

Un pago recibido sin inventario consistente pasa a payment_review: no se prepara automáticamente y se conserva para revisión del comercio.

## Correos

Los correos se encolan en order_email_outbox y se envían después de confirmar el pago y el inventario. El correo del cliente incluye productos, precios, despacho, condiciones aceptadas y datos del proveedor guardados al crear el pedido.

El proveedor se invoca con una clave estable para evitar duplicados. Ante resultados inciertos se reintenta dentro de su ventana de deduplicación; al agotarse intentos o superar 23 horas desde el primer envío queda needs_review. Revisa el panel del proveedor antes de enviar otra confirmación manual. Un correo marcado sent significa aceptado por Resend, no una garantía de llegada a la bandeja principal.

## Inventario y tarifas

El stock del administrador representa unidades físicas; el catálogo muestra stock menos reserved_stock. No bajes el stock físico por debajo de las unidades reservadas.

Al editar una tarifa, los pedidos existentes conservan el precio y plazo que aceptaron. Al editar los datos del negocio cambia la versión de condiciones para pedidos nuevos; los pedidos anteriores conservan su copia.

## Copias de seguridad

Activa y revisa las copias de PostgreSQL que ofrezca tu proveedor. Guarda también la configuración del alojamiento y el acceso a Cloudinary de forma privada. Antes de actualizar una base existente, realiza un respaldo y comprueba una restauración en otra base.

No restaures el respaldo antiguo sobre una base que ya tenga ventas. Las migraciones registran su nombre y checksum; no edites una migración aplicada para forzar una actualización. Añade otra migración.

## Contraseña de administración

Desde una terminal segura del servidor ejecuta `npm run admin:reset`, escribe el correo existente y la nueva contraseña. La herramienta la guarda con bcrypt e invalida las sesiones de esa cuenta. No utiliza contraseñas en argumentos ni crea credenciales públicas.

## Mercado Pago

Consulta ACTUALIZAR_MERCADOPAGO.md para activar la integración y conocer el manejo de preferencias vencidas, rechazos, pagos pendientes y reservas. El comprobante y administración muestran la pasarela que eligió el cliente. El medio elegido queda fijo por pedido; un intento pendiente no se migra de Webpay a Mercado Pago.

La conciliación automática revisa checkouts de Mercado Pago de los últimos siete días. Los webhooks firmados y la revisión manual pueden procesar movimientos posteriores. Las devoluciones y contracargos no reponen inventario automáticamente. Un pago adicional para el mismo pedido exige revisión y gestión en el proveedor.
