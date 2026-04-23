-- migration_20260417_invoice_sequence.sql
-- Author: platform-team
-- Date: 2026-04-17
-- Purpose: add human-readable invoice numbers to the invoices table.
-- Previously invoice IDs were UUIDs; finance team requested sequential
-- numeric invoice numbers for customer-facing references.

BEGIN;

-- Create the sequence if it does not already exist
CREATE SEQUENCE IF NOT EXISTS invoice_number_seq
    START WITH 100001
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

-- Add the invoice_number column
ALTER TABLE invoices
    ADD COLUMN IF NOT EXISTS invoice_number BIGINT;

-- Back-fill existing rows with sequential values
UPDATE invoices
SET invoice_number = nextval('invoice_number_seq')
WHERE invoice_number IS NULL
ORDER BY created_at;

-- Add a unique constraint
ALTER TABLE invoices
    ADD CONSTRAINT invoices_invoice_number_key UNIQUE (invoice_number);

COMMIT;

-- Application-layer change (deployed with this migration):
-- invoice-processor Lambda now calls the following inside its
-- invoice-creation transaction before INSERT:
--
--   invoice_num = conn.execute(
--       "SELECT nextval('invoice_number_seq')"
--   ).scalar()
--
-- The invoice_number value is then included in the INSERT statement.
-- This ensures the application has the invoice number available to
-- return in the API response without a second round-trip.
