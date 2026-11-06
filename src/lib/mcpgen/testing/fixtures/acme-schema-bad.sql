-- Invented input with only ambiguous or unsupported constructs.
CREATE TABLE dup_cols (a INT, a TEXT);
CREATE TABLE broken_table (id INT
CREATE VIEW only_view AS SELECT 1;
CREATE TABLE copy_of AS SELECT * FROM somewhere;
