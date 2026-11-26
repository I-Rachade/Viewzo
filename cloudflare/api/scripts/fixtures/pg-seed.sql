-- Sample rows for the migration rehearsal (rehearse-migration.sh), loaded into
-- a throwaway PostgreSQL in CI after the backend migrations. They cover the
-- values that change form on the way to D1: lists, enum lists, Json, booleans,
-- dates with and without milliseconds, quotes and accents in text, and a
-- payment and a transaction that point to each other.
INSERT INTO "User" ("id","firstName","phone","email","phoneVerifiedAt","passwordHash","country","priorityRank","role","staffRole","staffCountries","createdAt","updatedAt")
VALUES
  ('u-creator','Éloïse O''Neil','+22890000001','eloise@viewzo.test','2026-10-19 15:53:12.12',
   'scrypt$16384$8$1$c2FsdA$aGFzaA','TG',1,'USER',NULL,'{}','2026-10-19 15:53:12','2026-10-20 08:00:00.5'),
  ('u-staff','Kossi',NULL,'finance@viewzo.test',NULL,NULL,'TG',2,'STAFF','FINANCE','{TG,BJ}',
   '2026-10-19 16:00:00.001','2026-10-19 16:00:00.001');

INSERT INTO "UserProfile" ("id","userId","type","level","createdAt")
VALUES ('p-1','u-creator','CREATOR',2,'2026-10-19 15:53:12');

INSERT INTO "CreatorSkills" ("userId","taskTypes","specialties","showsFace","exampleLinks","languages","countries","cities","themes","tasksPerWeek","updatedAt")
VALUES ('u-creator','{LIVE_SELLING,CREATE_ORIGINAL_VIDEO}','{FACECAM}',true,
  '{"https://www.tiktok.com/@eloise/video/1","https://www.tiktok.com/@eloise/video/2"}',
  '{fr,ewe}','{TG}','{"Lomé","Kpalimé"}','{}',3,'2026-10-20 09:15:00');

INSERT INTO "Payment" ("id","userId","kind","provider","reference","amount","phone","beneficiaryName","status","createdAt","updatedAt")
VALUES ('pay-1','u-creator','PAYOUT','local','RTEST1',2500,'+22890000001','Éloïse O''Neil','REQUESTED',
  '2026-10-21 10:00:00','2026-10-21 10:00:00');

INSERT INTO "Transaction" ("id","userId","type","amount","status","availableAt","frozen","paymentId","createdAt","updatedAt")
VALUES
  ('t-earn','u-creator','EARNING',10000,'COMPLETED','2026-10-20 00:00:00',false,NULL,'2026-10-19 18:00:00','2026-10-19 18:00:00'),
  ('t-frozen','u-creator','EARNING',700,'COMPLETED','2026-10-20 00:00:00',true,NULL,'2026-10-19 18:00:00','2026-10-19 18:00:00'),
  ('t-wd','u-creator','WITHDRAWAL',-2500,'PENDING','2026-10-21 10:00:00',false,'pay-1','2026-10-21 10:00:00','2026-10-21 10:00:00');

INSERT INTO "AuditLog" ("id","actorId","actorRole","action","entity","entityId","before","after","createdAt")
VALUES ('a-1','u-staff','FINANCE','payment.review','Payment','pay-1',
  '{"status":"REQUESTED"}','{"status":"PROCESSING","note":"vérifié \"ok\"","amounts":[1,2.5]}','2026-10-21 11:00:00');
