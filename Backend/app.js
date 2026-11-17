import { registerProductRoutes } from './routes/products.js';
import "dotenv/config";
import express from "express";
import cors from "cors";
import multer from "multer";
import { v2 as cloudinary } from "cloudinary";
import { createPool } from "./config/database.js";
import { runtimeConfig, createWebpayClient } from "./config/runtime.js";
import { registerStoreRoutes } from "./routes/store.js";
import { resolveShipping } from "./services/shipping.js";
import { registerCustomerPayments } from "./routes/customerPayments.js";
import { registerMercadoPagoCheckout } from "./routes/mercadoPagoCheckout.js";
import { createMercadoPagoClient } from "./services/mercadoPagoClient.js";
import { createFlowClient } from "./services/flowClient.js";
import { registerFlowCheckout } from "./routes/flowCheckout.js";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { fileTypeFromBuffer } from "file-type";
import { rateLimit } from "express-rate-limit";
import bcrypt from "bcryptjs";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { randomUUID } from "node:crypto";
import { registerMercadoPagoWebhook } from "./routes/mercadoPagoWebhook.js";
import { registerWebpayTest } from "./routes/webpayTest.js";
import { registerPendingPaymentsAdmin }
  from "./routes/pendingPaymentsAdmin.js";

export function createApp({ pool = createPool(), webpayClient, mercadoPagoClient, flowClient, config = runtimeConfig(), imageClient = cloudinary } = {}) {
const app = express();
app.disable("x-powered-by");
app.use((req, res, next) => {
  res.set({ "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer", "Permissions-Policy": "camera=(), microphone=(), geolocation=()" });
  res.set("Content-Security-Policy", `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://res.cloudinary.com; connect-src 'self' ${config.apiOrigin}; form-action 'self' https://webpay3g.transbank.cl https://webpay3gint.transbank.cl; base-uri 'self'; object-src 'none'; frame-ancestors 'none'`);
  if (config.production) res.set("Strict-Transport-Security", "max-age=31536000");
  if (req.path.startsWith("/api/")) res.set("Cache-Control", "no-store");
  next();
});

app.use(cors({
  origin: config.origin,
  credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({
  extended: false,
  limit: "10kb"
}));

// ========================================
// PROTECCIÓN DE ORIGEN
// ========================================

app.use((req, res, next) => {
  const isPaymentCallback =
    req.method === "POST" &&
    (
      req.path === "/api/webhooks/mercadopago" ||
      req.path === "/api/webpay/test/return" ||
      req.path === "/api/payments/webpay/return" ||
      req.path === "/api/payments/mercadopago/webhook" ||
      req.path === "/api/payments/flow/confirmation" ||
      req.path === "/api/payments/flow/return"
    );

  if (isPaymentCallback) {
    return next();
  }

  // Permitir consultas normales
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    return next();
  }

  // Proteger las demás operaciones
  const allowedOrigin = config.origin;
  const requestOrigin = req.get("Origin");

  if (requestOrigin !== allowedOrigin) {
    console.warn(
      "Solicitud bloqueada por Origin:",
      req.method,
      req.path
    );

    return res.status(403).json({
      error: "Origen no autorizado."
    });
  }

  next();
});

if (!config.production) registerMercadoPagoWebhook(app, pool);

// ========================================
// SESIONES DE ADMINISTRACIÓN MALFI
// ========================================

const isProduction = config.production;

if (
  !process.env.SESSION_SECRET ||
  process.env.SESSION_SECRET.length < 32
) {
  throw new Error("Debes configurar SESSION_SECRET en .env");
}

if (isProduction) {
  app.set("trust proxy", 1);
}

const PgSession = connectPgSimple(session);

const sessionCookieName = isProduction
  ? "__Host-malfi.sid"
  : "malfi.sid";

app.use(
  session({
    name: sessionCookieName,

    store: new PgSession({
      pool,
      tableName: "admin_sessions",
      createTableIfMissing: true
    }),

    secret: process.env.SESSION_SECRET,

    resave: false,
    saveUninitialized: false,

    cookie: {
      httpOnly: true,
      secure: isProduction,
      sameSite: "lax",
      path: "/",
      maxAge: 8 * 60 * 60 * 1000
    }
  })
);

// Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Configuración de imágenes
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024
  }
});

