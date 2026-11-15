DO $bootstrap$
BEGIN
IF to_regclass('public.products') IS NULL THEN
--
-- PostgreSQL database dump
--



-- Dumped from database version 18.4
-- Dumped by pg_dump version 18.4





--
-- Name: admin_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_sessions (
    sid character varying NOT NULL,
    sess json NOT NULL,
    expire timestamp(6) without time zone NOT NULL
);


--
-- Name: admin_users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_users (
    id integer NOT NULL,
    email character varying(254) NOT NULL,
    password_hash text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: admin_users_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.admin_users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: admin_users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.admin_users_id_seq OWNED BY public.admin_users.id;


--
-- Name: mercado_pago_attempts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mercado_pago_attempts (
    id bigint NOT NULL,
    order_id bigint NOT NULL,
    idempotency_key uuid NOT NULL,
    mp_order_id text,
    checkout_url text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: mercado_pago_attempts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.mercado_pago_attempts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: mercado_pago_attempts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.mercado_pago_attempts_id_seq OWNED BY public.mercado_pago_attempts.id;


--
-- Name: order_email_outbox; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_email_outbox (
    order_id bigint NOT NULL,
    kind text DEFAULT 'payment_confirmed'::text NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    provider_id text,
    started_at timestamp with time zone,
    sent_at timestamp with time zone,
    last_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT order_email_outbox_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'sending'::text, 'sent'::text, 'needs_review'::text])))
);


--
-- Name: order_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_items (
    id bigint NOT NULL,
    order_id bigint NOT NULL,
    product_id integer NOT NULL,
    product_name character varying(150) NOT NULL,
    unit_price_clp integer NOT NULL,
    quantity integer NOT NULL,
    line_total_clp bigint NOT NULL,
    CONSTRAINT order_items_line_total_clp_check CHECK ((line_total_clp >= 0)),
    CONSTRAINT order_items_quantity_check CHECK ((quantity > 0)),
    CONSTRAINT order_items_unit_price_clp_check CHECK ((unit_price_clp > 0))
);


--
-- Name: order_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.order_items_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: order_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.order_items_id_seq OWNED BY public.order_items.id;


--
-- Name: orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.orders (
    id bigint NOT NULL,
    customer_name character varying(120) NOT NULL,
    customer_email character varying(254) NOT NULL,
    customer_phone character varying(25) NOT NULL,
    shipping_region character varying(100) NOT NULL,
    shipping_comuna character varying(100) NOT NULL,
    shipping_address character varying(250) NOT NULL,
    shipping_reference character varying(300),
    carrier character varying(30) NOT NULL,
    subtotal_clp bigint NOT NULL,
    shipping_clp integer NOT NULL,
    total_clp bigint NOT NULL,
    status character varying(30) DEFAULT 'pending_payment'::character varying NOT NULL,
    payment_status character varying(30) DEFAULT 'pending'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    paid_at timestamp with time zone,
    stock_deducted_at timestamp with time zone,
    reservation_status character varying(20) DEFAULT 'none'::character varying NOT NULL,
    reservation_expires_at timestamp with time zone,
    inventory_reserved boolean DEFAULT false NOT NULL,
    CONSTRAINT orders_payment_status_check CHECK (((payment_status)::text = ANY ((ARRAY['pending'::character varying, 'paid'::character varying, 'failed'::character varying, 'refunded'::character varying])::text[]))),
    CONSTRAINT orders_reservation_status_check CHECK (((reservation_status)::text = ANY ((ARRAY['none'::character varying, 'active'::character varying, 'consumed'::character varying, 'released'::character varying])::text[]))),
    CONSTRAINT orders_shipping_clp_check CHECK ((shipping_clp >= 0)),
    CONSTRAINT orders_status_check CHECK (((status)::text = ANY ((ARRAY['pending_payment'::character varying, 'preparing'::character varying, 'shipped'::character varying, 'delivered'::character varying, 'cancelled'::character varying, 'payment_review'::character varying])::text[]))),
    CONSTRAINT orders_subtotal_clp_check CHECK ((subtotal_clp >= 0)),
    CONSTRAINT orders_total_clp_check CHECK ((total_clp >= 0))
);


--
-- Name: orders_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.orders_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: orders_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.orders_id_seq OWNED BY public.orders.id;


