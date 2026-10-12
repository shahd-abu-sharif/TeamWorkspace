ALTER TABLE "WorkspaceMember"
ADD COLUMN "specialties" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "Invitation"
ADD COLUMN "specialties" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

UPDATE "WorkspaceMember"
SET "specialties" = string_to_array("specialty", ',')
WHERE "specialty" IS NOT NULL AND "specialty" <> '';

UPDATE "Invitation"
SET "specialties" = string_to_array("specialty", ',')
WHERE "specialty" IS NOT NULL AND "specialty" <> '';