// Autenticación de administradoras
async function requireAdmin(req, res, next) {
  if (!Number.isInteger(req.session?.adminId)) {
    return res.status(401).json({
      error: "Debes iniciar sesión como administradora."
    });
  }

  try {
    const result = await pool.query(
      `SELECT id
       FROM admin_users
       WHERE id = $1 AND active = TRUE`,
      [req.session.adminId]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        error: "Sesión no autorizada."
      });
    }

    next();

  } catch (error) {
    next(error);
  }
}

if (!config.production) registerWebpayTest(app, pool, requireAdmin);
registerStoreRoutes(app, pool, requireAdmin, config);
const mpClient=mercadoPagoClient===undefined?createMercadoPagoClient(config):mercadoPagoClient;
registerMercadoPagoCheckout(app,pool,config,mpClient);
const flow=flowClient===undefined?createFlowClient(config):flowClient;
registerFlowCheckout(app,pool,config,flow);
registerCustomerPayments(app, pool, requireAdmin, config, webpayClient === undefined ? createWebpayClient(config) : webpayClient,mpClient,flow);
registerPendingPaymentsAdmin(
  app,
  pool,
  requireAdmin
);

const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false
});
registerProductRoutes(app, pool, requireAdmin, uploadLimiter, imageClient);


// Obtener la imagen del Hero
app.get("/api/hero", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT image_url FROM site_content WHERE key = $1",
      ["home_hero"]
    );

    res.json({
      imageUrl: result.rows[0]?.image_url || null
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: "No se pudo obtener la imagen"
    });
  }
});

// Subir nueva imagen del Hero
app.post(
  "/api/admin/hero",
  uploadLimiter,
  requireAdmin,
  upload.single("image"),
  async (req, res) => {
    if (!req.file) {
      return res.status(400).json({
        error: "Debes seleccionar una imagen"
      });
    }

    let uploaded = null;

    try {
      const detected = await fileTypeFromBuffer(req.file.buffer);

      const allowedTypes = [
        "image/jpeg",
        "image/png",
        "image/webp"
      ];

      if (!allowedTypes.includes(detected?.mime)) {
        return res.status(400).json({
          error: "Formato no permitido. Utiliza JPG, PNG o WebP."
        });
      }

      const previous = await pool.query(
        "SELECT image_public_id FROM site_content WHERE key = $1",
        ["home_hero"]
      );

      uploaded = await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          {
            folder: "malfi/hero",
            resource_type: "image"
          },
          (error, result) => {
            if (error) reject(error);
            else resolve(result);
          }
        );

        stream.end(req.file.buffer);
      });

     await pool.query(
  "INSERT INTO site_content (key, image_url, image_public_id) " +
  "VALUES ('home_hero', $1, $2) " +
  "ON CONFLICT (key) " +
  "DO UPDATE SET " +
  "image_url = EXCLUDED.image_url, " +
  "image_public_id = EXCLUDED.image_public_id",
  [uploaded.secure_url, uploaded.public_id]
);

      // Eliminar la fotografía anterior
      const oldId = previous.rows[0]?.image_public_id;

      if (oldId && oldId !== uploaded.public_id) {
        try {
          await cloudinary.uploader.destroy(oldId);
        } catch (error) {
          console.error("No se pudo eliminar la imagen anterior", error);
        }
      }

      res.json({
        message: "Imagen actualizada correctamente",
        imageUrl: uploaded.secure_url
      });

    } catch (error) {
      console.error(error);

      // Evitar dejar imágenes huérfanas si falla PostgreSQL
      if (uploaded?.public_id) {
        try {
          await cloudinary.uploader.destroy(uploaded.public_id);
        } catch (cleanupError) {
          console.error(cleanupError);
        }
      }

      res.status(500).json({
        error: "No se pudo subir la imagen"
      });
    }
  }
);

