# Colores, aromas y varias fotografías en MALFI

El cambio incorpora opciones de color y aroma por producto, hasta seis fotografías, elección de imagen principal, validación de selecciones y conservación de esas elecciones en el carrito, pedido, administrador y correos. Cada producto conserva un precio y stock general: no crea inventario ni precios por combinación.

## Aplicarlo desde GitHub y Render

1. Abre el pull request de la rama **productos-colores-aromas-fotos** hacia **main**.
2. Revisa que la comprobación **Product options and gallery / verify** termine correctamente. Compila la tienda y ejecuta las pruebas con PostgreSQL nuevo y proveedores de imagen y pago simulados. No usa secretos del comercio ni realiza cobros.
3. Si el pull request está en borrador, pulsa **Ready for review**. Para incorporarlo, pulsa **Merge pull request** y confirma.
4. Espera el despliegue de **malfi-tienda** en Render. El comando de arranque existente **node scripts/start.mjs** aplica automáticamente **010_product_options_gallery.sql** antes de servir la aplicación. La migración añade los campos y conserva las fotografías y los pedidos existentes.
5. Cuando Render muestre **Live**, abre el administrador y crea o edita un producto. Escribe un color o aroma por línea. Los campos son opcionales.
6. Agrega de una a seis fotos. Usa **Hacer principal** para elegir la foto de portada y **Quitar** para retirar una foto.
7. Revisa el producto en la tienda: las miniaturas cambian la foto y los selectores deben completarse cuando el producto ofrece opciones.

El envío gratis desde $50.000, retiro y pasarelas actuales conservan su comportamiento. Los pedidos ya creados conservan el precio y las opciones aceptadas aunque después edites el catálogo.

## Revisarlo primero en tu computador

Necesitas Git, Node.js 24 y PostgreSQL local. Para no sobrescribir otra carpeta, descarga una copia aparte:

    git clone --branch productos-colores-aromas-fotos https://github.com/Virux-star/Malfi_1.2.git Malfi-opciones
    cd Malfi-opciones
    npm run setup
    npm run build

Si GitHub solicita autenticación, inicia sesión con la cuenta que tiene acceso al repositorio privado.

### Pruebas locales con PostgreSQL

1. En pgAdmin crea una base nueva llamada **malfi_qa**. Debe estar separada de la tienda.
2. Configura **TEST_DATABASE_URL** con el usuario y contraseña de tu PostgreSQL local. En PowerShell:

    $env:TEST_DATABASE_URL="postgresql://postgres:TU_CLAVE_LOCAL@127.0.0.1:5432/malfi_qa"
    npm run test:product-options

Las pruebas vacían y recrean datos en esa base exclusiva de pruebas. El comando rechaza conexiones que no sean locales o cuyo nombre no contenga test o qa. No pegues esa cadena en el chat: contiene tu contraseña local.

Para ejecutar además la suite completa con esa misma base local, en PowerShell:

    $env:DATABASE_URL=$env:TEST_DATABASE_URL
    $env:DB_SSL="false"
    npm test

Las pruebas de base de datos necesitan TEST_DATABASE_URL; sin esa variable algunas pruebas de la suite general se omiten. La comprobación de GitHub siempre define una base QA nueva.

### Verlo localmente

Copia **Backend/.env.example** a **Backend/.env** y configura una base local exclusiva, las claves de sesión y Cloudinary para poder publicar fotos. Mantén **CHECKOUT_ENABLED=false**, **FLOW_MODE=disabled**, **MP_MODE=disabled** y **WEBPAY_MODE=disabled** mientras revisas la interfaz local; no uses credenciales de pago reales para este paso. Ejecuta:

    npm run db:migrate
    npm run admin:create
    npm run dev

En desarrollo, la API usa http://localhost:3000 y la tienda http://localhost:5173. Sigue las instrucciones del comando de creación de administrador y luego entra al panel local.

## Revisión funcional antes de publicar productos

- Revisa primero en local. Añade dos colores, dos aromas y varias fotos.
- Cambia la foto principal y comprueba que las otras se conserven.
- Agrega al carrito dos combinaciones del mismo producto. Deben permanecer en líneas distintas y compartir el límite de stock.
- Un producto sin aromas no debe pedir aroma; uno sin colores no debe pedir color.
- Si cambias las opciones de un producto que ya estaba en un carrito, el cliente debe revisar el producto y volver a agregar la selección disponible.
- Usa las pruebas automatizadas para validar el pedido y los correos. Si haces una compra en la tienda productiva, será real.