--
-- Name: products; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.products (
    id integer NOT NULL,
    name character varying(150) NOT NULL,
    description text,
    price integer NOT NULL,
    category character varying(100) NOT NULL,
    stock integer DEFAULT 0 NOT NULL,
    image_url text,
    image_public_id text,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    reserved_stock integer DEFAULT 0 NOT NULL,
    CONSTRAINT products_price_check CHECK ((price > 0)),
    CONSTRAINT products_reservation_stock_check CHECK (((stock >= 0) AND (reserved_stock >= 0) AND (reserved_stock <= stock))),
    CONSTRAINT products_reserved_stock_check CHECK (((reserved_stock >= 0) AND (reserved_stock <= stock))),
    CONSTRAINT products_stock_check CHECK ((stock >= 0))
);


--
-- Name: products_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.products_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: products_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.products_id_seq OWNED BY public.products.id;


--
-- Name: shipping_rates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shipping_rates (
    region character varying(100) NOT NULL,
    price_clp integer,
    active boolean DEFAULT false NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    carrier character varying(30) DEFAULT 'Blue Express'::character varying NOT NULL,
    CONSTRAINT shipping_rates_price_clp_check CHECK ((price_clp >= 0))
);


--
-- Name: shipping_rates_comunas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shipping_rates_comunas (
    id integer NOT NULL,
    region character varying(100) NOT NULL,
    comuna character varying(100) NOT NULL,
    carrier character varying(30) NOT NULL,
    price_clp integer,
    active boolean DEFAULT false NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT shipping_rates_comunas_carrier_check CHECK (((carrier)::text = ANY ((ARRAY['Paket'::character varying, 'Blue Express'::character varying])::text[]))),
    CONSTRAINT shipping_rates_comunas_price_clp_check CHECK ((price_clp >= 0))
);


--
-- Name: shipping_rates_comunas_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.shipping_rates_comunas_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: shipping_rates_comunas_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.shipping_rates_comunas_id_seq OWNED BY public.shipping_rates_comunas.id;


--
-- Name: shipping_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shipping_settings (
    id integer NOT NULL,
    origin_region character varying(100) NOT NULL,
    origin_comuna character varying(100) NOT NULL,
    CONSTRAINT shipping_settings_id_check CHECK ((id = 1))
);


--
-- Name: site_content; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.site_content (
    key character varying(50) NOT NULL,
    image_url text,
    image_public_id text
);


--
-- Name: webpay_test_attempts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.webpay_test_attempts (
    order_id bigint NOT NULL,
    buy_order character varying(26) NOT NULL,
    session_id character varying(61) NOT NULL,
    amount_clp integer NOT NULL,
    token_ws text,
    webpay_url text,
    state character varying(25) DEFAULT 'starting'::character varying NOT NULL,
    response_code integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    finalized_at timestamp with time zone,
    last_bank_status character varying(40),
    last_status_check_at timestamp with time zone,
    return_reason character varying(20),
    returned_at timestamp with time zone,
    close_reason character varying(50),
    attempt_id bigint NOT NULL,
    attempt_no integer DEFAULT 1 NOT NULL,
    is_current boolean DEFAULT true NOT NULL,
    CONSTRAINT webpay_test_attempts_amount_clp_check CHECK ((amount_clp > 0)),
    CONSTRAINT webpay_test_attempts_state_check CHECK (((state)::text = ANY ((ARRAY['starting'::character varying, 'created'::character varying, 'processing'::character varying, 'authorized_test'::character varying, 'rejected_test'::character varying, 'review'::character varying])::text[])))
);


--
-- Name: webpay_test_attempts_attempt_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.webpay_test_attempts ALTER COLUMN attempt_id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.webpay_test_attempts_attempt_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: admin_users id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_users ALTER COLUMN id SET DEFAULT nextval('public.admin_users_id_seq'::regclass);


--
-- Name: mercado_pago_attempts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mercado_pago_attempts ALTER COLUMN id SET DEFAULT nextval('public.mercado_pago_attempts_id_seq'::regclass);


--
-- Name: order_items id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items ALTER COLUMN id SET DEFAULT nextval('public.order_items_id_seq'::regclass);


--
-- Name: orders id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders ALTER COLUMN id SET DEFAULT nextval('public.orders_id_seq'::regclass);


--
-- Name: products id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products ALTER COLUMN id SET DEFAULT nextval('public.products_id_seq'::regclass);


--
-- Name: shipping_rates_comunas id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipping_rates_comunas ALTER COLUMN id SET DEFAULT nextval('public.shipping_rates_comunas_id_seq'::regclass);