// ========================================
// COTIZAR DESPACHO POR DESTINO
// ========================================

app.get("/api/shipping/quote", async (req, res) => {
  const region =
    typeof req.query.region === "string"
      ? req.query.region.trim()
      : "";

  const comuna =
    typeof req.query.comuna === "string"
      ? req.query.comuna.trim()
      : "";

  if (
    !region ||
    !comuna ||
    region.length > 100 ||
    comuna.length > 100
  ) {
    return res.status(400).json({
      error: "Debes ingresar una región y comuna válidas."
    });
  }

  try {
    const shipping = await resolveShipping(pool, region, comuna);
    if (!shipping) {
      return res.status(409).json({
        code: "SHIPPING_NOT_CONFIGURED",
        error: "Todavía no tenemos un despacho habilitado para este destino."
      });
    }

    res.json({
      region: shipping.region,
      comuna: shipping.comuna,
      carrier: shipping.carrier,
      shippingCost: shipping.price_clp,
      deliveryDaysMin: shipping.delivery_days_min,
      deliveryDaysMax: shipping.delivery_days_max,
      currency: "CLP"
    });

  } catch (error) {
    console.error("Error al calcular despacho:", error);

    res.status(500).json({
      error: "No se pudo calcular el despacho."
    });
  }
});

// ========================================
// MALFI - CREAR PEDIDO PENDIENTE DE PAGO
// ========================================

function orderError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

// ========================================
// MALFI ADMIN - LISTAR PEDIDOS
// ========================================

app.get("/api/admin/orders", requireAdmin, async (req, res) => {
  try {
    const offset = Math.max(0, Math.min(1000000, Number(req.query.offset) || 0));
    const search = typeof req.query.search === "string" ? req.query.search.slice(0, 150).trim() : "";
    const result = await pool.query(`
      SELECT
        o.id,
        o.customer_name,
        o.shipping_region,
        o.shipping_comuna,
        o.carrier,
        o.delivery_method,
        o.total_clp,
        o.status,
        o.payment_status,
        o.created_at,
        COALESCE(SUM(oi.quantity), 0)::INTEGER AS item_count
      FROM orders o
      LEFT JOIN order_items oi ON oi.order_id = o.id
      WHERE ($1 = '' OR o.customer_name ILIKE '%' || $1 || '%' OR o.customer_email ILIKE '%' || $1 || '%' OR o.id::text=$1)
      GROUP BY o.id
      ORDER BY o.created_at DESC, o.id DESC
      LIMIT 50 OFFSET $2
    `, [search, Math.floor(offset)]);

    res.json(result.rows);

  } catch (error) {
    console.error("Error al obtener pedidos:", error);

    res.status(500).json({
      error: "No se pudieron obtener los pedidos."
    });
  }
});

// ========================================
// MALFI ADMIN - DETALLE DE PEDIDO
// ========================================

app.get("/api/admin/orders/:id", requireAdmin, async (req, res) => {
  const { id } = req.params;

  if (
    !/^[1-9]\d{0,18}$/.test(id) ||
    BigInt(id) > 9223372036854775807n
  ) {
    return res.status(400).json({
      error: "ID de pedido no válido."
    });
  }

  try {
    const orderResult = await pool.query(
      `SELECT
        id,
        customer_name,
        customer_email,
        customer_phone,
        shipping_region,
        shipping_comuna,
        shipping_address,
        shipping_reference,
        carrier,
        delivery_method,
        subtotal_clp,
        shipping_clp,
        total_clp,
        status,
        payment_status,
        payment_provider,
        tracking_url, tracking_number, paid_at,
        created_at
       FROM orders
       WHERE id = $1`,
      [id]
    );

    if (orderResult.rows.length === 0) {
      return res.status(404).json({
        error: "Pedido no encontrado."
      });
    }

    const itemsResult = await pool.query(
      `SELECT
        id, product_id,
        product_name, selected_color, selected_aroma, selected_workshop_date,
        unit_price_clp,
        quantity,
        line_total_clp
       FROM order_items
       WHERE order_id = $1
       ORDER BY id`,
      [id]
    );

    res.json({
      ...orderResult.rows[0],
      items: itemsResult.rows
    });

  } catch (error) {
    console.error("Error al consultar pedido:", error);

    res.status(500).json({
      error: "No se pudo obtener el pedido."
    });
  }
});

