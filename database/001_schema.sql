-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "dim_customer" (
    "customer_id" SERIAL NOT NULL,
    "customer_code" TEXT NOT NULL,
    "customer_name" TEXT NOT NULL,
    "region" TEXT NOT NULL DEFAULT 'APAC',

    CONSTRAINT "dim_customer_pkey" PRIMARY KEY ("customer_id")
);

-- CreateTable
CREATE TABLE "dim_product" (
    "product_id" SERIAL NOT NULL,
    "product_name" TEXT NOT NULL,
    "package" TEXT NOT NULL,
    "device" TEXT NOT NULL,
    "technology" TEXT NOT NULL,

    CONSTRAINT "dim_product_pkey" PRIMARY KEY ("product_id")
);

-- CreateTable
CREATE TABLE "dim_bom" (
    "bom_id" SERIAL NOT NULL,
    "bom_name" TEXT NOT NULL,
    "revision" TEXT NOT NULL,

    CONSTRAINT "dim_bom_pkey" PRIMARY KEY ("bom_id")
);

-- CreateTable
CREATE TABLE "dim_machine" (
    "machine_id" SERIAL NOT NULL,
    "machine_name" TEXT NOT NULL,
    "machine_type" TEXT NOT NULL,
    "production_line" TEXT NOT NULL,

    CONSTRAINT "dim_machine_pkey" PRIMARY KEY ("machine_id")
);

-- CreateTable
CREATE TABLE "dim_process" (
    "process_id" SERIAL NOT NULL,
    "process_name" TEXT NOT NULL,
    "operation_name" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "dim_process_pkey" PRIMARY KEY ("process_id")
);

-- CreateTable
CREATE TABLE "dim_date" (
    "date_id" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "year" INTEGER NOT NULL,
    "quarter" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "week" INTEGER NOT NULL,
    "day" INTEGER NOT NULL,

    CONSTRAINT "dim_date_pkey" PRIMARY KEY ("date_id")
);

-- CreateTable
CREATE TABLE "fact_yield" (
    "yield_id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "source_key" TEXT NOT NULL,
    "lot_no" TEXT NOT NULL,
    "customer_id" INTEGER NOT NULL,
    "product_id" INTEGER NOT NULL,
    "bom_id" INTEGER NOT NULL,
    "process_id" INTEGER NOT NULL,
    "machine_id" INTEGER NOT NULL,
    "date_id" INTEGER NOT NULL,
    "transaction_date" TIMESTAMPTZ(3) NOT NULL,
    "factory" TEXT NOT NULL,
    "shift" TEXT NOT NULL,
    "operator" TEXT NOT NULL,
    "input_qty" INTEGER NOT NULL,
    "output_qty" INTEGER NOT NULL,
    "reject_qty" INTEGER NOT NULL,
    "rework_qty" INTEGER NOT NULL,
    "unit_cost" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "yield_percentage" DECIMAL(8,4) NOT NULL,

    CONSTRAINT "fact_yield_pkey" PRIMARY KEY ("yield_id","transaction_date")
) PARTITION BY RANGE ("transaction_date");

-- CreateTable
CREATE TABLE "fact_defect" (
    "defect_id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "source_key" TEXT NOT NULL,
    "lot_no" TEXT NOT NULL,
    "process_id" INTEGER NOT NULL,
    "machine_id" INTEGER NOT NULL,
    "defect_code" TEXT NOT NULL,
    "defect_description" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "fact_defect_pkey" PRIMARY KEY ("defect_id")
);

-- CreateTable
CREATE TABLE "fact_scrap" (
    "scrap_id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "source_key" TEXT NOT NULL,
    "lot_no" TEXT NOT NULL,
    "process_id" INTEGER NOT NULL,
    "scrap_qty" INTEGER NOT NULL,
    "scrap_reason" TEXT NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "fact_scrap_pkey" PRIMARY KEY ("scrap_id")
);

