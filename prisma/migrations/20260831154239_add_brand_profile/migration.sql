-- CreateTable
CREATE TABLE "BrandProfile" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "brandName" TEXT,
    "brandVoice" TEXT,
    "targetAudience" TEXT,
    "productsServices" TEXT,
    "targetCountry" TEXT,
    "language" TEXT,
    "competitorUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrandProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BrandProfile_companyId_key" ON "BrandProfile"("companyId");

-- AddForeignKey
ALTER TABLE "BrandProfile" ADD CONSTRAINT "BrandProfile_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