// ========================================
// AUTENTICACIÓN MALFI ADMIN
// ========================================

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    error: "Demasiados intentos. Intenta nuevamente más tarde."
  }
});

// INICIAR SESIÓN
app.post(
  "/api/admin/login",
  loginLimiter,
  async (req, res, next) => {
    const email =
      typeof req.body?.email === "string"
        ? req.body.email.trim().toLowerCase()
        : "";

    const password =
      typeof req.body?.password === "string"
        ? req.body.password
        : "";

    if (
      !email ||
      email.length > 254 ||
      !password ||
      password.length > 128
    ) {
      return res.status(400).json({
        error: "Ingresa un correo y contraseña válidos."
      });
    }

    try {
      const result = await pool.query(
        `SELECT id, email, password_hash
         FROM admin_users
         WHERE email = $1 AND active = TRUE`,
        [email]
      );

      const admin = result.rows[0];

      const validPassword =
        admin &&
        await bcrypt.compare(password, admin.password_hash);

      if (!validPassword) {
        return res.status(401).json({
          error: "Correo o contraseña incorrectos."
        });
      }

      req.session.regenerate((error) => {
        if (error) return next(error);

        req.session.adminId = admin.id;

        req.session.save((error) => {
          if (error) return next(error);

          res.json({
            message: "Inicio de sesión correcto.",
            admin: {
              id: admin.id,
              email: admin.email
            }
          });
        });
      });

    } catch (error) {
      next(error);
    }
  }
);

// CONSULTAR LA SESIÓN ACTUAL
app.get("/api/admin/me", requireAdmin, async (req, res) => {
  res.json({
    authenticated: true
  });
});

// CERRAR SESIÓN
app.post("/api/admin/logout", (req, res, next) => {
  req.session.destroy((error) => {
    if (error) return next(error);

    res.clearCookie(sessionCookieName, {
      path: "/",
      secure: isProduction,
      sameSite: "lax",
      httpOnly: true
    });

    res.json({
      message: "Sesión cerrada correctamente."
    });
  });
});

// ========================================
// ADMIN - ACTIVAR / OCULTAR PRODUCTO
// ========================================

app.patch(
  "/api/admin/products/:id/status",
  requireAdmin,
  async (req, res) => {
    const id = req.params.id;
    const { active } = req.body;

    if (
      !/^[1-9]\d*$/.test(id) ||
      Number(id) > 2147483647
    ) {
      return res.status(400).json({
        error: "ID de producto no válido."
      });
    }

    if (typeof active !== "boolean") {
      return res.status(400).json({
        error: "El estado debe ser verdadero o falso."
      });
    }

    try {
      const result = await pool.query(
        `UPDATE products
         SET active = $1
         WHERE id = $2
         RETURNING id, name, active`,
        [active, id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          error: "Producto no encontrado."
        });
      }

      res.json({
        message: active
          ? "Producto publicado correctamente."
          : "Producto ocultado correctamente.",
        product: result.rows[0]
      });
    } catch (error) {
      console.error("Error al cambiar estado:", error);

      res.status(500).json({
        error: "No se pudo cambiar el estado."
      });
    }
  }
);

