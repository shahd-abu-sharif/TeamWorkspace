-- Uploaded bytes kept in Postgres when no S3-compatible bucket is configured,
-- so a container restart cannot orphan attachment rows.
CREATE TABLE "FileBlob" (
    "key" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FileBlob_pkey" PRIMARY KEY ("key")
);