--
-- Name: admin_users admin_users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_users
    ADD CONSTRAINT admin_users_email_key UNIQUE (email);


--
-- Name: admin_users admin_users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_users
    ADD CONSTRAINT admin_users_pkey PRIMARY KEY (id);


--
-- Name: mercado_pago_attempts mercado_pago_attempts_idempotency_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mercado_pago_attempts
    ADD CONSTRAINT mercado_pago_attempts_idempotency_key_key UNIQUE (idempotency_key);


--
-- Name: mercado_pago_attempts mercado_pago_attempts_mp_order_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mercado_pago_attempts
    ADD CONSTRAINT mercado_pago_attempts_mp_order_id_key UNIQUE (mp_order_id);


--
-- Name: mercado_pago_attempts mercado_pago_attempts_order_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mercado_pago_attempts
    ADD CONSTRAINT mercado_pago_attempts_order_id_key UNIQUE (order_id);


--
-- Name: mercado_pago_attempts mercado_pago_attempts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mercado_pago_attempts
    ADD CONSTRAINT mercado_pago_attempts_pkey PRIMARY KEY (id);


--
-- Name: order_email_outbox order_email_outbox_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_email_outbox
    ADD CONSTRAINT order_email_outbox_pkey PRIMARY KEY (order_id, kind);


--
-- Name: order_items order_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_pkey PRIMARY KEY (id);


--
-- Name: orders orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_pkey PRIMARY KEY (id);


--
-- Name: products products_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_pkey PRIMARY KEY (id);


--
-- Name: admin_sessions session_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_sessions
    ADD CONSTRAINT session_pkey PRIMARY KEY (sid);


--
-- Name: shipping_rates_comunas shipping_rates_comunas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipping_rates_comunas
    ADD CONSTRAINT shipping_rates_comunas_pkey PRIMARY KEY (id);


--
-- Name: shipping_rates_comunas shipping_rates_comunas_region_comuna_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipping_rates_comunas
    ADD CONSTRAINT shipping_rates_comunas_region_comuna_key UNIQUE (region, comuna);


--
-- Name: shipping_rates shipping_rates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipping_rates
    ADD CONSTRAINT shipping_rates_pkey PRIMARY KEY (region);


--
-- Name: shipping_settings shipping_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipping_settings
    ADD CONSTRAINT shipping_settings_pkey PRIMARY KEY (id);


--
-- Name: site_content site_content_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.site_content
    ADD CONSTRAINT site_content_pkey PRIMARY KEY (key);


--
-- Name: webpay_test_attempts webpay_test_attempts_attempt_id_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webpay_test_attempts
    ADD CONSTRAINT webpay_test_attempts_attempt_id_pk PRIMARY KEY (attempt_id);


--
-- Name: webpay_test_attempts webpay_test_attempts_buy_order_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webpay_test_attempts
    ADD CONSTRAINT webpay_test_attempts_buy_order_key UNIQUE (buy_order);


--
-- Name: webpay_test_attempts webpay_test_attempts_token_ws_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webpay_test_attempts
    ADD CONSTRAINT webpay_test_attempts_token_ws_key UNIQUE (token_ws);


--
-- Name: IDX_session_expire; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "IDX_session_expire" ON public.admin_sessions USING btree (expire);


--
-- Name: webpay_attempt_one_current_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX webpay_attempt_one_current_uq ON public.webpay_test_attempts USING btree (order_id) WHERE (is_current = true);


--
-- Name: webpay_attempt_order_lookup_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX webpay_attempt_order_lookup_idx ON public.webpay_test_attempts USING btree (order_id, created_at DESC);


--
-- Name: webpay_attempt_order_number_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX webpay_attempt_order_number_uq ON public.webpay_test_attempts USING btree (order_id, attempt_no);


--
-- Name: mercado_pago_attempts mercado_pago_attempts_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mercado_pago_attempts
    ADD CONSTRAINT mercado_pago_attempts_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id);


--
-- Name: order_email_outbox order_email_outbox_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_email_outbox
    ADD CONSTRAINT order_email_outbox_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id);


--
-- Name: order_items order_items_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: order_items order_items_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- Name: webpay_test_attempts webpay_test_attempts_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webpay_test_attempts
    ADD CONSTRAINT webpay_test_attempts_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id);


--
-- PostgreSQL database dump complete
--



END IF;
END
$bootstrap$;