// ========================================
// ADMIN - CAMBIAR ESTADO DE UN PEDIDO
// ========================================

app.patch(
  "/api/admin/orders/:id/status",
  requireAdmin,
  async (req, res) => {
    const { id } = req.params;
    const requestedStatus = req.body?.status;

    if (
      !/^[1-9]\d{0,18}$/.test(id) ||
      BigInt(id) > 9223372036854775807n
    ) {
      return res.status(400).json({
        error: "ID de pedido no válido."
      });
    }

    const transitions = new Map([
      [
        "cancelled",
        {
          previousStatus: "pending_payment",
          paymentStatus: "pending"
        }
      ],
      [
        "preparing",
        {
          previousStatus: "pending_payment",
          paymentStatus: "paid"
        }
      ],
      [
        "shipped",
        {
          previousStatus: "preparing",
          paymentStatus: "paid"
        }
      ],
      [
        "ready_for_pickup",
        {
          previousStatus: "preparing",
          paymentStatus: "paid"
        }
      ],
      [
        "delivered",
        {
          previousStatus: "shipped",
          paymentStatus: "paid"
        }
      ]
    ]);

    const transition = transitions.get(requestedStatus);

    if (!transition) {
      return res.status(400).json({
        error: "Estado de pedido no permitido."
      });
    }

    let client;

    try {
      client = await pool.connect();
      await client.query("BEGIN");

      const orderResult = await client.query(
        `SELECT
           id,
           status,
           payment_status,
           delivery_method,
           inventory_reserved
         FROM orders
         WHERE id = $1
         FOR UPDATE`,
        [id]
      );

      if (orderResult.rows.length === 0) {
        throw orderError("Pedido no encontrado.", 404);
      }

      const order = orderResult.rows[0];

      if ((requestedStatus === "shipped" && order.delivery_method === "pickup") ||
          (requestedStatus === "ready_for_pickup" && order.delivery_method !== "pickup")) {
        throw orderError("Este estado no corresponde a la forma de entrega del pedido.", 409);
      }
      const previousStatus = requestedStatus === "delivered" && order.delivery_method === "pickup"
        ? "ready_for_pickup" : transition.previousStatus;

      if (
        order.status !== previousStatus ||
        order.payment_status !== transition.paymentStatus
      ) {
        throw orderError(
          "No se puede realizar este cambio. Revisa el estado actual del pedido y su pago.",
          409
        );
      }

      if (
        requestedStatus === "cancelled" &&
        order.inventory_reserved
      ) {
        const flowCheckout = await client.query("SELECT 1 FROM flow_checkouts WHERE order_id=$1 AND state<>'failed'", [id]);
        if (flowCheckout.rowCount) throw orderError("Este pedido tiene un pago de Flow pendiente. Consulta y concilia su resultado antes de cancelar.",409);
        const mpCheckout = await client.query("SELECT 1 FROM mercadopago_checkouts WHERE order_id=$1", [id]);
        if (mpCheckout.rowCount) throw orderError("Este pedido tiene un checkout de Mercado Pago. Verifica y resuelve el movimiento en el proveedor antes de liberar su reserva.",409);
        const liveAttempt = await client.query("SELECT 1 FROM webpay_payments WHERE order_id=$1 AND state NOT IN ('failed','cancelled')", [id]);
        if (liveAttempt.rowCount) throw orderError("Este pedido tiene un pago pendiente de conciliación. Revisa Webpay antes de cancelarlo.", 409);
        const webpayAttempt = await client.query(
          `SELECT 1
           FROM webpay_test_attempts
           WHERE order_id = $1`,
          [id]
        );

        if (webpayAttempt.rowCount > 0) {
          throw orderError(
            "Este pedido tiene un intento Webpay. Debe conciliarse antes de cancelarlo.",
            409
          );
        }

        const attemptResult = await client.query(
          `SELECT mp_order_id
           FROM mercado_pago_attempts
           WHERE order_id = $1
           FOR UPDATE`,
          [id]
        );

        if (attemptResult.rows.length > 0) {
          const mpOrderId = attemptResult.rows[0].mp_order_id;

          if (!mpOrderId) {
            throw orderError(
              "El checkout de Mercado Pago aún se está preparando. Intenta cancelar nuevamente.",
              409
            );
          }

          const token = process.env.MP_ACCESS_TOKEN;

          if (!token || token === "TU_ACCESS_TOKEN_DE_PRUEBA") {
            throw orderError(
              "No se puede conciliar el pago sin configurar el Access Token.",
              503
            );
          }

          const mpResponse = await fetch(
            `https://api.mercadopago.com/v1/orders/${encodeURIComponent(mpOrderId)}`,
            {
              headers: {
                Authorization: `Bearer ${token}`
              },
              signal: AbortSignal.timeout(9000)
            }
          );

          if (!mpResponse.ok) {
            throw orderError(
              "No se pudo conciliar el estado del pago con Mercado Pago.",
              502
            );
          }

          const mpOrder = await mpResponse.json();

          if (
            mpOrder.id !== mpOrderId ||
            mpOrder.external_reference !== `malfi_${id}` ||
            (mpOrder.currency ?? mpOrder.currency_id) !== "CLP" ||
            mpOrder.live_mode === true
          ) {
            throw orderError(
              "Mercado Pago devolvió datos que no coinciden con el pedido.",
              502
            );
          }

          const hasProcessedPayment =
            mpOrder.status === "processed" ||
            mpOrder.status_detail === "accredited" ||
            (Array.isArray(mpOrder.transactions?.payments) &&
              mpOrder.transactions.payments.some(
                (payment) =>
                  payment.status === "processed" ||
                  payment.status_detail === "accredited"
              ));

          if (hasProcessedPayment) {
            throw orderError(
              "El pago ya fue procesado o requiere conciliación. No se liberó la reserva.",
              409
            );
          }
        }

        const itemsResult = await client.query(
          `SELECT product_id, quantity
           FROM order_items
           WHERE order_id = $1
           ORDER BY product_id`,
          [id]
        );

        if (itemsResult.rows.length === 0) {
          throw orderError(
            "No se encontraron productos para liberar la reserva.",
            409
          );
        }

        for (const item of itemsResult.rows) {
          const released = await client.query(
            `UPDATE products
             SET reserved_stock = reserved_stock - $1
             WHERE id = $2
               AND reserved_stock >= $1
             RETURNING id`,
            [item.quantity, item.product_id]
          );

          if (released.rowCount !== 1) {
            throw orderError(
              "No se pudo liberar toda la reserva del pedido. Revisa el inventario.",
              409
            );
          }
        }
      }

      const result = await client.query(
  `UPDATE orders
   SET status = $1::varchar,
       inventory_reserved = CASE
         WHEN $1::varchar = 'cancelled' THEN FALSE
         ELSE inventory_reserved
       END
   WHERE id = $2
   RETURNING
     id,
     status,
     payment_status,
     carrier`,
  [requestedStatus, id]
);


      await client.query("COMMIT");

      res.json({
        message: "Estado actualizado correctamente.",
        order: result.rows[0]
      });
    } catch (error) {
      if (client) {
        try {
          await client.query("ROLLBACK");
        } catch (rollbackError) {
          console.error("Error en rollback:", rollbackError);
        }
      }

      console.error("Error al actualizar pedido:", error);

      res.status(error.status || 500).json({
        error: error.status
          ? error.message
          : "No se pudo actualizar el pedido."
      });
    } finally {
      if (client) client.release();
    }
  }
);

