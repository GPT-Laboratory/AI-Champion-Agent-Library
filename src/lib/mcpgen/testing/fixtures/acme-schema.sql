-- Invented Acme schema used for adapter tests.
CREATE TABLE IF NOT EXISTS main.customer (
  customer_id INTEGER NOT NULL PRIMARY KEY,
  customer_name VARCHAR(80) NOT NULL,
  segment TEXT DEFAULT 'standard',
  city TEXT
);

/* orders reference customers */
CREATE TABLE "order" (
  order_id INTEGER NOT NULL,
  customer_id INTEGER NOT NULL REFERENCES customer(customer_id),
  order_status TEXT,
  total NUMERIC(10,2),
  placed_on DATE,
  PRIMARY KEY (order_id)
);

CREATE TABLE order_line (
  order_id INTEGER NOT NULL,
  line_no INTEGER NOT NULL,
  sku TEXT NOT NULL,
  quantity INT,
  CONSTRAINT pk_line PRIMARY KEY (order_id, line_no),
  FOREIGN KEY (order_id) REFERENCES "order" (order_id)
);

CREATE TABLE note_log (
  note_text TEXT,
  created TIMESTAMP
);

CREATE INDEX idx_order_status ON "order" (order_status);
CREATE VIEW open_orders AS SELECT * FROM "order" WHERE order_status = 'open';
INSERT INTO customer (customer_id, customer_name) VALUES (1, 'Zed Distinctive Value');
UPDATE customer SET city = 'Nowhere' WHERE customer_id = 1;
DELETE FROM note_log;
DROP TABLE legacy_table;
