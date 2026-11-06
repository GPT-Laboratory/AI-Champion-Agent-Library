--
-- PostgreSQL database dump (invented Acme sample, schema only)
--

SET statement_timeout = 0;
SET lock_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET default_tablespace = '';
SET default_table_access_method = heap;

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;

CREATE TYPE public.order_state AS ENUM (
    'open',
    'shipped',
    'cancelled'
);
ALTER TYPE public.order_state OWNER TO acme_owner;

CREATE FUNCTION public.touch_updated() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TABLE public.customer (
    customer_id integer NOT NULL,
    customer_name character varying(80) NOT NULL,
    segment text DEFAULT 'standard'::text,
    credit numeric(10,2),
    profile jsonb,
    tags text[],
    external_ref uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    search_key text GENERATED ALWAYS AS (lower((customer_name)::text)) STORED,
    CONSTRAINT customer_credit_check CHECK ((credit >= (0)::numeric))
);
ALTER TABLE public.customer OWNER TO acme_owner;
COMMENT ON TABLE public.customer IS 'Invented customers; semicolon; inside a comment';

CREATE SEQUENCE public.customer_customer_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.customer_customer_id_seq OWNED BY public.customer.customer_id;

CREATE TABLE public."order" (
    order_id bigint NOT NULL,
    customer_id integer NOT NULL,
    state public.order_state DEFAULT 'open'::public.order_state NOT NULL,
    total numeric(12,2),
    placed_on date
);

CREATE TABLE public.order_line (
    order_id bigint NOT NULL,
    line_no integer NOT NULL,
    sku text NOT NULL,
    quantity integer
);

CREATE TABLE public.note_log (
    note_text text,
    created timestamp without time zone
);

CREATE VIEW public.open_orders AS
 SELECT o.order_id FROM public."order" o WHERE (o.state = 'open'::public.order_state);

ALTER TABLE ONLY public.customer ALTER COLUMN customer_id SET DEFAULT nextval('public.customer_customer_id_seq'::regclass);

ALTER TABLE ONLY public.customer
    ADD CONSTRAINT customer_pkey PRIMARY KEY (customer_id);

ALTER TABLE ONLY public.customer
    ADD CONSTRAINT customer_external_ref_key UNIQUE (external_ref);

ALTER TABLE ONLY public."order"
    ADD CONSTRAINT order_pkey PRIMARY KEY (order_id);

ALTER TABLE ONLY public.order_line
    ADD CONSTRAINT order_line_pkey PRIMARY KEY (order_id, line_no);

ALTER TABLE ONLY public."order"
    ADD CONSTRAINT order_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customer(customer_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.order_line
    ADD CONSTRAINT order_line_order_id_fkey FOREIGN KEY (order_id) REFERENCES public."order"(order_id);

CREATE INDEX idx_order_state ON public."order" USING btree (state);

--
-- PostgreSQL database dump complete
--