-- CreateTable
CREATE TABLE "fact_spc" (
    "spc_id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "source_key" TEXT NOT NULL,
    "process_id" INTEGER NOT NULL,
    "machine_id" INTEGER NOT NULL,
    "measurement_name" TEXT NOT NULL,
    "measurement_value" DOUBLE PRECISION NOT NULL,
    "ucl" DOUBLE PRECISION NOT NULL,
    "lcl" DOUBLE PRECISION NOT NULL,
    "target" DOUBLE PRECISION NOT NULL,
    "sample_size" INTEGER NOT NULL DEFAULT 5,
    "subgroup" TEXT NOT NULL,
    "measured_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "fact_spc_pkey" PRIMARY KEY ("spc_id")
);

-- CreateTable
CREATE TABLE "etl_query_master" (
    "query_id" TEXT NOT NULL,
    "query_name" TEXT NOT NULL,
    "oracle_source" TEXT NOT NULL,
    "target_table" TEXT NOT NULL,
    "sql_text" TEXT NOT NULL,
    "schedule" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "load_mode" TEXT NOT NULL DEFAULT 'incremental',
    "last_sync_time" TIMESTAMPTZ(3),
    "next_run_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "etl_query_master_pkey" PRIMARY KEY ("query_id")
);

-- CreateTable
CREATE TABLE "etl_job" (
    "id" TEXT NOT NULL,
    "query_id" TEXT NOT NULL,
    "job_name" TEXT NOT NULL,
    "start_time" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "end_time" TIMESTAMPTZ(3),
    "status" TEXT NOT NULL,
    "rows_processed" INTEGER NOT NULL DEFAULT 0,
    "failed_records" INTEGER NOT NULL DEFAULT 0,
    "errors" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "etl_job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "etl_quarantine" (
    "id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "source_key" TEXT,
    "errors" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "etl_quarantine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "details" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alert" (
    "id" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "details" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "acknowledged_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "alert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alert_delivery" (
    "id" TEXT NOT NULL,
    "alert_id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_error" TEXT,

    CONSTRAINT "alert_delivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alert_rule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "threshold" DOUBLE PRECISION NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "alert_rule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lot_comment" (
    "id" TEXT NOT NULL,
    "lot_no" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lot_comment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attachment" (
    "id" TEXT NOT NULL,
    "lot_no" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "uploaded_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "equipment_event" (
    "id" TEXT NOT NULL,
    "machine_id" INTEGER NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL,
    "ended_at" TIMESTAMP(3) NOT NULL,
    "operating_minutes" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "equipment_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_schedule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "schedule" TEXT NOT NULL,
    "filters" JSONB NOT NULL,
    "next_run_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_by" TEXT NOT NULL,

    CONSTRAINT "report_schedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_run" (
    "id" TEXT NOT NULL,
    "schedule_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "storage_key" TEXT,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_run_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "dim_customer_customer_code_key" ON "dim_customer"("customer_code");

-- CreateIndex
CREATE UNIQUE INDEX "dim_product_product_name_package_device_technology_key" ON "dim_product"("product_name", "package", "device", "technology");

-- CreateIndex
CREATE UNIQUE INDEX "dim_bom_bom_name_revision_key" ON "dim_bom"("bom_name", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "dim_machine_machine_name_key" ON "dim_machine"("machine_name");

-- CreateIndex
CREATE UNIQUE INDEX "dim_process_process_name_key" ON "dim_process"("process_name");

-- CreateIndex
CREATE UNIQUE INDEX "dim_date_date_key" ON "dim_date"("date");

-- CreateIndex
CREATE INDEX "fact_yield_lot_no_transaction_date_idx" ON "fact_yield"("lot_no", "transaction_date");

-- CreateIndex
CREATE INDEX "fact_yield_date_id_customer_id_product_id_idx" ON "fact_yield"("date_id", "customer_id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "fact_yield_source_source_key_transaction_date_key" ON "fact_yield"("source", "source_key", "transaction_date");

-- CreateIndex
CREATE INDEX "fact_defect_occurred_at_defect_code_idx" ON "fact_defect"("occurred_at", "defect_code");

-- CreateIndex
CREATE INDEX "fact_defect_lot_no_idx" ON "fact_defect"("lot_no");

-- CreateIndex
CREATE UNIQUE INDEX "fact_defect_source_source_key_key" ON "fact_defect"("source", "source_key");

-- CreateIndex
CREATE INDEX "fact_scrap_occurred_at_scrap_reason_idx" ON "fact_scrap"("occurred_at", "scrap_reason");

-- CreateIndex
CREATE INDEX "fact_scrap_lot_no_idx" ON "fact_scrap"("lot_no");

-- CreateIndex
CREATE UNIQUE INDEX "fact_scrap_source_source_key_key" ON "fact_scrap"("source", "source_key");

-- CreateIndex
CREATE INDEX "fact_spc_process_id_machine_id_measurement_name_measured_at_idx" ON "fact_spc"("process_id", "machine_id", "measurement_name", "measured_at");

-- CreateIndex
CREATE UNIQUE INDEX "fact_spc_source_source_key_key" ON "fact_spc"("source", "source_key");

-- CreateIndex
CREATE UNIQUE INDEX "etl_query_master_query_name_key" ON "etl_query_master"("query_name");

-- CreateIndex
CREATE INDEX "etl_job_start_time_idx" ON "etl_job"("start_time");

-- CreateIndex
CREATE INDEX "etl_quarantine_job_id_idx" ON "etl_quarantine"("job_id");

-- CreateIndex
CREATE INDEX "audit_log_created_at_idx" ON "audit_log"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "alert_fingerprint_key" ON "alert"("fingerprint");

-- CreateIndex
CREATE INDEX "alert_status_created_at_idx" ON "alert"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "alert_delivery_alert_id_channel_key" ON "alert_delivery"("alert_id", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "alert_rule_name_key" ON "alert_rule"("name");

-- CreateIndex
CREATE INDEX "lot_comment_lot_no_idx" ON "lot_comment"("lot_no");

-- CreateIndex
CREATE UNIQUE INDEX "attachment_storage_key_key" ON "attachment"("storage_key");

-- CreateIndex
CREATE INDEX "attachment_lot_no_idx" ON "attachment"("lot_no");

-- AddForeignKey
ALTER TABLE "fact_yield" ADD CONSTRAINT "fact_yield_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "dim_customer"("customer_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fact_yield" ADD CONSTRAINT "fact_yield_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "dim_product"("product_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fact_yield" ADD CONSTRAINT "fact_yield_bom_id_fkey" FOREIGN KEY ("bom_id") REFERENCES "dim_bom"("bom_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fact_yield" ADD CONSTRAINT "fact_yield_process_id_fkey" FOREIGN KEY ("process_id") REFERENCES "dim_process"("process_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fact_yield" ADD CONSTRAINT "fact_yield_machine_id_fkey" FOREIGN KEY ("machine_id") REFERENCES "dim_machine"("machine_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fact_yield" ADD CONSTRAINT "fact_yield_date_id_fkey" FOREIGN KEY ("date_id") REFERENCES "dim_date"("date_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fact_defect" ADD CONSTRAINT "fact_defect_process_id_fkey" FOREIGN KEY ("process_id") REFERENCES "dim_process"("process_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fact_defect" ADD CONSTRAINT "fact_defect_machine_id_fkey" FOREIGN KEY ("machine_id") REFERENCES "dim_machine"("machine_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fact_scrap" ADD CONSTRAINT "fact_scrap_process_id_fkey" FOREIGN KEY ("process_id") REFERENCES "dim_process"("process_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fact_spc" ADD CONSTRAINT "fact_spc_process_id_fkey" FOREIGN KEY ("process_id") REFERENCES "dim_process"("process_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fact_spc" ADD CONSTRAINT "fact_spc_machine_id_fkey" FOREIGN KEY ("machine_id") REFERENCES "dim_machine"("machine_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "etl_job" ADD CONSTRAINT "etl_job_query_id_fkey" FOREIGN KEY ("query_id") REFERENCES "etl_query_master"("query_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_delivery" ADD CONSTRAINT "alert_delivery_alert_id_fkey" FOREIGN KEY ("alert_id") REFERENCES "alert"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_event" ADD CONSTRAINT "equipment_event_machine_id_fkey" FOREIGN KEY ("machine_id") REFERENCES "dim_machine"("machine_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_run" ADD CONSTRAINT "report_run_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "report_schedule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