// ========================================
// MALFI - MERCADO PAGO (PRUEBAS)
// ========================================

const mpTestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false
});

app.post(
  "/api/admin/payments/mercadopago/test/:id",
  mpTestLimiter,
  requireAdmin,
  async (req, res) => {
    if (
      process.env.NODE_ENV === "production" ||
      process.env.MP_TEST_MODE !== "true"
    ) {
      return res.status(403).json({
        error: "La integración de pruebas está deshabilitada."
      });
    }

    const token = process.env.MP_ACCESS_TOKEN;

    if (!token || token === "TU_ACCESS_TOKEN_DE_PRUEBA") {
      return res.status(503).json({
        error: "Configura el Access Token de prueba."
      });
    }

    const orderId = req.params.id;

    if (
      !/^[1-9]\d{0,18}$/.test(orderId) ||
      BigInt(orderId) > 9223372036854775807n
    ) {
      return res.status(400).json({
        error: "ID de pedido no válido."
      });
    }

    try {
      const orderResult = await pool.query(
        `SELECT
           id,
           customer_email,
           subtotal_clp,
           shipping_clp,
           total_clp,
           status,
           payment_status,
           inventory_reserved
         FROM orders
         WHERE id = $1`,
        [orderId]
      );

      if (orderResult.rows.length === 0) {
        return res.status(404).json({
          error: "Pedido no encontrado."
        });
      }

      const order = orderResult.rows[0];

      if (
        order.status !== "pending_payment" ||
        order.payment_status !== "pending" ||
        order.inventory_reserved !== true
      ) {
        return res.status(409).json({
          error: "Este pedido ya no tiene una reserva pendiente de pago."
        });
      }

      const itemsResult = await pool.query(
        `SELECT
           product_name,
           unit_price_clp,
           quantity,
           line_total_clp
         FROM order_items
         WHERE order_id = $1
         ORDER BY id`,
        [orderId]
      );

      if (itemsResult.rows.length === 0) {
        return res.status(409).json({
          error: "El pedido no tiene productos."
        });
      }

      const itemsTotal = itemsResult.rows.reduce(
        (sum, item) =>
          sum +
          BigInt(item.unit_price_clp) *
          BigInt(item.quantity),
        0n
      );

      const subtotal = BigInt(order.subtotal_clp);
      const shipping = BigInt(order.shipping_clp);
      const total = BigInt(order.total_clp);

      if (
        itemsTotal !== subtotal ||
        subtotal + shipping !== total ||
        total <= 0n
      ) {
        return res.status(409).json({
          error: "Los importes del pedido no coinciden."
        });
      }

      let attempt;
      const attemptClient = await pool.connect();

      try {
        await attemptClient.query("BEGIN");

        const lockedOrderResult = await attemptClient.query(
          `SELECT status, payment_status, inventory_reserved
           FROM orders
           WHERE id = $1
           FOR UPDATE`,
          [orderId]
        );

        if (lockedOrderResult.rows.length === 0) {
          throw orderError("Pedido no encontrado.", 404);
        }

        const webpayAttempt = await attemptClient.query(
          `SELECT 1 FROM webpay_test_attempts WHERE order_id = $1`,
          [orderId]
        );

        if (webpayAttempt.rowCount > 0) {
          throw orderError(
            "Este pedido ya tiene un intento Webpay.",
            409
          );
        }

        const lockedOrder = lockedOrderResult.rows[0];

        if (
          lockedOrder.status !== "pending_payment" ||
          lockedOrder.payment_status !== "pending" ||
          lockedOrder.inventory_reserved !== true
        ) {
          throw orderError(
            "Este pedido ya no tiene una reserva pendiente de pago.",
            409
          );
        }

        await attemptClient.query(
          `INSERT INTO mercado_pago_attempts
             (order_id, idempotency_key)
           VALUES ($1, $2)
           ON CONFLICT (order_id) DO NOTHING`,
          [orderId, randomUUID()]
        );

        const attemptResult = await attemptClient.query(
          `SELECT idempotency_key, mp_order_id, checkout_url
           FROM mercado_pago_attempts
           WHERE order_id = $1`,
          [orderId]
        );

        if (attemptResult.rows.length === 0) {
          throw new Error(
            "No se pudo registrar el intento de pago."
          );
        }

        attempt = attemptResult.rows[0];
        await attemptClient.query("COMMIT");
      } catch (error) {
        try {
          await attemptClient.query("ROLLBACK");
        } catch (rollbackError) {
          console.error(
            "Error al revertir intento de pago:",
            rollbackError
          );
        }

        throw error;
      } finally {
        attemptClient.release();
      }

      if (attempt.mp_order_id && attempt.checkout_url) {
        return res.json({
          message: "Checkout de prueba ya disponible.",
          checkoutUrl: attempt.checkout_url
        });
      }

      const mpItems = itemsResult.rows.map((item) => ({
        title: item.product_name,
        unit_price: String(item.unit_price_clp),
        quantity: item.quantity
      }));

      if (shipping > 0n) {
        mpItems.push({
          title: "Despacho MALFI",
          unit_price: shipping.toString(),
          quantity: 1
        });
      }

      const mpResponse = await fetch(
        "https://api.mercadopago.com/v1/orders",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            "X-Idempotency-Key": attempt.idempotency_key
          },
          body: JSON.stringify({
            type: "online",
            processing_mode: "manual",
            total_amount: total.toString(),
            external_reference: `malfi_${orderId}`,
            payer: {
              email: order.customer_email
            },
            items: mpItems
          }),
          signal: AbortSignal.timeout(15000)
        }
      );

      const mpData = await mpResponse.json();

      if (!mpResponse.ok) {
        console.error(
          "Mercado Pago rechazó la creación:",
          mpResponse.status,
          mpData.error,
          mpData.message
        );

        return res.status(502).json({
          error:
            "Mercado Pago no pudo crear el checkout de prueba."
        });
      }

      if (
        typeof mpData.id !== "string" ||
        typeof mpData.checkout_url !== "string" ||
        !mpData.checkout_url.startsWith("https://")
      ) {
        throw new Error(
          "Mercado Pago devolvió una respuesta inesperada."
        );
      }

      await pool.query(
        `UPDATE mercado_pago_attempts
         SET mp_order_id = $2,
             checkout_url = $3
         WHERE order_id = $1`,
        [orderId, mpData.id, mpData.checkout_url]
      );

      res.json({
        message: "Checkout de prueba creado correctamente.",
        checkoutUrl: mpData.checkout_url
      });
    } catch (error) {
      console.error(
        "Error al preparar Mercado Pago:",
        error.message
      );

      res.status(error.status || 500).json({
        error: error.status
          ? error.message
          : "No se pudo preparar el pago de prueba."
      });
    }
  }
);

// Static frontend and direct navigation to checkout/product/admin routes.
app.use("/api", (req, res) => res.status(404).json({ error: "Ruta no encontrada." }));
const frontendDir = fileURLToPath(new URL("../Frontend/dist/", import.meta.url));
if (existsSync(path.join(frontendDir, "index.html"))) {
  app.use(express.static(frontendDir, { index: false }));
  app.get(/^(?!\/api(?:\/|$)).*/, (req, res, next) => {
    if (path.extname(req.path)) return res.sendStatus(404);
    res.set("Cache-Control", "no-cache");
    if (req.path.startsWith("/admin") || req.path.startsWith("/pedido")) res.set("X-Robots-Tag", "noindex, nofollow");
    res.sendFile(path.join(frontendDir, "index.html"));
  });
}
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  if (error instanceof multer.MulterError) return res.status(400).json({ error: "Sube una imagen de hasta 5 MB." });
  if (error.type === "entity.parse.failed") return res.status(400).json({ error: "JSON no válido." });
  if (error.status === 413) return res.status(413).json({ error: "La solicitud supera el tamaño permitido." });
  console.error("Error de aplicación:", error.message);
  res.status(500).json({ error: "No se pudo completar la solicitud." });
});
return app;
}
