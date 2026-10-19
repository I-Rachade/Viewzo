-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('DEPOSIT', 'ESCROW', 'EARNING', 'COMMISSION', 'WITHDRAWAL', 'REFUND');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('PENDING', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentKind" AS ENUM ('PAYIN', 'PAYOUT');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('REQUESTED', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'REJECTED');

-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "fundedAt" TIMESTAMP(3),
ADD COLUMN     "spent" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "TaskAssignment" ADD COLUMN     "earned" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "validViews" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "TransactionType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'XOF',
    "status" "TransactionStatus" NOT NULL DEFAULT 'COMPLETED',
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "campaignId" TEXT,
    "assignmentId" TEXT,
    "paymentId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "PaymentKind" NOT NULL,
    "provider" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "providerRef" TEXT,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'XOF',
    "phone" TEXT NOT NULL,
    "beneficiaryName" TEXT,
    "operator" TEXT,
    "campaignId" TEXT,
    "checkoutUrl" TEXT,
    "status" "PaymentStatus" NOT NULL,
    "failureReason" TEXT,
    "reviewedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_paymentId_key" ON "Transaction"("paymentId");

-- CreateIndex
CREATE INDEX "Transaction_userId_createdAt_idx" ON "Transaction"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Transaction_campaignId_idx" ON "Transaction"("campaignId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_reference_key" ON "Payment"("reference");

-- CreateIndex
CREATE INDEX "Payment_kind_status_createdAt_idx" ON "Payment"("kind", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Payment_userId_createdAt_idx" ON "Payment"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_provider_providerRef_key" ON "Payment"("provider", "providerRef");

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
